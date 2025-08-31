/**
 * Validation utilities for QueueManager
 */

class ValidationUtils {
  /**
   * Validate queue ID
   */
  static validateQueueId(queueId, paramName = 'Queue ID') {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error(`${paramName} must be a non-empty string`);
    }
    
    if (queueId.length > 255) {
      throw new Error(`${paramName} must be 255 characters or less`);
    }
    
    // Check for invalid characters
    if (!/^[a-zA-Z0-9_-]+$/.test(queueId)) {
      throw new Error(`${paramName} can only contain letters, numbers, hyphens, and underscores`);
    }
    
    return true;
  }

  /**
   * Validate item ID
   */
  static validateItemId(itemId, paramName = 'Item ID') {
    if (!itemId || typeof itemId !== 'string') {
      throw new Error(`${paramName} must be a non-empty string`);
    }
    return true;
  }

  /**
   * Validate queue configuration
   */
  static validateQueueConfig(config, paramName = 'Configuration') {
    if (config !== null && config !== undefined && typeof config !== 'object') {
      throw new Error(`${paramName} must be an object`);
    }
    return true;
  }

  /**
   * Validate item data
   */
  static validateItem(item, paramName = 'Item') {
    if (item === undefined || item === null) {
      throw new Error(`${paramName} cannot be null or undefined`);
    }
    return true;
  }

  /**
   * Validate updates object
   */
  static validateUpdates(updates, paramName = 'Updates') {
    if (!updates || typeof updates !== 'object') {
      throw new Error(`${paramName} must be an object`);
    }
    return true;
  }

  /**
   * Validate cache strategy
   */
  static validateCacheStrategy(strategy) {
    const validStrategies = ['write-through', 'write-back', 'read-through'];
    if (strategy && !validStrategies.includes(strategy)) {
      throw new Error(`Invalid cache strategy. Must be one of: ${validStrategies.join(', ')}`);
    }
    return true;
  }

  /**
   * Validate Redis configuration
   */
  static validateRedisConfig(config) {
    if (!config) return true;
    
    if (config.host && typeof config.host !== 'string') {
      throw new Error('Redis host must be a string');
    }
    
    if (config.port && (typeof config.port !== 'number' || config.port < 1 || config.port > 65535)) {
      throw new Error('Redis port must be a number between 1 and 65535');
    }
    
    return true;
  }

  /**
   * Validate batch count
   */
  static validateBatchCount(count, max = 100) {
    if (!Number.isInteger(count) || count < 1 || count > max) {
      throw new Error(`Count must be an integer between 1 and ${max}`);
    }
    return true;
  }

  /**
   * Validate position parameter for queue operations
   */
  static validatePosition(position) {
    if (position !== 'head' && position !== 'tail' && typeof position !== 'number') {
      throw new Error('Position must be "head", "tail", or a valid index number');
    }
    return true;
  }

  /**
   * Validate predicate function
   */
  static validatePredicate(predicate) {
    if (typeof predicate !== 'function') {
      throw new Error('Predicate must be a function');
    }
    return true;
  }

  /**
   * Validate range parameters
   */
  static validateRange(start, end) {
    if (start !== undefined && (!Number.isInteger(start) || start < 0)) {
      throw new Error('Start must be a non-negative integer');
    }
    
    if (end !== undefined && end !== -1 && (!Number.isInteger(end) || end < -1)) {
      throw new Error('End must be -1 or a non-negative integer');
    }
    
    if (start !== undefined && end !== undefined && end !== -1 && start > end) {
      throw new Error('Start cannot be greater than end');
    }
    
    return true;
  }

  /**
   * Sanitize configuration object
   */
  static sanitizeConfig(config) {
    if (!config || typeof config !== 'object') {
      return {};
    }
    
    // Create a deep copy to avoid mutations
    const sanitized = JSON.parse(JSON.stringify(config));
    
    // Remove any potential security risks
    delete sanitized.__proto__;
    delete sanitized.constructor;
    
    return sanitized;
  }

  /**
   * Validate timeout value
   */
  static validateTimeout(timeout) {
    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 0)) {
      throw new Error('Timeout must be a non-negative integer');
    }
    return true;
  }

  /**
   * Validate delay value
   */
  static validateDelay(delay) {
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 0)) {
      throw new Error('Delay must be a non-negative integer');
    }
    return true;
  }
}

module.exports = ValidationUtils;