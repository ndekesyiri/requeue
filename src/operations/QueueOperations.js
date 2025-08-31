/**
 * Basic queue CRUD operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const QueueOperations = {
  /**
   * Create a new queue with hooks
   */
  async createQueue(name, queueId, config = {}, options = {}) {
    // Validation
    ValidationUtils.validateQueueId(name, 'Queue name');
    ValidationUtils.validateQueueId(queueId);
    ValidationUtils.validateQueueConfig(config);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction, 
          'beforeAction', 
          queueId,
          { name, queueId, config }, 
          'createQueue'
        );
      }

      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      const timestamp = new Date().toISOString();

      const queueMetadata = {
        id: queueId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        itemCount: '0',
        version: '2.0',
        ...config
      };

      // Check if queue exists
      let exists = false;
      if (this.cache.has('queue', queueId)) {
        exists = true;
      } else {
        exists = await this.redis.exists(queueKey);
      }

      if (exists) {
        throw new Error(`Queue with ID ${queueId} already exists`);
      }

      // Use pipeline for atomic operations
      const commands = [
        { command: 'hset', args: [queueKey, queueMetadata] },
        { command: 'del', args: [`${this.QUEUE_ITEMS_PREFIX}${queueId}`] }
      ];

      await this.redis.executePipeline(commands);

      // Convert itemCount back to number for cache
      queueMetadata.itemCount = 0;
      
      // Update cache
      this._updateCache(queueId, queueMetadata, []);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction, 
          'afterAction', 
          queueId, 
          queueMetadata, 
          'createQueue'
        );
      }

      // Emit creation event
      this._emitQueueEvent(queueId, 'queue:created', {
        queueId,
        name,
        config: queueMetadata
      });

      return queueMetadata;

    } catch (error) {
      const handledError = this.errorHandlers.handleError(error, 'createQueue', {
        queueId,
        name,
        config
      });

      this._emitQueueEvent(queueId, 'queue:create:error', {
        queueId,
        name,
        config,
        error: handledError.message
      });

      throw handledError;
    }
  },

  /**
   * Get queue details
   */
  async getQueue(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      return await this._getQueueFromCacheOrRedis(queueId);
    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getQueue', { queueId });
    }
  },

  /**
   * Get all queues with pagination and filtering
   */
  async getAllQueues(options = {}) {
    const { limit = 100, offset = 0, pattern = '*' } = options;

    try {
      const allQueues = [];

      if (this.cache.config.enabled) {
        // Get cached queues first
        const queueCache = this.cache.queueCache;
        if (queueCache) {
          for (const [queueId, queueData] of queueCache.entries()) {
            // Update item count from cache if available
            const cachedItems = this.cache.get('items', queueId);
            if (cachedItems) {
              queueData.itemCount = cachedItems.length;
            }
            allQueues.push(queueData);
          }
        }

        // Get remaining queues from Redis
        const searchPattern = `${this.QUEUE_META_PREFIX}${pattern}`;
        const keys = await this.redis.keys(searchPattern);

        for (const key of keys) {
          const queueId = key.replace(this.QUEUE_META_PREFIX, '');

          // Skip if already in cache
          if (this.cache.has('queue', queueId)) continue;

          const queueData = await this.redis.hgetall(key);
          if (Object.keys(queueData).length > 0) {
            // Get current item count
            const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
            const itemCount = await this.redis.llen(itemsKey);
            queueData.itemCount = parseInt(itemCount) || 0;

            allQueues.push(queueData);

            // Cache for future access
            this.cache.set('queue', queueId, queueData);
          }
        }
      } else {
        // Non-cached version
        const searchPattern = `${this.QUEUE_META_PREFIX}${pattern}`;
        const keys = await this.redis.keys(searchPattern);

        for (const key of keys) {
          const queueData = await this.redis.hgetall(key);
          if (Object.keys(queueData).length > 0) {
            // Get current item count
            const queueId = queueData.id;
            const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
            const itemCount = await this.redis.llen(itemsKey);
            queueData.itemCount = parseInt(itemCount) || 0;

            allQueues.push(queueData);
          }
        }
      }

      // Apply pagination
      const startIndex = offset;
      const endIndex = offset + limit;
      const paginatedQueues = allQueues.slice(startIndex, endIndex);

      return {
        queues: paginatedQueues,
        total: allQueues.length,
        offset,
        limit,
        hasMore: endIndex < allQueues.length
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getAllQueues', { options });
    }
  },

  /**
   * Update queue configuration with hooks
   */
  async updateQueue(queueId, updates, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    ValidationUtils.validateUpdates(updates);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction, 
          'beforeAction', 
          queueId,
          { queueId, updates }, 
          'updateQueue'
        );
      }

      // Verify queue exists
      const existingQueue = await this._getQueueFromCacheOrRedis(queueId);

      // Add timestamp and version tracking
      const updatedUpdates = {
        ...updates,
        updatedAt: new Date().toISOString(),
        version: existingQueue.version || '1.0'
      };

      const updatedQueue = { ...existingQueue, ...updatedUpdates };

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
        // Convert numbers to strings for Redis
        const redisUpdates = {};
        for (const [key, value] of Object.entries(updatedUpdates)) {
          redisUpdates[key] = typeof value === 'number' ? value.toString() : value;
        }
        await this.redis.hset(queueKey, redisUpdates);
      }

      // Update cache
      this._updateCache(queueId, updatedQueue);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction, 
          'afterAction', 
          queueId,
          updatedQueue, 
          'updateQueue'
        );
      }

      // Emit update event
      this._emitQueueEvent(queueId, 'queue:updated', {
        queueId,
        updates: updatedUpdates,
        queue: updatedQueue
      });

      return updatedQueue;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'updateQueue', { queueId, updates });
    }
  },

  /**
   * Delete a queue and all its items with hooks
   */
  async deleteQueue(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction, 
          'beforeAction', 
          queueId,
          { queueId }, 
          'deleteQueue'
        );
      }

      // Verify queue exists
      const queueData = await this._getQueueFromCacheOrRedis(queueId);

      // Atomic deletion using pipeline
      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;

      const commands = [
        { command: 'del', args: [queueKey] },
        { command: 'del', args: [itemsKey] }
      ];

      await this.redis.executePipeline(commands);

      // Remove from cache
      this._removeFromCache(queueId);

      // Clean up queue-specific listeners
      this.events.removeQueueListener(queueId);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction, 
          'afterAction', 
          queueId,
          queueData, 
          'deleteQueue'
        );
      }

      // Emit deletion event
      this._emitQueueEvent(queueId, 'queue:deleted', {
        queueId,
        deletedQueue: queueData
      });

      return { success: true, deletedQueue: queueData };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'deleteQueue', { queueId });
    }
  },

  /**
   * Get statistics for a specific queue
   */
  async getQueueStats(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const queue = await this._getQueueFromCacheOrRedis(queueId);
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);

      // Calculate additional statistics
      const now = new Date();
      const createdAt = new Date(queue.createdAt);
      const ageInHours = (now - createdAt) / (1000 * 60 * 60);

      // Item status breakdown
      const statusBreakdown = items.reduce((acc, item) => {
        const status = item.status || 'unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      // Recent activity (items added in last hour)
      const recentItems = items.filter(item => {
        const addedAt = new Date(item.addedAt);
        return (now - addedAt) <= (1000 * 60 * 60);
      });

      return {
        id: queueId,
        name: queue.name,
        itemCount: items.length,
        createdAt: queue.createdAt,
        updatedAt: queue.updatedAt,
        ageInHours: Math.round(ageInHours * 100) / 100,
        statusBreakdown,
        recentActivity: {
          itemsAddedLastHour: recentItems.length,
          lastItemAdded: items.length > 0 ? items[0].addedAt : null
        },
        cacheInfo: {
          cacheEnabled: this.cache.config.enabled,
          inCache: this.cache.has('queue', queueId),
          itemsInCache: this.cache.has('items', queueId)
        },
        performance: {
          cacheHitRate: this.cache.stats.hits / (this.cache.stats.hits + this.cache.stats.misses) || 0
        },
        config: queue
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getQueueStats', { queueId });
    }
  },

  /**
   * Check if queue exists
   */
  async queueExists(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Check cache first
      if (this.cache.has('queue', queueId)) {
        return true;
      }

      // Check Redis
      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      const exists = await this.redis.exists(queueKey);
      return exists > 0;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'queueExists', { queueId });
    }
  },

  /**
   * Get queue names (lightweight operation)
   */
  async getQueueNames(pattern = '*') {
    try {
      const searchPattern = `${this.QUEUE_META_PREFIX}${pattern}`;
      const keys = await this.redis.keys(searchPattern);
      
      return keys.map(key => key.replace(this.QUEUE_META_PREFIX, ''));

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getQueueNames', { pattern });
    }
  },

  /**
   * Rename a queue
   */
  async renameQueue(oldQueueId, newQueueId, options = {}) {
    ValidationUtils.validateQueueId(oldQueueId, 'Old queue ID');
    ValidationUtils.validateQueueId(newQueueId, 'New queue ID');

    if (oldQueueId === newQueueId) {
      throw new Error('Old and new queue IDs cannot be the same');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction, 
          'beforeAction', 
          oldQueueId,
          { oldQueueId, newQueueId }, 
          'renameQueue'
        );
      }

      // Check if old queue exists and new queue doesn't exist
      const oldExists = await this.queueExists(oldQueueId);
      const newExists = await this.queueExists(newQueueId);

      if (!oldExists) {
        throw new Error(`Queue with ID ${oldQueueId} does not exist`);
      }

      if (newExists) {
        throw new Error(`Queue with ID ${newQueueId} already exists`);
      }

      // Get old queue data and items
      const oldQueueData = await this._getQueueFromCacheOrRedis(oldQueueId);
      const oldItems = await this._getQueueItemsFromCacheOrRedis(oldQueueId);

      // Create new queue with same data but new ID
      const newQueueData = {
        ...oldQueueData,
        id: newQueueId,
        updatedAt: new Date().toISOString(),
        renamedFrom: oldQueueId
      };

      // Use pipeline for atomic rename
      const oldQueueKey = `${this.QUEUE_META_PREFIX}${oldQueueId}`;
      const oldItemsKey = `${this.QUEUE_ITEMS_PREFIX}${oldQueueId}`;
      const newQueueKey = `${this.QUEUE_META_PREFIX}${newQueueId}`;
      const newItemsKey = `${this.QUEUE_ITEMS_PREFIX}${newQueueId}`;

      const commands = [
        // Create new queue
        { command: 'hset', args: [newQueueKey, newQueueData] },
        // Delete old queue
        { command: 'del', args: [oldQueueKey] },
        { command: 'del', args: [oldItemsKey] }
      ];

      // Add items to new queue if any exist
      if (oldItems.length > 0) {
        const serializedItems = oldItems.map(item => JSON.stringify(item));
        commands.splice(1, 0, { 
          command: 'rpush', 
          args: [newItemsKey, ...serializedItems.reverse()] 
        });
      }

      await this.redis.executePipeline(commands);

      // Update caches
      this._removeFromCache(oldQueueId);
      this._updateCache(newQueueId, newQueueData, oldItems);

      // Move queue-specific listeners
      if (this.events.queueListeners.has(oldQueueId)) {
        const oldListener = this.events.queueListeners.get(oldQueueId);
        this.events.queueListeners.set(newQueueId, oldListener);
        this.events.queueListeners.delete(oldQueueId);
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction, 
          'afterAction', 
          newQueueId,
          { oldQueueId, newQueueId, newQueueData }, 
          'renameQueue'
        );
      }

      // Emit rename events
      this._emitQueueEvent(oldQueueId, 'queue:renamed:out', {
        oldQueueId,
        newQueueId,
        newQueueData
      });

      this._emitQueueEvent(newQueueId, 'queue:renamed:in', {
        oldQueueId,
        newQueueId,
        newQueueData
      });

      return {
        success: true,
        oldQueueId,
        newQueueId,
        newQueueData,
        itemsMoved: oldItems.length
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'renameQueue', { oldQueueId, newQueueId });
    }
  }
};

module.exports = QueueOperations;