/**
 * Priority-based queue operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const PriorityOperations = {
  /**
   * Add item to queue with priority
   * @param {string} queueId - Queue ID
   * @param {Object} item - Item data
   * @param {Object} options - Options including priority
   */
  async addToQueueWithPriority(queueId, item, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (item === undefined || item === null) {
      throw new Error('Item cannot be null or undefined');
    }

    const {
      priority = 0,
      priorityWeight = 1,
      maxPriority = 10,
      minPriority = -10
    } = options;

    // Validate priority
    if (typeof priority !== 'number' || priority < minPriority || priority > maxPriority) {
      throw new Error(`Priority must be a number between ${minPriority} and ${maxPriority}`);
    }

    const itemId = options.itemId || uuidv4();
    const timestamp = new Date().toISOString();

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, item, priority },
          'addToQueueWithPriority'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const queueItem = {
        id: itemId,
        data: item,
        addedAt: timestamp,
        status: 'pending',
        priority,
        priorityWeight,
        version: '2.0'
      };

      // Calculate priority score (higher priority = higher score)
      const priorityScore = this._calculatePriorityScore(priority, priorityWeight, timestamp);

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Insert item in correct position based on priority
      const updatedItems = this._insertItemByPriority(currentItems, queueItem, priorityScore);

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Update queue item count
      await this._updateQueueItemCount(queueId, updatedItems.length);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          queueItem,
          'addToQueueWithPriority'
        );
      }

      // Emit item added event
      this._emitQueueEvent(queueId, 'item:added:priority', {
        queueId,
        item: queueItem,
        priority,
        position: updatedItems.findIndex(i => i.id === itemId)
      });

      return queueItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'addToQueueWithPriority', {
        queueId,
        item,
        priority
      });
    }
  },

  /**
   * Calculate priority score for sorting
   * @private
   */
  _calculatePriorityScore(priority, weight, timestamp) {
    // Higher priority numbers get higher scores
    // Use timestamp as tiebreaker (older items first for same priority)
    const timeScore = Date.now() - new Date(timestamp).getTime();
    return (priority * 1000000) + (weight * 1000) + (timeScore / 1000000);
  },

  /**
   * Insert item in correct position based on priority
   * @private
   */
  _insertItemByPriority(items, newItem, priorityScore) {
    const updatedItems = [...items];
    
    // Find insertion point (items are sorted by priority score descending)
    let insertIndex = 0;
    for (let i = 0; i < updatedItems.length; i++) {
      const itemScore = this._calculatePriorityScore(
        updatedItems[i].priority || 0,
        updatedItems[i].priorityWeight || 1,
        updatedItems[i].addedAt
      );
      
      if (priorityScore > itemScore) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }

    // Insert at calculated position
    updatedItems.splice(insertIndex, 0, newItem);
    return updatedItems;
  },

  /**
   * Pop item with highest priority
   * @param {string} queueId - Queue ID
   * @param {Object} options - Pop options
   */
  async popFromQueueByPriority(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      minPriority = null,
      maxPriority = null,
      priorityFilter = null
    } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'popFromQueueByPriority'
        );
      }

      // Ensure queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      if (currentItems.length === 0) {
        return null;
      }

      // Filter by priority if specified
      let filteredItems = currentItems;
      if (minPriority !== null || maxPriority !== null) {
        filteredItems = currentItems.filter(item => {
          const priority = item.priority || 0;
          if (minPriority !== null && priority < minPriority) return false;
          if (maxPriority !== null && priority > maxPriority) return false;
          return true;
        });
      }

      if (priorityFilter && typeof priorityFilter === 'function') {
        filteredItems = filteredItems.filter(priorityFilter);
      }

      if (filteredItems.length === 0) {
        return null;
      }

      // Find item with highest priority (first in sorted array)
      const highestPriorityItem = filteredItems[0];
      const updatedItems = currentItems.filter(item => item.id !== highestPriorityItem.id);

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Update queue item count
      await this._updateQueueItemCount(queueId, updatedItems.length);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          highestPriorityItem,
          'popFromQueueByPriority'
        );
      }

      // Emit pop event
      this._emitQueueEvent(queueId, 'item:popped:priority', {
        queueId,
        item: highestPriorityItem,
        priority: highestPriorityItem.priority
      });

      return highestPriorityItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'popFromQueueByPriority', { queueId, options });
    }
  },

  /**
   * Get queue items sorted by priority
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getQueueItemsByPriority(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      limit = 100,
      offset = 0,
      minPriority = null,
      maxPriority = null,
      priorityFilter = null,
      sortOrder = 'desc' // 'desc' for highest priority first, 'asc' for lowest first
    } = options;

    try {
      // Get all items
      const allItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Filter by priority if specified
      let filteredItems = allItems;
      if (minPriority !== null || maxPriority !== null) {
        filteredItems = allItems.filter(item => {
          const priority = item.priority || 0;
          if (minPriority !== null && priority < minPriority) return false;
          if (maxPriority !== null && priority > maxPriority) return false;
          return true;
        });
      }

      if (priorityFilter && typeof priorityFilter === 'function') {
        filteredItems = filteredItems.filter(priorityFilter);
      }

      // Sort by priority
      filteredItems.sort((a, b) => {
        const scoreA = this._calculatePriorityScore(
          a.priority || 0,
          a.priorityWeight || 1,
          a.addedAt
        );
        const scoreB = this._calculatePriorityScore(
          b.priority || 0,
          b.priorityWeight || 1,
          b.addedAt
        );
        
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      });

      // Apply pagination
      const paginatedItems = filteredItems.slice(offset, offset + limit);

      return {
        items: paginatedItems,
        total: filteredItems.length,
        offset,
        limit,
        hasMore: offset + limit < filteredItems.length,
        priorityRange: {
          min: filteredItems.length > 0 ? Math.min(...filteredItems.map(i => i.priority || 0)) : null,
          max: filteredItems.length > 0 ? Math.max(...filteredItems.map(i => i.priority || 0)) : null
        }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getQueueItemsByPriority', { queueId, options });
    }
  },

  /**
   * Update item priority
   * @param {string} queueId - Queue ID
   * @param {string} itemId - Item ID
   * @param {number} newPriority - New priority
   * @param {Object} options - Update options
   */
  async updateItemPriority(queueId, itemId, newPriority, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }

    if (typeof newPriority !== 'number') {
      throw new Error('New priority must be a number');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, itemId, newPriority },
          'updateItemPriority'
        );
      }

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      const itemIndex = currentItems.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item with ID ${itemId} not found in queue ${queueId}`);
      }

      const originalItem = currentItems[itemIndex];
      const updatedItem = {
        ...originalItem,
        priority: newPriority,
        priorityWeight: options.priorityWeight || originalItem.priorityWeight || 1,
        updatedAt: new Date().toISOString()
      };

      // Remove item from current position
      const itemsWithoutItem = currentItems.filter(item => item.id !== itemId);
      
      // Re-insert with new priority
      const newPriorityScore = this._calculatePriorityScore(
        newPriority,
        updatedItem.priorityWeight,
        updatedItem.addedAt
      );
      
      const updatedItems = this._insertItemByPriority(itemsWithoutItem, updatedItem, newPriorityScore);

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          updatedItem,
          'updateItemPriority'
        );
      }

      // Emit priority update event
      this._emitQueueEvent(queueId, 'item:priority:updated', {
        queueId,
        itemId,
        oldPriority: originalItem.priority || 0,
        newPriority,
        updatedItem
      });

      return updatedItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'updateItemPriority', { queueId, itemId, newPriority });
    }
  },

  /**
   * Get priority statistics for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getPriorityStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      if (items.length === 0) {
        return {
          totalItems: 0,
          priorityDistribution: {},
          averagePriority: 0,
          highestPriority: null,
          lowestPriority: null,
          priorityLevels: []
        };
      }

      // Calculate priority statistics
      const priorityCounts = {};
      const priorities = [];
      
      items.forEach(item => {
        const priority = item.priority || 0;
        priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
        priorities.push(priority);
      });

      const averagePriority = priorities.reduce((sum, p) => sum + p, 0) / priorities.length;
      const highestPriority = Math.max(...priorities);
      const lowestPriority = Math.min(...priorities);

      // Get priority levels
      const priorityLevels = Object.keys(priorityCounts)
        .map(p => parseInt(p))
        .sort((a, b) => b - a); // Highest first

      return {
        totalItems: items.length,
        priorityDistribution: priorityCounts,
        averagePriority: Math.round(averagePriority * 100) / 100,
        highestPriority,
        lowestPriority,
        priorityLevels,
        itemsByPriority: priorityLevels.map(priority => ({
          priority,
          count: priorityCounts[priority],
          percentage: Math.round((priorityCounts[priority] / items.length) * 100)
        }))
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getPriorityStats', { queueId, options });
    }
  },

  /**
   * Reorder queue by priority
   * @param {string} queueId - Queue ID
   * @param {Object} options - Reorder options
   */
  async reorderQueueByPriority(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      sortOrder = 'desc',
      preserveOriginalOrder = false
    } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'reorderQueueByPriority'
        );
      }

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      if (currentItems.length === 0) {
        return { reordered: 0 };
      }

      // Sort items by priority
      const sortedItems = [...currentItems].sort((a, b) => {
        const scoreA = this._calculatePriorityScore(
          a.priority || 0,
          a.priorityWeight || 1,
          preserveOriginalOrder ? a.addedAt : new Date().toISOString()
        );
        const scoreB = this._calculatePriorityScore(
          b.priority || 0,
          b.priorityWeight || 1,
          preserveOriginalOrder ? b.addedAt : new Date().toISOString()
        );
        
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      });

      // Update based on strategy
      if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
        await this._syncItemsToRedis(queueId, sortedItems);
      }

      // Update cache
      this._updateCache(queueId, null, sortedItems);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { reorderedCount: sortedItems.length },
          'reorderQueueByPriority'
        );
      }

      // Emit reorder event
      this._emitQueueEvent(queueId, 'queue:reordered:priority', {
        queueId,
        reorderedCount: sortedItems.length,
        sortOrder
      });

      return {
        reordered: sortedItems.length,
        sortOrder
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'reorderQueueByPriority', { queueId, options });
    }
  }
};

module.exports = PriorityOperations;

