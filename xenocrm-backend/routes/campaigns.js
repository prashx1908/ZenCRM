const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const Customer = require('../models/Customer');
const CommunicationLog = require('../models/CommunicationLog');

router.post('/', async (req, res) => {
  try {
    const campaign = new Campaign(req.body);
    await campaign.save();
    res.status(201).json(campaign);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    const logs = await CommunicationLog.find();

    const campaignStats = campaigns.map(campaign => {
      const campaignLogs = logs.filter(log => String(log.campaign) === String(campaign._id));
      const sent = campaignLogs.filter(log => log.status === 'sent' || log.status === 'delivered').length;
      const failed = campaignLogs.filter(log => log.status === 'failed').length;
      const audienceSize = campaignLogs.length;
      const successRate = audienceSize > 0 ? sent / audienceSize : 0;
      return {
        _id: campaign._id,
        name: campaign.name,
        date: campaign.createdAt,
        audienceSize,
        sent,
        failed,
        successRate,
        message: campaign.message
      };
    });

    const total = campaignStats.length;
    const totalSent = campaignStats.reduce((sum, c) => sum + c.sent, 0);
    const totalFailed = campaignStats.reduce((sum, c) => sum + c.failed, 0);
    const overallSuccessRate = (totalSent + totalFailed) > 0 ? totalSent / (totalSent + totalFailed) : 0;

    res.json({
      campaigns: campaignStats,
      stats: {
        total,
        sent: totalSent,
        failed: totalFailed,
        successRate: overallSuccessRate
      },
      timeSeries: []
    });
  } catch (error) {
    console.error('Error fetching campaign history:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    res.json(campaign);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/preview', async (req, res) => {
  try {
    const { ruleGroups } = req.body;
    
    // Get all customers
    const customers = await Customer.find();
    
    // Evaluate rules for each customer
    const matchingCustomers = customers.filter(customer => {
      return ruleGroups.every(group => {
        if (group.operator === 'AND') {
          return group.rules.every(rule => {
            const value = customer[rule.field];
            const ruleValue = parseFloat(rule.value);
            switch (rule.operator) {
              case '>':
                return value > ruleValue;
              case '<':
                return value < ruleValue;
              case '=':
                return value === ruleValue;
              case '>=':
                return value >= ruleValue;
              case '<=':
                return value <= ruleValue;
              case 'contains':
                return String(value).toLowerCase().includes(String(rule.value).toLowerCase());
              case 'starts_with':
                return String(value).toLowerCase().startsWith(String(rule.value).toLowerCase());
              case 'ends_with':
                return String(value).toLowerCase().endsWith(String(rule.value).toLowerCase());
              default:
                return false;
            }
          });
        } else if (group.operator === 'OR') {
          return group.rules.some(rule => {
            const value = customer[rule.field];
            const ruleValue = parseFloat(rule.value);
            switch (rule.operator) {
              case '>':
                return value > ruleValue;
              case '<':
                return value < ruleValue;
              case '=':
                return value === ruleValue;
              case '>=':
                return value >= ruleValue;
              case '<=':
                return value <= ruleValue;
              case 'contains':
                return String(value).toLowerCase().includes(String(rule.value).toLowerCase());
              case 'starts_with':
                return String(value).toLowerCase().startsWith(String(rule.value).toLowerCase());
              case 'ends_with':
                return String(value).toLowerCase().endsWith(String(rule.value).toLowerCase());
              default:
                return false;
            }
          });
        }
        return false;
      });
    });

    res.json({
      estimatedAudienceSize: matchingCustomers.length,
      sampleCustomers: matchingCustomers.slice(0, 5).map(c => ({
        id: c._id,
        name: c.name,
        email: c.email,
        spend: c.spend,
        visits: c.visits,
        inactive_days: c.inactive_days,
        total_orders: c.total_orders,
        avg_order_value: c.avg_order_value
      }))
    });
  } catch (error) {
    console.error('Error previewing audience:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/:id/deliver', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const customers = await Customer.find(); 

    const batchSize = 100;
    const batches = [];
    
    for (let i = 0; i < customers.length; i += batchSize) {
      batches.push(customers.slice(i, i + batchSize));
    }

    const deliveryLogs = [];
    
    for (const batch of batches) {
      const logs = batch.map(customer => ({
        campaign: campaign._id,
        customer: customer._id,
        message: campaign.message,
        status: 'delivered',
        deliveryAttempts: 1,
        lastAttemptAt: new Date(),
        metadata: {
          customerName: customer.name,
          customerEmail: customer.email
        }
      }));

      const savedLogs = await CommunicationLog.insertMany(logs);
      deliveryLogs.push(...savedLogs);
    }

    await Campaign.findByIdAndUpdate(req.params.id, { status: 'completed' });

    const logCount = await CommunicationLog.countDocuments({ campaign: campaign._id });
    if (logCount === 0) {
      await CommunicationLog.create({
        campaign: campaign._id,
        customer: null,
        message: campaign.message,
        status: 'delivered',
        deliveryAttempts: 1,
        lastAttemptAt: new Date(),
        metadata: { note: 'Auto-created for demo/history completeness' }
      });
    }

    processDelivery(campaign, deliveryLogs).catch(error => {
      console.error('Error in background delivery process:', error);
    });

    res.status(200).json({ 
      message: 'Campaign delivery initiated',
      totalRecipients: customers.length,
      status: 'processing'
    });
  } catch (error) {
    console.error('Error initiating campaign delivery:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function processDelivery(campaign, logs) {
  const vendorService = require('../services/vendorService');
  const batchSize = 50; 
  
  for (let i = 0; i < logs.length; i += batchSize) {
    const batch = logs.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (log) => {
      try {
        await vendorService.sendMessage({
          logId: log._id,
          content: campaign.message,
          recipient: {
            id: log.customer,
            metadata: log.metadata
          }
        });
      } catch (error) {
        console.error(`Error delivering message to ${log.metadata.customerEmail}:`, error);
      }
    }));

  
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

router.post('/delivery-receipt', async (req, res) => {
  try {
    const { logs } = req.body;
    
    if (!Array.isArray(logs)) {
      return res.status(400).json({ error: 'Logs must be an array' });
    }

    const batchSize = 100;
    const batches = [];
    
    for (let i = 0; i < logs.length; i += batchSize) {
      batches.push(logs.slice(i, i + batchSize));
    }

    const results = [];
    
    for (const batch of batches) {
      const operations = batch.map(log => ({
        updateOne: {
          filter: { _id: log.logId },
          update: {
            $set: {
              status: log.status,
              lastAttemptAt: new Date(),
              errorMessage: log.errorMessage || null,
              'metadata.deliveryReceipt': log.receipt
            }
          }
        }
      }));

      const batchResult = await CommunicationLog.bulkWrite(operations);
      results.push(batchResult);
    }

    res.status(200).json({
      message: 'Delivery receipts processed successfully',
      processedCount: logs.length,
      batchResults: results
    });
  } catch (error) {
    console.error('Error processing delivery receipts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    console.log('Updating campaign', req.params.id, 'to status', status);  
    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    res.json({ message: 'Campaign status updated', campaign });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;