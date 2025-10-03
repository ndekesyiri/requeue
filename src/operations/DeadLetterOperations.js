/**
 * Dead Letter Queue operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const DeadLetterOperations = {
  /**
   * Create a dead letter queue
   * @param {string} sourceQueueId - Source queue ID
   * @param {Object} dlqConfig - Dead letter queue configuration
   */
  async createDeadLetterQueue(sourceQueueId, dlqConfig = {}) {
    ValidationUtils.validateQueueId(sourceQueueId);

    const {
      dlqId = `${sourceQueueId}-dlq`,
      maxSize = 10000,
      retentionDays = 30,
      autoCleanup = true,
      description = `Dead letter queue for ${sourceQueueId}`,
      routingRules = []
    } = dlqConfig;

    try {
      // Execute before hooks
      if (dlqConfig.actions?.beforeAction) {
        await this._executeHooks(
          dlqConfig.actions.beforeAction,
          'beforeAction',
          sourceQueueId,
          { sourceQueueId, dlqConfig },
          'createDeadLetterQueue'
        );
      }

      // Create the DLQ queue
      const dlqQueue = await this.createQueue(dlqId, dlqId, {
        description,
        maxSize,
        retentionDays,
        autoCleanup,
        dlq: true,
        sourceQueue: sourceQueueId,
        routingRules,
        createdAt: new Date().toISOString()
      });

      // Store DLQ configuration
      const dlqConfigKey = `${this.QUEUE_PREFIX}dlq:config:${sourceQueueId}`;
      await this.redis.hset(dlqConfigKey, {
        sourceQueueId,
        dlqId,
        maxSize: maxSize.toString(),
        retentionDays: retentionDays.toString(),
        autoCleanup: autoCleanup.toString(),
        routingRules: JSON.stringify(routingRules),
        createdAt: new Date().toISOString()
      });

      // Execute after hooks
      if (dlqConfig.actions?.afterAction) {
        await this._executeHooks(
          dlqConfig.actions.afterAction,
          'afterAction',
          sourceQueueId,
          dlqQueue,
          'createDeadLetterQueue'
        );
      }

      // Emit DLQ creation event
      this._emitQueueEvent(sourceQueueId, 'dlq:created', {
        sourceQueueId,
        dlqId,
        dlqConfig
      });

      return dlqQueue;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'createDeadLetterQueue', { sourceQueueId, dlqConfig });
    }
  },

  /**
   * Route a failed job to dead letter queue
   * @param {string} sourceQueueId - Source queue ID
   * @param {Object} jobData - Failed job data
   * @param {Object} failureInfo - Failure information
   * @param {Object} options - Routing options
   */
  async routeToDeadLetterQueue(sourceQueueId, jobData, failureInfo, options = {}) {
    ValidationUtils.validateQueueId(sourceQueueId);

    const {
      dlqId = `${sourceQueueId}-dlq`,
      reason = 'max_retries_exceeded',
      retryHistory = null,
      metadata = {}
    } = options;

    try {
      // Check if DLQ exists, create if not
      if (!(await this.queueExists(dlqId))) {
        await this.createDeadLetterQueue(sourceQueueId, {
          dlqId,
          maxSize: 10000,
          retentionDays: 30
        });
      }

      // Create DLQ item
      const dlqItem = {
        id: uuidv4(),
        data: jobData,
        originalQueueId: sourceQueueId,
        originalJobId: jobData.id,
        failureReason: failureInfo.message || 'Unknown error',
        failureType: failureInfo.type || 'error',
        failureStack: failureInfo.stack || '',
        routedAt: new Date().toISOString(),
        status: 'failed',
        retryHistory,
        metadata: {
          ...metadata,
          dlq: true,
          originalQueue: sourceQueueId,
          routingReason: reason
        }
      };

      // Add to DLQ
      await this.addToQueue(dlqId, dlqItem.data, {
        itemId: dlqItem.id,
        metadata: dlqItem.metadata
      });

      // Store routing information
      const routingKey = `${this.QUEUE_PREFIX}dlq:routing:${dlqItem.id}`;
      await this.redis.hset(routingKey, {
        dlqItemId: dlqItem.id,
        sourceQueueId,
        dlqId,
        originalJobId: jobData.id,
        failureReason: dlqItem.failureReason,
        routedAt: dlqItem.routedAt,
        retryHistory: retryHistory ? JSON.stringify(retryHistory) : ''
      });

      // Set expiration for routing info
      await this.redis.pexpire(routingKey, 30 * 24 * 60 * 60 * 1000); // 30 days

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          sourceQueueId,
          dlqItem,
          'routeToDeadLetterQueue'
        );
      }

      // Emit routing event
      this._emitQueueEvent(sourceQueueId, 'job:routed:dlq', {
        sourceQueueId,
        dlqId,
        dlqItemId: dlqItem.id,
        originalJobId: jobData.id,
        failureReason: dlqItem.failureReason
      });

      return dlqItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'routeToDeadLetterQueue', {
        sourceQueueId,
        jobData,
        failureInfo
      });
    }
  },

  /**
   * Get dead letter queue items
   * @param {string} dlqId - Dead letter queue ID
   * @param {Object} options - Query options
   */
  async getDeadLetterItems(dlqId, options = {}) {
    ValidationUtils.validateQueueId(dlqId);

    const {
      limit = 100,
      offset = 0,
      fromTime = null,
      toTime = null,
      failureReason = null,
      originalQueueId = null
    } = options;

    try {
      // Get items from DLQ
      const items = await this.getQueueItems(dlqId, offset, offset + limit - 1);
      
      let filteredItems = items;

      // Apply filters
      if (fromTime || toTime) {
        filteredItems = filteredItems.filter(item => {
          const routedAt = new Date(item.metadata?.routedAt || item.addedAt);
          if (fromTime && routedAt < fromTime) return false;
          if (toTime && routedAt > toTime) return false;
          return true;
        });
      }

      if (failureReason) {
        filteredItems = filteredItems.filter(item => 
          item.metadata?.failureReason?.includes(failureReason)
        );
      }

      if (originalQueueId) {
        filteredItems = filteredItems.filter(item => 
          item.metadata?.originalQueue === originalQueueId
        );
      }

      // Get total count for pagination
      const totalItems = await this.getQueueStats(dlqId);

      return {
        items: filteredItems,
        total: totalItems.itemCount,
        offset,
        limit,
        hasMore: offset + limit < totalItems.itemCount
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getDeadLetterItems', { dlqId, options });
    }
  },

  /**
   * Replay a dead letter queue item back to its original queue
   * @param {string} dlqId - Dead letter queue ID
   * @param {string} itemId - DLQ item ID
   * @param {Object} options - Replay options
   */
  async replayDeadLetterItem(dlqId, itemId, options = {}) {
    ValidationUtils.validateQueueId(dlqId);
    
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }

    const {
      targetQueueId = null,
      modifyData = null,
      retryPolicy = null,
      priority = 0
    } = options;

    try {
      // Get DLQ item
      const dlqItem = await this.getItem(dlqId, itemId);
      
      if (!dlqItem.metadata?.dlq) {
        throw new Error('Item is not a dead letter queue item');
      }

      const originalQueueId = targetQueueId || dlqItem.metadata.originalQueue;
      if (!originalQueueId) {
        throw new Error('Original queue ID not found and no target queue specified');
      }

      // Verify target queue exists
      if (!(await this.queueExists(originalQueueId))) {
        throw new Error(`Target queue ${originalQueueId} does not exist`);
      }

      // Prepare replay data
      const replayData = modifyData ? { ...dlqItem.data, ...modifyData } : dlqItem.data;
      const replayItemId = uuidv4();

      // Create replay item
      const replayItem = {
        id: replayItemId,
        data: replayData,
        addedAt: new Date().toISOString(),
        status: 'pending',
        replayedFrom: dlqId,
        originalDlqItemId: itemId,
        originalJobId: dlqItem.metadata.originalJobId,
        replayCount: (dlqItem.metadata.replayCount || 0) + 1,
        metadata: {
          ...dlqItem.metadata,
          replayed: true,
          replayedAt: new Date().toISOString(),
          replayCount: (dlqItem.metadata.replayCount || 0) + 1
        }
      };

      // Add to target queue
      await this.addToQueue(originalQueueId, replayItem.data, {
        itemId: replayItem.id,
        priority,
        retryPolicy,
        metadata: replayItem.metadata
      });

      // Update DLQ item with replay information
      await this.updateItem(dlqId, itemId, {
        replayed: true,
        replayedAt: new Date().toISOString(),
        replayedTo: originalQueueId,
        replayCount: replayItem.replayCount,
        metadata: {
          ...dlqItem.metadata,
          replayed: true,
          replayedAt: new Date().toISOString(),
          replayedTo: originalQueueId,
          replayCount: replayItem.replayCount
        }
      });

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          originalQueueId,
          replayItem,
          'replayDeadLetterItem'
        );
      }

      // Emit replay event
      this._emitQueueEvent(originalQueueId, 'dlq:item:replayed', {
        dlqId,
        originalQueueId,
        dlqItemId: itemId,
        replayItemId: replayItem.id,
        replayCount: replayItem.replayCount
      });

      return replayItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'replayDeadLetterItem', { dlqId, itemId, options });
    }
  },

  /**
   * Get dead letter queue statistics
   * @param {string} dlqId - Dead letter queue ID
   * @param {Object} options - Query options
   */
  async getDeadLetterStats(dlqId, options = {}) {
    ValidationUtils.validateQueueId(dlqId);

    const {
      fromTime = null,
      toTime = null
    } = options;

    try {
      const items = await this.getDeadLetterItems(dlqId, { limit: 1000 });
      
      let filteredItems = items.items;
      
      // Apply time filter
      if (fromTime || toTime) {
        filteredItems = filteredItems.filter(item => {
          const routedAt = new Date(item.metadata?.routedAt || item.addedAt);
          if (fromTime && routedAt < fromTime) return false;
          if (toTime && routedAt > toTime) return false;
          return true;
        });
      }

      // Calculate statistics
      const totalItems = filteredItems.length;
      const replayedItems = filteredItems.filter(item => item.metadata?.replayed).length;
      const failureReasons = {};
      const originalQueues = {};
      const replayedCounts = {};

      filteredItems.forEach(item => {
        // Failure reason distribution
        const reason = item.metadata?.failureReason || 'Unknown';
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;

        // Original queue distribution
        const originalQueue = item.metadata?.originalQueue || 'Unknown';
        originalQueues[originalQueue] = (originalQueues[originalQueue] || 0) + 1;

        // Replay count distribution
        const replayCount = item.metadata?.replayCount || 0;
        replayedCounts[replayCount] = (replayedCounts[replayCount] || 0) + 1;
      });

      // Recent failures
      const recentFailures = filteredItems
        .sort((a, b) => new Date(b.metadata?.routedAt || b.addedAt) - new Date(a.metadata?.routedAt || a.addedAt))
        .slice(0, 10)
        .map(item => ({
          id: item.id,
          originalQueue: item.metadata?.originalQueue,
          failureReason: item.metadata?.failureReason,
          routedAt: item.metadata?.routedAt || item.addedAt,
          replayed: item.metadata?.replayed || false
        }));

      return {
        totalItems,
        replayedItems,
        unprocessedItems: totalItems - replayedItems,
        replayRate: totalItems > 0 ? (replayedItems / totalItems) * 100 : 0,
        failureReasons,
        originalQueues,
        replayedCounts,
        recentFailures,
        timeRange: {
          from: fromTime?.toISOString(),
          to: toTime?.toISOString()
        }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getDeadLetterStats', { dlqId, options });
    }
  },

  /**
   * Clean up old dead letter queue items
   * @param {string} dlqId - Dead letter queue ID
   * @param {Object} options - Cleanup options
   */
  async cleanupDeadLetterQueue(dlqId, options = {}) {
    ValidationUtils.validateQueueId(dlqId);

    const {
      olderThanDays = 30,
      maxItems = 1000,
      onlyReplayed = false
    } = options;

    try {
      const cutoffTime = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
      const items = await this.getDeadLetterItems(dlqId, { limit: maxItems });
      
      let itemsToDelete = items.items.filter(item => {
        const routedAt = new Date(item.metadata?.routedAt || item.addedAt);
        return routedAt < cutoffTime;
      });

      if (onlyReplayed) {
        itemsToDelete = itemsToDelete.filter(item => item.metadata?.replayed);
      }

      const deletedItems = [];
      
      for (const item of itemsToDelete) {
        try {
          await this.deleteItemFromQueue(dlqId, item.id);
          deletedItems.push(item.id);
        } catch (error) {
          console.error(`QueueManager: Error deleting DLQ item ${item.id}:`, error.message);
        }
      }

      // Emit cleanup event
      this._emitQueueEvent(dlqId, 'dlq:cleaned', {
        dlqId,
        deletedCount: deletedItems.length,
        olderThanDays,
        onlyReplayed
      });

      return {
        deleted: deletedItems.length,
        deletedItems
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cleanupDeadLetterQueue', { dlqId, options });
    }
  },

  /**
   * Get all dead letter queues for a source queue
   * @param {string} sourceQueueId - Source queue ID
   */
  async getDeadLetterQueues(sourceQueueId) {
    ValidationUtils.validateQueueId(sourceQueueId);

    try {
      const pattern = `${this.QUEUE_PREFIX}dlq:config:*`;
      const keys = await this.redis.keys(pattern);
      
      const dlqConfigs = [];
      
      for (const key of keys) {
        const config = await this.redis.hgetall(key);
        if (config.sourceQueueId === sourceQueueId) {
          dlqConfigs.push({
            ...config,
            routingRules: JSON.parse(config.routingRules || '[]'),
            maxSize: parseInt(config.maxSize) || 10000,
            retentionDays: parseInt(config.retentionDays) || 30,
            autoCleanup: config.autoCleanup === 'true'
          });
        }
      }

      return dlqConfigs;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getDeadLetterQueues', { sourceQueueId });
    }
  }
};

module.exports = DeadLetterOperations;

