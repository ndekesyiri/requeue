/**
 * Hook execution utilities for QueueManager
 */

class HookExecutor {
  constructor(eventManager = null) {
    this.hookCache = new Map();
    this.eventManager = eventManager;
    this.maxHooksPerOperation = 10;
    this.hookTimeout = 5000; // 5 seconds
  }

  /**
   * Execute hooks with caching and error handling
   */
  async executeHooks(hooks, hookType, queueId, item, operation = 'unknown', context = {}) {
    if (!Array.isArray(hooks) || hooks.length === 0) {
      return [];
    }

    // Validate and limit hooks
    const validHooks = this._validateAndCacheHooks(hooks, hookType, operation);
    const results = [];

    // Execute hooks with timeout and error handling
    for (let i = 0; i < validHooks.length; i++) {
      try {
        const hook = validHooks[i];
        const result = await this._executeHookWithTimeout(
          hook, 
          item, 
          queueId, 
          { ...context, operation, hookType, index: i }
        );
        results.push(result);
      } catch (error) {
        const hookError = this._createHookError(error, hookType, operation, i);
        
        // Emit detailed hook error event
        this._emitHookError(queueId, hookError, { item, operation, hookType });
        
        throw hookError;
      }
    }

    return results;
  }

  /**
   * Validate and cache hooks for performance
   * @private
   */
  _validateAndCacheHooks(hooks, hookType, operation) {
    const hookKey = `${hookType}:${operation}:${hooks.length}`;
    
    if (this.hookCache.has(hookKey)) {
      return this.hookCache.get(hookKey);
    }

    // Validate hooks
    const validHooks = hooks
      .slice(0, this.maxHooksPerOperation) // Limit hooks
      .filter((hook, index) => {
        if (typeof hook !== 'function') {
          console.warn(`QueueManager: Hook at index ${index} is not a function`);
          return false;
        }
        return true;
      });

    // Cache for future use
    this.hookCache.set(hookKey, validHooks);
    
    // Prevent cache from growing too large
    if (this.hookCache.size > 100) {
      const firstKey = this.hookCache.keys().next().value;
      this.hookCache.delete(firstKey);
    }

    return validHooks;
  }

  /**
   * Execute a single hook with timeout
   * @private
   */
  async _executeHookWithTimeout(hook, item, queueId, context) {
    return Promise.race([
      hook(item, queueId, context),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Hook execution timeout')), this.hookTimeout)
      )
    ]);
  }

  /**
   * Create detailed hook error
   * @private
   */
  _createHookError(originalError, hookType, operation, index) {
    const hookError = new Error(
      `${hookType} hook failed at index ${index} for ${operation}: ${originalError.message}`
    );
    
    hookError.hookIndex = index;
    hookError.hookType = hookType;
    hookError.operation = operation;
    hookError.originalError = originalError;
    hookError.timestamp = new Date().toISOString();
    
    return hookError;
  }

  /**
   * Emit hook error event
   * @private
   */
  _emitHookError(queueId, error, context) {
    if (this.eventManager) {
      this.eventManager.emit(`hook:${error.hookType}:error`, {
        queueId,
        operation: error.operation,
        hookIndex: error.hookIndex,
        error: error.message,
        stack: error.stack,
        timestamp: error.timestamp,
        context
      });
    }
  }

  /**
   * Execute before hooks
   */
  async executeBeforeHooks(hooks, queueId, data, operation, context = {}) {
    return this.executeHooks(hooks, 'beforeAction', queueId, data, operation, context);
  }

  /**
   * Execute after hooks
   */
  async executeAfterHooks(hooks, queueId, data, operation, context = {}) {
    return this.executeHooks(hooks, 'afterAction', queueId, data, operation, context);
  }

  /**
   * Execute hooks from options object
   */
  async executeHooksFromOptions(options, hookType, queueId, data, operation, context = {}) {
    const hooks = options.actions?.[hookType];
    if (!hooks) return [];
    
    return this.executeHooks(hooks, hookType, queueId, data, operation, context);
  }

  /**
   * Register hook validators
   */
  registerHookValidator(hookType, validator) {
    if (!this.hookValidators) {
      this.hookValidators = new Map();
    }
    this.hookValidators.set(hookType, validator);
  }

  /**
   * Validate hook data against registered validators
   */
  async validateHookData(hookType, data) {
    if (!this.hookValidators || !this.hookValidators.has(hookType)) {
      return true;
    }
    
    const validator = this.hookValidators.get(hookType);
    return validator(data);
  }

  /**
   * Create hook execution context
   */
  createHookContext(operation, queueId, additionalContext = {}) {
    return {
      timestamp: new Date().toISOString(),
      operation,
      queueId,
      version: '2.0',
      ...additionalContext
    };
  }

  /**
   * Batch execute multiple hook sets
   */
  async executeBatchHooks(hookBatches) {
    const results = [];
    
    for (const batch of hookBatches) {
      try {
        const batchResult = await this.executeHooks(
          batch.hooks,
          batch.hookType,
          batch.queueId,
          batch.data,
          batch.operation,
          batch.context
        );
        results.push({ success: true, result: batchResult, batch });
      } catch (error) {
        results.push({ success: false, error, batch });
      }
    }
    
    return results;
  }

  /**
   * Create hook middleware
   */
  createHookMiddleware(beforeHooks = [], afterHooks = []) {
    return {
      before: async (queueId, data, operation, context = {}) => {
        return this.executeBeforeHooks(beforeHooks, queueId, data, operation, context);
      },
      after: async (queueId, data, operation, context = {}) => {
        return this.executeAfterHooks(afterHooks, queueId, data, operation, context);
      }
    };
  }

  /**
   * Set hook execution timeout
   */
  setHookTimeout(timeout) {
    if (typeof timeout === 'number' && timeout > 0) {
      this.hookTimeout = timeout;
    }
  }

  /**
   * Set maximum hooks per operation
   */
  setMaxHooksPerOperation(max) {
    if (typeof max === 'number' && max > 0 && max <= 50) {
      this.maxHooksPerOperation = max;
    }
  }

  /**
   * Clear hook cache
   */
  clearHookCache() {
    this.hookCache.clear();
  }

  /**
   * Get hook cache statistics
   */
  getHookCacheStats() {
    return {
      size: this.hookCache.size,
      maxSize: 100,
      hitRate: this._calculateCacheHitRate()
    };
  }

  /**
   * Calculate cache hit rate (placeholder - would need actual tracking)
   * @private
   */
  _calculateCacheHitRate() {
    // This would need actual hit/miss tracking to be implemented
    return 0;
  }

  /**
   * Destroy hook executor and cleanup resources
   */
  destroy() {
    this.clearHookCache();
    if (this.hookValidators) {
      this.hookValidators.clear();
    }
    this.eventManager = null;
  }
}

module.exports = HookExecutor;