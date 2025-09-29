/**
 * Batch operations for queue management
 */
const ValidationUtils = require('../utils/ValidationUtils');

const BatchOperations = {
  /**
   * Bulk update item status
   */
  async bulkUpdateItemStatus(queueId, itemIds, newStatus, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw new Error('Item IDs must be a non-empty array');
    }
    
    if (!newStatus || typeof newStatus !== 'string') {
      throw new Error('New status must be a non-empty string');
    }

    try {
      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      // Process items in batches to avoid overwhelming the system
      const batchSize = options.batchSize || 10;
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (itemId) => {
          try {
            await this.updateItem(queueId, itemId, { 
              status: newStatus,
              updatedAt: new Date().toISOString()
            });
            results.successful++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              itemId,
              error: error.message
            });
          }
        });

        await Promise.all(batchPromises);
        
        // Small delay between batches to prevent overwhelming
        if (i + batchSize < itemIds.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      return results;
    } catch (error) {
      console.error(`QueueManager: Error in bulk update for queue ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Bulk delete items from queue
   */
  async bulkDeleteItems(queueId, itemIds, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw new Error('Item IDs must be a non-empty array');
    }

    try {
      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      // Process items in batches
      const batchSize = options.batchSize || 10;
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (itemId) => {
          try {
            await this.deleteItemFromQueue(queueId, itemId);
            results.successful++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              itemId,
              error: error.message
            });
          }
        });

        await Promise.all(batchPromises);
        
        // Small delay between batches
        if (i + batchSize < itemIds.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      return results;
    } catch (error) {
      console.error(`QueueManager: Error in bulk delete for queue ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Bulk add items to queue
   */
  async bulkAddItems(queueId, items, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Items must be a non-empty array');
    }

    try {
      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        addedItems: []
      };

      // Process items in batches
      const batchSize = options.batchSize || 10;
      
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (item) => {
          try {
            const addedItem = await this.addToQueue(queueId, item, options);
            results.successful++;
            results.addedItems.push(addedItem);
          } catch (error) {
            results.failed++;
            results.errors.push({
              item: item,
              error: error.message
            });
          }
        });

        await Promise.all(batchPromises);
        
        // Small delay between batches
        if (i + batchSize < items.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      return results;
    } catch (error) {
      console.error(`QueueManager: Error in bulk add for queue ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Get all items from queue
   */
  async getQueueItems(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Get items from cache or Redis without removing them
      const items = await this._getAllQueueItemsFromCacheOrRedis(queueId);
      
      if (!Array.isArray(items)) {
        return [];
      }

      // Apply filters if provided
      if (options.filter) {
        return items.filter(options.filter);
      }

      // Apply sorting if provided
      if (options.sortBy) {
        return items.sort((a, b) => {
          const aVal = this._getNestedValue(a, options.sortBy);
          const bVal = this._getNestedValue(b, options.sortBy);
          
          if (options.sortOrder === 'desc') {
            return bVal > aVal ? 1 : -1;
          }
          return aVal > bVal ? 1 : -1;
        });
      }

      return items;
    } catch (error) {
      console.error(`QueueManager: Error getting queue items for ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Get queue information
   */
  async getQueue(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const queue = await this._getQueueFromCacheOrRedis(queueId);
      return queue;
    } catch (error) {
      console.error(`QueueManager: Error getting queue ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Helper method to get nested values from objects
   * @private
   */
  _getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
};

module.exports = BatchOperations;
