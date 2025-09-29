/**
 * Queue Service
 * Multi-tenant queue management service
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../api/middleware/logger');

class QueueService {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      keyPrefix: `tenant:${tenantId}:`
    });
  }

  /**
   * Create a new queue
   */
  async createQueue({ name, description, settings = {} }) {
    try {
      const queueId = uuidv4();
      const queueKey = `queue:${queueId}`;
      const queueData = {
        id: queueId,
        name,
        description: description || '',
        tenantId: this.tenantId,
        settings: {
          maxRetries: settings.maxRetries || 3,
          retryDelay: settings.retryDelay || 5000,
          visibilityTimeout: settings.visibilityTimeout || 30000,
          deadLetterQueue: settings.deadLetterQueue || null,
          ...settings
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store queue metadata
      await this.redis.hset(queueKey, queueData);
      
      // Add to tenant's queue list
      await this.redis.sadd('queues', queueId);
      
      // Set expiration for queue metadata (optional)
      if (settings.ttl) {
        await this.redis.expire(queueKey, settings.ttl);
      }

      logger.info(`Created queue ${queueId} for tenant ${this.tenantId}`);
      return queueData;
    } catch (error) {
      logger.error('Error creating queue:', error);
      throw error;
    }
  }

  /**
   * Get all queues for tenant
   */
  async getQueues({ page = 1, limit = 20, search } = {}) {
    try {
      const queueIds = await this.redis.smembers('queues');
      const queues = [];
      
      for (const queueId of queueIds) {
        const queueData = await this.redis.hgetall(`queue:${queueId}`);
        if (queueData && Object.keys(queueData).length > 0) {
          // Apply search filter
          if (search) {
            const searchLower = search.toLowerCase();
            const nameMatch = queueData.name?.toLowerCase().includes(searchLower);
            const descMatch = queueData.description?.toLowerCase().includes(searchLower);
            if (!nameMatch && !descMatch) continue;
          }
          
          queues.push({
            id: queueData.id,
            name: queueData.name,
            description: queueData.description,
            settings: JSON.parse(queueData.settings || '{}'),
            createdAt: queueData.createdAt,
            updatedAt: queueData.updatedAt
          });
        }
      }

      // Sort by creation date (newest first)
      queues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedQueues = queues.slice(startIndex, endIndex);

      return {
        queues: paginatedQueues,
        total: queues.length
      };
    } catch (error) {
      logger.error('Error getting queues:', error);
      throw error;
    }
  }

  /**
   * Get queue by ID
   */
  async getQueue(queueId) {
    try {
      const queueData = await this.redis.hgetall(`queue:${queueId}`);
      
      if (!queueData || Object.keys(queueData).length === 0) {
        return null;
      }

      return {
        id: queueData.id,
        name: queueData.name,
        description: queueData.description,
        settings: JSON.parse(queueData.settings || '{}'),
        createdAt: queueData.createdAt,
        updatedAt: queueData.updatedAt
      };
    } catch (error) {
      logger.error('Error getting queue:', error);
      throw error;
    }
  }

  /**
   * Update queue
   */
  async updateQueue(queueId, updates) {
    try {
      const queueKey = `queue:${queueId}`;
      const existingQueue = await this.redis.hgetall(queueKey);
      
      if (!existingQueue || Object.keys(existingQueue).length === 0) {
        return null;
      }

      const updatedData = {
        ...existingQueue,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      if (updates.settings) {
        updatedData.settings = JSON.stringify(updates.settings);
      }

      await this.redis.hset(queueKey, updatedData);
      
      logger.info(`Updated queue ${queueId} for tenant ${this.tenantId}`);
      return {
        id: updatedData.id,
        name: updatedData.name,
        description: updatedData.description,
        settings: JSON.parse(updatedData.settings || '{}'),
        createdAt: updatedData.createdAt,
        updatedAt: updatedData.updatedAt
      };
    } catch (error) {
      logger.error('Error updating queue:', error);
      throw error;
    }
  }

  /**
   * Delete queue
   */
  async deleteQueue(queueId) {
    try {
      const queueKey = `queue:${queueId}`;
      const itemsKey = `items:${queueId}`;
      
      // Check if queue exists
      const exists = await this.redis.exists(queueKey);
      if (!exists) {
        return false;
      }

      // Delete queue metadata
      await this.redis.del(queueKey);
      
      // Delete all items in the queue
      await this.redis.del(itemsKey);
      
      // Remove from tenant's queue list
      await this.redis.srem('queues', queueId);
      
      logger.info(`Deleted queue ${queueId} for tenant ${this.tenantId}`);
      return true;
    } catch (error) {
      logger.error('Error deleting queue:', error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueId) {
    try {
      const queueKey = `queue:${queueId}`;
      const itemsKey = `items:${queueId}`;
      
      // Check if queue exists
      const exists = await this.redis.exists(queueKey);
      if (!exists) {
        return null;
      }

      // Get all items
      const items = await this.redis.lrange(itemsKey, 0, -1);
      const parsedItems = items.map(item => JSON.parse(item));

      // Calculate statistics
      const stats = {
        queueId,
        items: {
          total: parsedItems.length,
          pending: parsedItems.filter(item => item.status === 'pending').length,
          processing: parsedItems.filter(item => item.status === 'processing').length,
          completed: parsedItems.filter(item => item.status === 'completed').length,
          failed: parsedItems.filter(item => item.status === 'failed').length
        },
        performance: {
          avgProcessingTime: this.calculateAvgProcessingTime(parsedItems),
          throughput: this.calculateThroughput(parsedItems)
        }
      };

      return stats;
    } catch (error) {
      logger.error('Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Calculate average processing time
   */
  calculateAvgProcessingTime(items) {
    const completedItems = items.filter(item => 
      item.status === 'completed' && 
      item.processingStartedAt && 
      item.processingCompletedAt
    );

    if (completedItems.length === 0) return 0;

    const totalTime = completedItems.reduce((sum, item) => {
      const start = new Date(item.processingStartedAt);
      const end = new Date(item.processingCompletedAt);
      return sum + (end - start);
    }, 0);

    return totalTime / completedItems.length;
  }

  /**
   * Calculate throughput (items per hour)
   */
  calculateThroughput(items) {
    const completedItems = items.filter(item => 
      item.status === 'completed' && 
      item.processingCompletedAt
    );

    if (completedItems.length === 0) return 0;

    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    
    const recentItems = completedItems.filter(item => 
      new Date(item.processingCompletedAt) > oneHourAgo
    );

    return recentItems.length;
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

module.exports = { QueueService };
