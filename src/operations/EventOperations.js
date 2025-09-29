/**
 * Event and monitoring operations
 */
const ValidationUtils = require('../utils/ValidationUtils');

const EventOperations = {
  /**
   * Listen to queue events
   */
  listen(queueId) {
    ValidationUtils.validateQueueId(queueId);
    
    // Return an event emitter for the specific queue
    return this.events ? this.events.getQueueEmitter(queueId) : null;
  },

  /**
   * Get the global event emitter
   */
  get eventEmitter() {
    // Return the events object itself as the global emitter
    if (this.events) {
      return this.events;
    }
    
    // If events is not available, return a dummy emitter that does nothing
    return {
      on: () => {},
      off: () => {},
      emit: () => {},
      removeAllListeners: () => {}
    };
  },

  /**
   * Emit a custom event
   */
  emit(eventName, data) {
    if (this.events) {
      this.events.emit(eventName, data);
    }
  },

  /**
   * Subscribe to global events
   */
  on(eventName, callback) {
    if (this.events) {
      this.events.on(eventName, callback);
    }
  },

  /**
   * Unsubscribe from events
   */
  off(eventName, callback) {
    if (this.events) {
      this.events.off(eventName, callback);
    }
  },

  /**
   * Remove all listeners for a specific event
   */
  removeAllListeners(eventName) {
    if (this.events) {
      this.events.removeAllListeners(eventName);
    }
  }
};

module.exports = EventOperations;
