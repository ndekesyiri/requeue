/**
 * Tenant Middleware
 * Handles multi-tenant isolation and resource management
 */

const { Tenant } = require('../models/Tenant');
const { UsageTracker } = require('../../services/usage/UsageTracker');
const { logger } = require('./logger');

/**
 * Tenant isolation middleware
 * Ensures all operations are scoped to the authenticated tenant
 */
const tenantMiddleware = async (req, res, next) => {
  try {
    const tenantId = req.tenantId || req.tenant?._id;
    
    if (!tenantId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant identification required'
      });
    }

    // Get tenant details
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Tenant not found'
      });
    }

    if (!tenant.isActive) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Tenant account is inactive'
      });
    }

    if (tenant.isSuspended) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Tenant account is suspended'
      });
    }

    // Attach tenant info to request
    req.tenant = tenant;
    req.tenantId = tenantId;
    
    // Add tenant prefix to Redis keys
    req.redisPrefix = `tenant:${tenantId}:`;
    
    next();
  } catch (error) {
    logger.error('Tenant middleware error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Tenant validation failed'
    });
  }
};

/**
 * Resource limit enforcement
 */
const enforceResourceLimits = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    const usageTracker = new UsageTracker(tenant._id);

    // Check current usage against limits
    const currentUsage = await usageTracker.getCurrentUsage();
    
    // Queue limits
    if (req.route?.path?.includes('/queues') && req.method === 'POST') {
      if (currentUsage.queues >= tenant.plan.limits.maxQueues) {
        return res.status(403).json({
          error: 'Resource Limit Exceeded',
          message: `Maximum queues limit (${tenant.plan.limits.maxQueues}) reached`,
          currentUsage: currentUsage.queues,
          limit: tenant.plan.limits.maxQueues
        });
      }
    }

    // Item limits
    if (req.route?.path?.includes('/items') && req.method === 'POST') {
      if (currentUsage.items >= tenant.plan.limits.maxItems) {
        return res.status(403).json({
          error: 'Resource Limit Exceeded',
          message: `Maximum items limit (${tenant.plan.limits.maxItems}) reached`,
          currentUsage: currentUsage.items,
          limit: tenant.plan.limits.maxItems
        });
      }
    }

    // API call limits
    if (currentUsage.apiCalls >= tenant.plan.limits.maxApiCalls) {
      return res.status(429).json({
        error: 'Rate Limit Exceeded',
        message: `API call limit (${tenant.plan.limits.maxApiCalls}) reached`,
        currentUsage: currentUsage.apiCalls,
        limit: tenant.plan.limits.maxApiCalls,
        resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      });
    }

    // Track API call
    await usageTracker.trackApiCall(req.method, req.route?.path);

    next();
  } catch (error) {
    logger.error('Resource limit enforcement error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Resource validation failed'
    });
  }
};

/**
 * Tenant-specific rate limiting
 */
const tenantRateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
  return async (req, res, next) => {
    try {
      const tenant = req.tenant;
      const usageTracker = new UsageTracker(tenant._id);
      
      // Check if tenant has exceeded rate limit
      const isRateLimited = await usageTracker.checkRateLimit(windowMs, max);
      
      if (isRateLimited) {
        return res.status(429).json({
          error: 'Rate Limit Exceeded',
          message: `Too many requests. Limit: ${max} per ${windowMs / 1000}s`,
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      next();
    } catch (error) {
      logger.error('Tenant rate limit error:', error);
      next(); // Continue on error to avoid blocking
    }
  };
};

/**
 * Tenant data isolation
 * Ensures all database queries are scoped to the tenant
 */
const tenantDataIsolation = (req, res, next) => {
  // Add tenant filter to all database queries
  req.tenantFilter = { tenantId: req.tenantId };
  
  // Override find methods to include tenant filter
  const originalFind = req.db?.find;
  if (originalFind) {
    req.db.find = (query = {}) => {
      return originalFind({ ...query, tenantId: req.tenantId });
    };
  }

  next();
};

/**
 * Tenant billing check
 * Ensures tenant has valid billing status
 */
const checkBillingStatus = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    
    // Check if tenant has valid billing
    if (tenant.billingStatus === 'past_due') {
      return res.status(402).json({
        error: 'Payment Required',
        message: 'Account payment is past due',
        billingStatus: tenant.billingStatus
      });
    }

    if (tenant.billingStatus === 'canceled') {
      return res.status(403).json({
        error: 'Account Canceled',
        message: 'Account has been canceled',
        billingStatus: tenant.billingStatus
      });
    }

    next();
  } catch (error) {
    logger.error('Billing status check error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Billing validation failed'
    });
  }
};

module.exports = {
  tenantMiddleware,
  enforceResourceLimits,
  tenantRateLimit,
  tenantDataIsolation,
  checkBillingStatus
};
