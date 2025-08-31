const SearchOperations = {

  /**
   * Find item in queue using predicate function with hooks
   * @param {string} queueId - Queue identifier  
   * @param {Function} predicate - Function to test each item
   * @param {Object} options - Options including hooks
   */
  async findItem(queueId, predicate, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (typeof predicate !== 'function') {
      throw new Error('Predicate must be a function');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, predicate: predicate.toString() }, 'findItem');
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      // Get all items
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);

      let foundItem = null;
      let foundIndex = -1;

      // Search for item using predicate
      for (let i = 0; i < items.length; i++) {
        try {
          if (predicate(items[i], i, items)) {
            foundItem = { ...items[i] }; // Return copy to prevent mutations
            foundIndex = i;
            break;
          }
        } catch (predicateError) {
          console.warn(`QueueManager: Predicate error at index ${i}:`, predicateError.message);
          continue;
        }
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          { queueId, foundItem, foundIndex }, 'findItem');
      }

      // Emit find event
      this._emitQueueEvent(queueId, 'item:found', {
        queueId,
        foundItem,
        foundIndex,
        searchCompleted: true
      });

      return foundItem;
    } catch (error) {
      console.error(`QueueManager: Error finding item in queue ${queueId}:`, error.message);
      throw error;
    }
  },


  /**
   * Filter items in queue using predicate function with hooks
   * @param {string} queueId - Queue identifier
   * @param {Function} predicate - Function to test each item  
   * @param {Object} options - Options including hooks and limits
   */
  async filterItems(queueId, predicate, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (typeof predicate !== 'function') {
      throw new Error('Predicate must be a function');
    }

    const { limit = null, includeIndices = false } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, predicate: predicate.toString(), options }, 'filterItems');
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      // Get all items
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);

      const filteredResults = [];
      let processedCount = 0;

      // Filter items using predicate
      for (let i = 0; i < items.length; i++) {
        try {
          if (predicate(items[i], i, items)) {
            const result = includeIndices
              ? { item: { ...items[i] }, index: i }
              : { ...items[i] };

            filteredResults.push(result);

            // Check limit
            if (limit && filteredResults.length >= limit) {
              break;
            }
          }
          processedCount++;
        } catch (predicateError) {
          console.warn(`QueueManager: Predicate error at index ${i}:`, predicateError.message);
          continue;
        }
      }

      const result = {
        items: filteredResults,
        totalProcessed: processedCount,
        totalMatched: filteredResults.length,
        limitReached: limit ? filteredResults.length >= limit : false
      };

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          { queueId, result }, 'filterItems');
      }

      // Emit filter event
      this._emitQueueEvent(queueId, 'items:filtered', {
        queueId,
        matchCount: result.totalMatched,
        processedCount: result.totalProcessed,
        limitReached: result.limitReached
      });

      return result;
    } catch (error) {
      console.error(`QueueManager: Error filtering items in queue ${queueId}:`, error.message);
      throw error;
    }
  }


}

module.exports = SearchOperations;