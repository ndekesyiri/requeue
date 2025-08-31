const ValidationUtils = require('../utils/ValidationUtils');

const PeekOperations = {
/**
* Peek ath the next item in the queue without removing it
* @params {string} queueId to identify which queue we are dealing with
*/
  async peekQueue(queueId, options = {}) {
    // First off validation
    ValidationUtils.validateQueueId(queueId);

    try {
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId, { queueId }, 'peekQueue')
      }
      // First off, ensure that the queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const peekedItems = await this._getPeekQueueItemsFromCacheOrRedis(queueId) || [];

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId, 'peekQueue');
      }

      // Emit item added event
      this._emitQueueEvent(queueId, 'item:peeked', {
        queueId,
        item: peekedItems
      });

      return peekedItems;
    } catch (error) {
      console.error(`QueueManager: Error peeking queue with id:${queueId}`, error.message);
      throw error;
    }
  }

}

module.exports = PeekOperations;