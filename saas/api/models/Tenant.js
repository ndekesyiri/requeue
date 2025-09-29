/**
 * Tenant Model
 * Multi-tenant data model for SaaS platform
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const tenantSchema = new mongoose.Schema({
  // Basic tenant information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
  },
  description: {
    type: String,
    maxlength: 500
  },
  
  // Authentication
  apiKey: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4()
  },
  webhookSecret: {
    type: String,
    default: () => uuidv4()
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspensionReason: {
    type: String
  },
  
  // Billing
  plan: {
    name: {
      type: String,
      required: true,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free'
    },
    limits: {
      maxQueues: {
        type: Number,
        default: 1
      },
      maxItems: {
        type: Number,
        default: 1000
      },
      maxApiCalls: {
        type: Number,
        default: 10000
      },
      maxWebhooks: {
        type: Number,
        default: 5
      },
      maxRetentionDays: {
        type: Number,
        default: 7
      }
    },
    features: {
      priorityQueues: {
        type: Boolean,
        default: false
      },
      batchOperations: {
        type: Boolean,
        default: false
      },
      webhooks: {
        type: Boolean,
        default: false
      },
      monitoring: {
        type: Boolean,
        default: false
      },
      sla: {
        type: Boolean,
        default: false
      }
    }
  },
  
  // Billing information
  billingStatus: {
    type: String,
    enum: ['active', 'past_due', 'canceled', 'trialing'],
    default: 'active'
  },
  billingCustomerId: {
    type: String // Stripe customer ID
  },
  billingSubscriptionId: {
    type: String // Stripe subscription ID
  },
  billingPeriodEnd: {
    type: Date
  },
  
  // Usage tracking
  usage: {
    queues: {
      type: Number,
      default: 0
    },
    items: {
      type: Number,
      default: 0
    },
    apiCalls: {
      type: Number,
      default: 0
    },
    lastReset: {
      type: Date,
      default: Date.now
    }
  },
  
  // Settings
  settings: {
    timezone: {
      type: String,
      default: 'UTC'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      webhook: {
        type: Boolean,
        default: false
      }
    },
    retention: {
      completedItems: {
        type: Number,
        default: 7 // days
      },
      failedItems: {
        type: Number,
        default: 30 // days
      }
    }
  },
  
  // Permissions
  permissions: [{
    type: String,
    enum: [
      'queue:create',
      'queue:read',
      'queue:update',
      'queue:delete',
      'item:create',
      'item:read',
      'item:update',
      'item:delete',
      'webhook:create',
      'webhook:read',
      'webhook:update',
      'webhook:delete',
      'monitoring:read',
      'billing:read',
      'admin:all'
    ]
  }],
  
  // Metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
tenantSchema.index({ slug: 1 });
tenantSchema.index({ apiKey: 1 });
tenantSchema.index({ isActive: 1, isSuspended: 1 });
tenantSchema.index({ 'plan.name': 1 });
tenantSchema.index({ billingStatus: 1 });
tenantSchema.index({ createdAt: -1 });

// Virtual for tenant status
tenantSchema.virtual('status').get(function() {
  if (this.isSuspended) return 'suspended';
  if (!this.isActive) return 'inactive';
  if (this.billingStatus === 'past_due') return 'past_due';
  if (this.billingStatus === 'canceled') return 'canceled';
  return 'active';
});

// Virtual for plan limits
tenantSchema.virtual('limits').get(function() {
  return this.plan.limits;
});

// Virtual for plan features
tenantSchema.virtual('features').get(function() {
  return this.plan.features;
});

// Pre-save middleware
tenantSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  this.lastActivity = new Date();
  next();
});

// Instance methods
tenantSchema.methods.generateApiKey = function() {
  this.apiKey = uuidv4();
  return this.apiKey;
};

tenantSchema.methods.generateWebhookSecret = function() {
  this.webhookSecret = uuidv4();
  return this.webhookSecret;
};

tenantSchema.methods.updateUsage = async function(type, increment = 1) {
  const updateField = `usage.${type}`;
  await this.updateOne({
    $inc: { [updateField]: increment },
    $set: { lastActivity: new Date() }
  });
};

tenantSchema.methods.resetUsage = async function() {
  await this.updateOne({
    $set: {
      'usage.queues': 0,
      'usage.items': 0,
      'usage.apiCalls': 0,
      'usage.lastReset': new Date()
    }
  });
};

tenantSchema.methods.checkLimit = function(type) {
  const limit = this.plan.limits[`max${type.charAt(0).toUpperCase() + type.slice(1)}`];
  const current = this.usage[type];
  return current < limit;
};

tenantSchema.methods.upgradePlan = function(newPlan) {
  this.plan.name = newPlan;
  
  // Update limits based on plan
  switch (newPlan) {
    case 'pro':
      this.plan.limits = {
        maxQueues: 10,
        maxItems: 100000,
        maxApiCalls: 100000,
        maxWebhooks: 20,
        maxRetentionDays: 30
      };
      this.plan.features = {
        priorityQueues: true,
        batchOperations: true,
        webhooks: true,
        monitoring: true,
        sla: false
      };
      break;
    case 'enterprise':
      this.plan.limits = {
        maxQueues: -1, // unlimited
        maxItems: -1, // unlimited
        maxApiCalls: -1, // unlimited
        maxWebhooks: -1, // unlimited
        maxRetentionDays: 365
      };
      this.plan.features = {
        priorityQueues: true,
        batchOperations: true,
        webhooks: true,
        monitoring: true,
        sla: true
      };
      break;
    default: // free
      this.plan.limits = {
        maxQueues: 1,
        maxItems: 1000,
        maxApiCalls: 10000,
        maxWebhooks: 5,
        maxRetentionDays: 7
      };
      this.plan.features = {
        priorityQueues: false,
        batchOperations: false,
        webhooks: false,
        monitoring: false,
        sla: false
      };
  }
};

// Static methods
tenantSchema.statics.findByApiKey = function(apiKey) {
  return this.findOne({ apiKey, isActive: true, isSuspended: false });
};

tenantSchema.statics.findBySlug = function(slug) {
  return this.findOne({ slug, isActive: true });
};

tenantSchema.statics.getActiveTenants = function() {
  return this.find({ isActive: true, isSuspended: false });
};

tenantSchema.statics.getTenantsByPlan = function(planName) {
  return this.find({ 'plan.name': planName, isActive: true });
};

const Tenant = mongoose.model('Tenant', tenantSchema);

module.exports = { Tenant };
