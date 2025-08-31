const MoveOperations = {
  /**
 * Requeue item with configurable options and hooks
 * @param {string} queueId - Queue identifier
 * @param {string} itemId - Item identifier
 * @param {Object} options - Requeue options
 */
  async requeueItem(queueId, itemId, options = {}) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }

    const {
      position = 'tail',
      delay = 0,
      updateStatus = true,
      newStatus = 'requeued',
      retryCount = false,
      resetTimestamp = false
    } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId,
          { queueId, itemId, options }, 'requeueItem');
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      const itemIndex = currentItems.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item with ID ${itemId} not found in queue ${queueId}`);
      }

      const originalItem = { ...currentItems[itemIndex] };

      // Remove item from current position
      const itemsWithoutTarget = currentItems.filter(item => item.id !== itemId);

      // Update item properties
      const updatedItem = { ...originalItem };

      if (updateStatus) {
        updatedItem.status = newStatus;
      }

      if (retryCount) {
        updatedItem.retryCount = (updatedItem.retryCount || 0) + 1;
      }

      if (resetTimestamp) {
        updatedItem.addedAt = new Date().toISOString();
      }

      updatedItem.requeuedAt = new Date().toISOString();
      updatedItem.requeuedFrom = originalItem.status || 'unknown';

      // Handle delay if specified
      if (delay > 0) {
        updatedItem.delayUntil = new Date(Date.now() + delay).toISOString();
        updatedItem.delayed = true;
      }

      // Add item back to queue at specified position
      let updatedItems;
      if (position === 'head') {
        updatedItems = [updatedItem, ...itemsWithoutTarget];
      } else if (position === 'tail') {
        updatedItems = [...itemsWithoutTarget, updatedItem];
      } else if (typeof position === 'number') {
        const insertIndex = Math.max(0, Math.min(position, itemsWithoutTarget.length));
        updatedItems = [
          ...itemsWithoutTarget.slice(0, insertIndex),
          updatedItem,
          ...itemsWithoutTarget.slice(insertIndex)
        ];
      } else {
        throw new Error('Position must be "head", "tail", or a valid index number');
      }

      // Update based on strategy
      if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId,
          { queueId, originalItem, updatedItem }, 'requeueItem');
      }

      // Emit requeue event
      this._emitQueueEvent(queueId, 'item:requeued', {
        queueId,
        itemId,
        originalItem,
        updatedItem,
        position,
        delay
      });

      return updatedItem;
    } catch (error) {
      console.error(`QueueManager: Error requeuing item ${itemId} in queue ${queueId}:`, error.message);
      throw error;
    }
  },

  /**
   * Move item between queues with hooks integration
   * @param {string} sourceQueueId - Source queue identifier
   * @param {string} targetQueueId - Target queue identifier  
   * @param {string} itemId - Item identifier to move
   * @param {Object} options - Options including hooks and position
   */
  async moveItemBetweenQueues(sourceQueueId, targetQueueId, itemId, options = {}) {
    if (!sourceQueueId || typeof sourceQueueId !== 'string') {
      throw new Error('Source queue ID must be a non-empty string');
    }
    if (!targetQueueId || typeof targetQueueId !== 'string') {
      throw new Error('Target queue ID must be a non-empty string');
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }
    if (sourceQueueId === targetQueueId) {
      throw new Error('Source and target queues cannot be the same');
    }

    const { position = 'head', preserveTimestamp = false } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', sourceQueueId,
          { sourceQueueId, targetQueueId, itemId, options }, 'moveItemBetweenQueues');
      }

      // Verify both queues exist
      await this._getQueueFromCacheOrRedis(sourceQueueId);
      await this._getQueueFromCacheOrRedis(targetQueueId);

      // Get source items and find the item
      const sourceItems = await this._getQueueItemsFromCacheOrRedis(sourceQueueId);
      const itemIndex = sourceItems.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item with ID ${itemId} not found in source queue ${sourceQueueId}`);
      }

      const itemToMove = { ...sourceItems[itemIndex] };

      // Update item metadata
      if (!preserveTimestamp) {
        itemToMove.movedAt = new Date().toISOString();
        itemToMove.movedFrom = sourceQueueId;
        itemToMove.movedTo = targetQueueId;
      }

      // Remove from source queue
      const updatedSourceItems = sourceItems.filter(item => item.id !== itemId);

      // Get target items and add the moved item
      const targetItems = await this._getQueueItemsFromCacheOrRedis(targetQueueId);
      let updatedTargetItems;

      if (position === 'head') {
        updatedTargetItems = [itemToMove, ...targetItems];
      } else if (position === 'tail') {
        updatedTargetItems = [...targetItems, itemToMove];
      } else if (typeof position === 'number') {
        const insertIndex = Math.max(0, Math.min(position, targetItems.length));
        updatedTargetItems = [
          ...targetItems.slice(0, insertIndex),
          itemToMove,
          ...targetItems.slice(insertIndex)
        ];
      } else {
        throw new Error('Position must be "head", "tail", or a valid index number');
      }

      // Update both queues based on strategy
      if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
        await Promise.all([
          this._syncItemsToRedis(sourceQueueId, updatedSourceItems),
          this._syncItemsToRedis(targetQueueId, updatedTargetItems)
        ]);
      }

      // Update caches
      this._updateCache(sourceQueueId, null, updatedSourceItems);
      this._updateCache(targetQueueId, null, updatedTargetItems);

      // Update item counts
      await Promise.all([
        this._updateQueueItemCount(sourceQueueId, updatedSourceItems.length),
        this._updateQueueItemCount(targetQueueId, updatedTargetItems.length)
      ]);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', sourceQueueId,
          { sourceQueueId, targetQueueId, itemId, movedItem: itemToMove }, 'moveItemBetweenQueues');
      }

      // Emit move events
      this._emitQueueEvent(sourceQueueId, 'item:moved:out', {
        sourceQueueId,
        targetQueueId,
        itemId,
        item: itemToMove
      });

      this._emitQueueEvent(targetQueueId, 'item:moved:in', {
        sourceQueueId,
        targetQueueId,
        itemId,
        item: itemToMove,
        position
      });

      return {
        success: true,
        movedItem: itemToMove,
        sourceQueue: sourceQueueId,
        targetQueue: targetQueueId,
        position
      };
    } catch (error) {
      console.error(`QueueManager: Error moving item ${itemId} from ${sourceQueueId} to ${targetQueueId}:`, error.message);
      throw error;
    }
  }


}

module.exports = MoveOperations;