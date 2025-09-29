/**
 * Usage Tracker Service
 * Tracks and enforces usage limits for tenants
 */

const Redis = require('ioredis');
const { logger } = require('../../api/middleware/logger');

class UsageTracker {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      keyPrefix: `tenant:${tenantId}:usage:`
    });
  }

  /**
   * Track API call
   */
  async trackApiCall(method, endpoint) {
    try {
      const now = Date.now();
      const day = Math.floor(now / (24 * 60 * 60 * 1000));
      
      // Increment daily API calls
      await this.redis.hincrby(`daily:${day}`, 'apiCalls', 1);
      
      // Track by method
      await this.redis.hincrby(`daily:${day}`, `method:${method}`, 1);
      
      // Track by endpoint
      const endpointKey = endpoint.replace(/\/[0-9a-f-]+/g, '/:id'); // Normalize IDs
      await this.redis.hincrby(`daily:${day}`, `endpoint:${endpointKey}`, 1);
      
      // Set expiration (keep 30 days)
      await this.redis.expire(`daily:${day}`, 30 * 24 * 60 * 60);
      
      logger.debug(`Tracked API call for tenant ${this.tenantId}: ${method} ${endpoint}`);
    } catch (error) {
      logger.error('Error tracking API call:', error);
    }
  }

  /**
   * Track queue creation
   */
  async trackQueueCreation() {
    try {
      const now = Date.now();
      const day = Math.floor(now / (24 * 60 * 60 * 1000));
      
      await this.redis.hincrby(`daily:${day}`, 'queues', 1);
      await this.redis.expire(`daily:${day}`, 30 * 24 * 60 * 60);
      
      logger.debug(`Tracked queue creation for tenant ${this.tenantId}`);
    } catch (error) {
      logger.error('Error tracking queue creation:', error);
    }
  }

  /**
   * Track item creation
   */
  async trackItemCreation(count = 1) {
    try {
      const now = Date.now();
      const day = Math.floor(now / (24 * 60 * 60 * 1000));
      
      await this.redis.hincrby(`daily:${day}`, 'items', count);
      await this.redis.expire(`daily:${day}`, 30 * 24 * 60 * 60);
      
      logger.debug(`Tracked ${count} item(s) creation for tenant ${this.tenantId}`);
    } catch (error) {
      logger.error('Error tracking item creation:', error);
    }
  }

  /**
   * Track webhook calls
   */
  async trackWebhookCall() {
    try {
      const now = Date.now();
      const day = Math.floor(now / (24 * 60 * 60 * 1000));
      
      await this.redis.hincrby(`daily:${day}`, 'webhooks', 1);
      await this.redis.expire(`daily:${day}`, 30 * 24 * 60 * 60);
      
      logger.debug(`Tracked webhook call for tenant ${this.tenantId}`);
    } catch (error) {
      logger.error('Error tracking webhook call:', error);
    }
  }

  /**
   * Get current usage for today
   */
  async getCurrentUsage() {
    try {
      const now = Date.now();
      const day = Math.floor(now / (24 * 60 * 60 * 1000));
      
      const usage = await this.redis.hgetall(`daily:${day}`);
      
      return {
        apiCalls: parseInt(usage.apiCalls || 0),
        queues: parseInt(usage.queues || 0),
        items: parseInt(usage.items || 0),
        webhooks: parseInt(usage.webhooks || 0),
        date: new Date(day * 24 * 60 * 60 * 1000).toISOString()
      };
    } catch (error) {
      logger.error('Error getting current usage:', error);
      return {
        apiCalls: 0,
        queues: 0,
        items: 0,
        webhooks: 0,
        date: new Date().toISOString()
      };
    }
  }

  /**
   * Get usage for a specific date range
   */
  async getUsageRange(startDate, endDate) {
    try {
      const startDay = Math.floor(new Date(startDate).getTime() / (24 * 60 * 60 * 1000));
      const endDay = Math.floor(new Date(endDate).getTime() / (24 * 60 * 60 * 1000));
      
      const usage = [];
      
      for (let day = startDay; day <= endDay; day++) {
        const dayUsage = await this.redis.hgetall(`daily:${day}`);
        usage.push({
          date: new Date(day * 24 * 60 * 60 * 1000).toISOString(),
          apiCalls: parseInt(dayUsage.apiCalls || 0),
          queues: parseInt(dayUsage.queues || 0),
          items: parseInt(dayUsage.items || 0),
          webhooks: parseInt(dayUsage.webhooks || 0)
        });
      }
      
      return usage;
    } catch (error) {
      logger.error('Error getting usage range:', error);
      return [];
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(days = 30) {
    try {
      const now = Date.now();
      const endDay = Math.floor(now / (24 * 60 * 60 * 1000));
      const startDay = endDay - days;
      
      const usage = await this.getUsageRange(
        new Date(startDay * 24 * 60 * 60 * 1000),
        new Date(endDay * 24 * 60 * 60 * 1000)
      );
      
      const stats = {
        total: {
          apiCalls: 0,
          queues: 0,
          items: 0,
          webhooks: 0
        },
        average: {
          apiCalls: 0,
          queues: 0,
          items: 0,
          webhooks: 0
        },
        peak: {
          apiCalls: 0,
          queues: 0,
          items: 0,
          webhooks: 0
        },
        days: usage.length
      };
      
      // Calculate totals and peaks
      usage.forEach(day => {
        stats.total.apiCalls += day.apiCalls;
        stats.total.queues += day.queues;
        stats.total.items += day.items;
        stats.total.webhooks += day.webhooks;
        
        stats.peak.apiCalls = Math.max(stats.peak.apiCalls, day.apiCalls);
        stats.peak.queues = Math.max(stats.peak.queues, day.queues);
        stats.peak.items = Math.max(stats.peak.items, day.items);
        stats.peak.webhooks = Math.max(stats.peak.webhooks, day.webhooks);
      });
      
      // Calculate averages
      if (usage.length > 0) {
        stats.average.apiCalls = Math.round(stats.total.apiCalls / usage.length);
        stats.average.queues = Math.round(stats.total.queues / usage.length);
        stats.average.items = Math.round(stats.total.items / usage.length);
        stats.average.webhooks = Math.round(stats.total.webhooks / usage.length);
      }
      
      return stats;
    } catch (error) {
      logger.error('Error getting usage stats:', error);
      return {
        total: { apiCalls: 0, queues: 0, items: 0, webhooks: 0 },
        average: { apiCalls: 0, queues: 0, items: 0, webhooks: 0 },
        peak: { apiCalls: 0, queues: 0, items: 0, webhooks: 0 },
        days: 0
      };
    }
  }

  /**
   * Check rate limit
   */
  async checkRateLimit(windowMs, maxRequests) {
    try {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const key = `ratelimit:${window}`;
      
      const current = await this.redis.incr(key);
      await this.redis.expire(key, Math.ceil(windowMs / 1000));
      
      return current > maxRequests;
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      return false; // Allow on error
    }
  }

  /**
   * Reset usage for a tenant
   */
  async resetUsage() {
    try {
      const now = Date.now();
      const day = Math.floor(now / (24 * 60 * 60 * 1000));
      
      await this.redis.del(`daily:${day}`);
      logger.info(`Reset usage for tenant ${this.tenantId}`);
    } catch (error) {
      logger.error('Error resetting usage:', error);
    }
  }

  /**
   * Clean up old usage data
   */
  async cleanupOldData(daysToKeep = 30) {
    try {
      const now = Date.now();
      const cutoffDay = Math.floor(now / (24 * 60 * 60 * 1000)) - daysToKeep;
      
      const keys = await this.redis.keys('daily:*');
      const keysToDelete = keys.filter(key => {
        const day = parseInt(key.split(':')[1]);
        return day < cutoffDay;
      });
      
      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
        logger.info(`Cleaned up ${keysToDelete.length} old usage records for tenant ${this.tenantId}`);
      }
    } catch (error) {
      logger.error('Error cleaning up old data:', error);
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    try {
      await this.redis.quit();
    } catch (error) {
      logger.error('Error closing Redis connection:', error);
    }
  }
}

module.exports = { UsageTracker };
