const ValidationUtils = require('../utils/ValidationUtils');
const { v4: uuidv4 } = require('uuid');

const ItemOperations = {
  
    /**
 * Add item to queue with before/after hooks
 * @param {string} queueId - Queue identifier
 * @param {Object} item - Item to add
 * @param {Object} options - Options including hooks
 */
  async addToQueue(queueId, item, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (item === undefined || item === null) {
      throw new Error('Item cannot be null or undefined');
    }

    const itemId = uuidv4();
    const timestamp = new Date().toISOString();

    try {
      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const queueItem = {
        id: itemId,
        data: item,
        addedAt: timestamp,
        status: 'pending',
        version: '2.0'
      };

      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId, queueItem, 'addToQueue');
      }

      // Get current items from cache or Redis
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      const updatedItems = [queueItem, ...currentItems]; // Add to front (newest first)

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
        await this.redis.lpush(itemsKey, JSON.stringify(queueItem));
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Update queue item count
      await this._updateQueueItemCount(queueId, updatedItems.length);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId, queueItem, 'addToQueue');
      }

      // Emit item added event
      this._emitQueueEvent(queueId, 'item:added', {
        queueId,
        item: queueItem
      });

      return queueItem;
    } catch (error) {
      console.error(`QueueManager: Error adding item to queue ${queueId}:`, error.message);

      this._emitQueueEvent(queueId, 'item:add:error', {
        queueId,
        item,
        error: error.message
      });

      throw error;
    }
  },

    /**
   * Update item properties with hooks
   */
  async updateItem(queueId, itemId, updates, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }
    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, itemId, updates }, 'updateItem');
      }

      await this._getQueueFromCacheOrRedis(queueId); // Verify queue exists

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      const itemIndex = currentItems.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item with ID ${itemId} not found in queue ${queueId}`);
      }

      // Apply updates with timestamp and version tracking
      const originalItem = currentItems[itemIndex];
      const updatedItem = {
        ...originalItem,
        ...updates,
        updatedAt: new Date().toISOString(),
        version: originalItem.version || '1.0'
      };

      // Update the items array
      const updatedItems = [...currentItems];
      updatedItems[itemIndex] = updatedItem;

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          updatedItem, 'updateItem');
      }

      // Emit item updated event
      this._emitQueueEvent(queueId, 'item:updated', {
        queueId,
        itemId,
        updates,
        updatedItem,
        originalItem
      });

      return updatedItem;
    } catch (error) {
      console.error(`QueueManager: Error updating item ${itemId} in queue ${queueId}:`, error.message);
      throw error;
    }
  },

  
  /**
 * Delete item from queue, hooks integration
 * @param {string} queueId - Queue identifier
 * @param {string} itemId - Item identifier
 */
  async deleteItemFromQueue(queueId, itemId, options = {}) {
    // validation
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId, { queueId, itemId }, 'deleteItemFromQueue');
      }
      await this._getQueueFromCacheOrRedis(queueId); // verify queue exits

      // get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);

      // find and remove the items
      const itemIndex = currentItems.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item with ID ${itemId} not found in queue ${queueId}`);
      }

      const deletedItem = { ...currentItems[itemIndex] }; // create copy
      const updatedItems = currentItems.filter(item => item.id !== itemId);

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // update cache
      this._updateCache(queueId, null, updatedItems);

      // now update the queue item count
      await this._updateQueueItemCount(queueId, updatedItems.length);

      // execute the after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          deletedItem, 'deleteItemFromQueue');
      }

      // Emit item deleted event
      this._emitQueueEvent(queueId, 'item:deleted', {
        queueId,
        deletedItem
      });

      return deletedItem;
    } catch (error) {
      console.error(`QueueManager: Error deleting item with id ${itemId} from queue with id ${queueId}`, error.message);
      throw error;
    }
  },

  /**
   * Get a single item by ID with hooks
   */
  async getItem(queueId, itemId, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, itemId }, 'getItem');
      }

      await this._getQueueFromCacheOrRedis(queueId); // Verify queue exists

      // Get all items and find the specific one
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      const item = items.find(item => item.id === itemId);

      if (!item) {
        throw new Error(`Item with ID ${itemId} not found in queue ${queueId}`);
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          item, 'getItem');
      }

      return { ...item }; // Return copy to prevent mutations
    } catch (error) {
      console.error(`QueueManager: Error getting item ${itemId} from queue ${queueId}:`, error.message);
      throw error;
    }
  },
  
  
    /**
   * Get items from queue
   * @param {string} queueId - Queue identifier
   * @param {number} start - Start index (default: 0)
   * @param {number} end - End index (default: -1 for all)
   */
  async getQueueItems(queueId, start = 0, end = -1, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue Id must be a non-empty string');
    }
    
    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, start, end }, 'getQueueItems');
      }

      await this._getQueueFromCacheOrRedis(queueId); // Verify queue exists
      const items = await this._getQueueItemsFromCacheOrRedis(queueId, start, end);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          { queueId, items }, 'getQueueItems');
      }

      return items;
    } catch (error) {
      console.error(`QueueManager: Error getting items from queue with id: ${queueId}: `, error.message);
      throw error;
    }
  }
  
  
}

module.exports = ItemOperations;
