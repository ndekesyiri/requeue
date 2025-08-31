const ValidationUtils = require('../utils/ValidationUtils');

const PopOperations = {

  /**
   * Pop the next item from the queue and remove it, use when running processors or executions
   * @params {string} queueId the queue identifier
   */
  async popFromQueue(queueId, options = {}) {
    // First off validation
    ValidationUtils.validateQueueId(queueId);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId }, 'popFromQueue');
      }

      // Ensure that the queue with that id exists
      await this._getQueueFromCacheOrRedis(queueId);
      // Should be
      const popItems = await this._getPopQueueItemFromCacheOrRedis(queueId)

      if (popItems) {
        // Emit event
        this._emitQueueEvent(queueId, 'item:popped', {
          queueId,
          item: popItems
        });
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          { queueId }, 'popFromQueue');
      }

      return popItems;
    } catch (error) {
      console.error(`QueueManager: Error OPERATION from queue ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
  * Pop multiple items from the queue, with support for hooks
  * @param {string} queueId - Queue identifier
  * @param {number} count - Number of items to pop (default: 1, max: 100)
  * @param {Object} options - Options including hooks
  */
  async popBatchFromQueue(queueId, count = 1, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error('Count must be an integer between 1 and 100');
    }
    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, count }, 'popBatchFromQueue');
      }

      // Ensure queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const poppedItems = [];

      if (this.cacheConfig.enabled && this.itemsCache.has(queueId)) {
        const cachedItems = this.itemsCache.get(queueId) || [];
        const itemsToTake = Math.min(count, cachedItems.length);

        // Pop items from the front (oldest first for FIFO)
        for (let i = 0; i < itemsToTake; i++) {
          const item = cachedItems.shift();
          if (item) poppedItems.push(item);
        }

        // Update cache
        this._updateCache(queueId, null, cachedItems);
        await this._updateQueueItemCount(queueId, cachedItems.length);

        // Handle write strategies
        if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
          await this._syncItemsToRedis(queueId, cachedItems);
        } else if (this.cacheConfig.strategy === 'write-back') {
          this.pendingWrites.add(`items:${queueId}`);
        }
      } else {
        // Direct Redis operations using pipeline for efficiency
        const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
        const pipeline = this.redis.pipeline();

        for (let i = 0; i < count; i++) {
          pipeline.rpop(itemsKey); // Pop from end (oldest first)
        }

        const results = await pipeline.exec();

        for (const [error, result] of results) {
          if (error) throw error;
          if (result) {
            try {
              poppedItems.push(JSON.parse(result));
            } catch (parseError) {
              console.warn(`QueueManager: Failed to parse popped item:`, parseError.message);
            }
          }
        }
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          { queueId, poppedItems }, 'popBatchFromQueue');
      }

      // Emit batch popped event
      if (poppedItems.length > 0) {
        this._emitQueueEvent(queueId, 'items:batch:popped', {
          queueId,
          items: poppedItems,
          count: poppedItems.length
        });
      }

      return poppedItems;
    } catch (error) {
      console.error(`QueueManager: Error popping batch from queue ${queueId}:`, error.message);
      throw error;
    }
  }


}

module.exports = PopOperations;