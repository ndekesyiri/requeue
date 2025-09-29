/**
 * Statistics and monitoring operations
 */
const ValidationUtils = require('../utils/ValidationUtils');

const StatsOperations = {
  /**
   * Get comprehensive queue statistics
   */
  async getQueueStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Get queue metadata
      const queue = await this._getQueueFromCacheOrRedis(queueId);
      
      // Get items from cache or Redis
      const items = await this._getAllQueueItemsFromCacheOrRedis(queueId);
      const allItems = Array.isArray(items) ? items : [];

      // Calculate statistics
      const stats = {
        queue: {
          id: queueId,
          name: queue.name,
          createdAt: queue.createdAt,
          itemCount: allItems.length,
          version: queue.version || '2.0'
        },
        items: {
          total: allItems.length,
          statusBreakdown: this._calculateStatusBreakdown(allItems),
          priorityBreakdown: this._calculatePriorityBreakdown(allItems),
          ageDistribution: this._calculateAgeDistribution(allItems)
        },
        performance: {
          cacheEnabled: this.cache.config.enabled,
          cacheHitRate: this.cache.stats ? (this.cache.stats.hits / (this.cache.stats.hits + this.cache.stats.misses) * 100) : 0,
          lastUpdated: new Date().toISOString()
        }
      };

      return stats;
    } catch (error) {
      console.error(`QueueManager: Error getting queue stats for ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const cacheStats = this.cache.getStats();
    
    return {
      enabled: this.cache.config.enabled,
      strategy: this.cache.config.strategy,
      stats: {
        queueCacheSize: cacheStats.queueCacheSize || 0,
        itemsCacheSize: cacheStats.itemsCacheSize || 0,
        hitRate: cacheStats.hitRate || 0,
        pendingWrites: cacheStats.pendingWrites || 0
      },
      performance: {
        totalOperations: cacheStats.totalOperations || 0,
        errorRate: cacheStats.errorRate || 0,
        syncOperations: cacheStats.syncOperations || 0
      }
    };
  },

  /**
   * Health check for the system
   */
  async healthCheck() {
    const startTime = Date.now();
    
    try {
      // Check Redis connection
      const redisStatus = await this.redis.healthCheck();
      
      // Check cache health
      const cacheHealth = this.cache.healthCheck();
      
      // Check memory usage
      const memoryUsage = process.memoryUsage();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: redisStatus.status === 'healthy' && cacheHealth.status === 'healthy' ? 'healthy' : 'degraded',
        responseTime,
        timestamp: new Date().toISOString(),
        redis: redisStatus,
        cache: cacheHealth,
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024) // MB
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  },

  /**
   * Calculate status breakdown for items
   * @private
   */
  _calculateStatusBreakdown(items) {
    const breakdown = {};
    
    items.forEach(item => {
      const status = item.status || 'pending';
      breakdown[status] = (breakdown[status] || 0) + 1;
    });
    
    return breakdown;
  },

  /**
   * Calculate priority breakdown for items
   * @private
   */
  _calculatePriorityBreakdown(items) {
    const breakdown = {};
    
    items.forEach(item => {
      const priority = item.data?.priority || 'normal';
      breakdown[priority] = (breakdown[priority] || 0) + 1;
    });
    
    return breakdown;
  },

  /**
   * Calculate age distribution for items
   * @private
   */
  _calculateAgeDistribution(items) {
    const now = Date.now();
    const distribution = {
      '0-1h': 0,
      '1-6h': 0,
      '6-24h': 0,
      '1-7d': 0,
      '7d+': 0
    };
    
    items.forEach(item => {
      const createdAt = new Date(item.createdAt || item.timestamp).getTime();
      const ageHours = (now - createdAt) / (1000 * 60 * 60);
      
      if (ageHours < 1) distribution['0-1h']++;
      else if (ageHours < 6) distribution['1-6h']++;
      else if (ageHours < 24) distribution['6-24h']++;
      else if (ageHours < 168) distribution['1-7d']++;
      else distribution['7d+']++;
    });
    
    return distribution;
  }
};

module.exports = StatsOperations;
