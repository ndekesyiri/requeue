/**
 * Error handling utilities for QueueManager
 */

class QueueManagerError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = 'QueueManagerError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, QueueManagerError);
    }
  }
}

class ValidationError extends QueueManagerError {
  constructor(message, field, value) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
  }
}

class RedisError extends QueueManagerError {
  constructor(message, operation, redisError) {
    super(message, 'REDIS_ERROR', { operation, originalError: redisError?.message });
    this.name = 'RedisError';
    this.originalError = redisError;
  }
}

class CacheError extends QueueManagerError {
  constructor(message, strategy, operation) {
    super(message, 'CACHE_ERROR', { strategy, operation });
    this.name = 'CacheError';
  }
}

class HookError extends QueueManagerError {
  constructor(message, hookType, operation, index, originalError) {
    super(message, 'HOOK_ERROR', { hookType, operation, index });
    this.name = 'HookError';
    this.hookIndex = index;
    this.hookType = hookType;
    this.operation = operation;
    this.originalError = originalError;
  }
}

class TimeoutError extends QueueManagerError {
  constructor(message, operation, timeoutMs) {
    super(message, 'TIMEOUT_ERROR', { operation, timeoutMs });
    this.name = 'TimeoutError';
  }
}

class NotFoundError extends QueueManagerError {
  constructor(resource, id) {
    super(`${resource} with ID ${id} not found`, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

class ErrorHandlers {
  constructor(eventManager = null) {
    this.eventManager = eventManager;
    this.errorCounts = new Map();
    this.errorRateLimit = new Map();
  }

  /**
   * Handle and classify errors
   */
  handleError(error, operation, context = {}) {
    // Increment error count
    this._incrementErrorCount(operation);

    // Classify error
    const classifiedError = this._classifyError(error, operation, context);

    // Emit error event
    this._emitErrorEvent(classifiedError, operation, context);

    // Log error based on severity
    this._logError(classifiedError, operation, context);

    return classifiedError;
  }

  /**
   * Create specific error types
   */
  static createValidationError(message, field, value) {
    return new ValidationError(message, field, value);
  }

  static createRedisError(message, operation, originalError) {
    return new RedisError(message, operation, originalError);
  }

  static createCacheError(message, strategy, operation) {
    return new CacheError(message, strategy, operation);
  }

  static createHookError(message, hookType, operation, index, originalError) {
    return new HookError(message, hookType, operation, index, originalError);
  }

  static createTimeoutError(message, operation, timeoutMs) {
    return new TimeoutError(message, operation, timeoutMs);
  }

  static createNotFoundError(resource, id) {
    return new NotFoundError(resource, id);
  }

  /**
   * Classify error type
   * @private
   */
  _classifyError(error, operation, context) {
    // If already a QueueManagerError, return as-is
    if (error instanceof QueueManagerError) {
      return error;
    }

    // Classify based on error message and context
    if (error.message.includes('timeout')) {
      return new TimeoutError(error.message, operation, context.timeout);
    }

    if (error.message.includes('not found')) {
      return new NotFoundError(context.resource || 'Resource', context.id || 'unknown');
    }

    if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
      return new RedisError(error.message, operation, error);
    }

    if (error.message.includes('validation') || error.message.includes('must be')) {
      return new ValidationError(error.message, context.field, context.value);
    }

    if (context.isHookError) {
      return new HookError(
        error.message,
        context.hookType,
        operation,
        context.hookIndex,
        error
      );
    }

    // Default to generic QueueManagerError
    return new QueueManagerError(error.message, 'UNKNOWN_ERROR', context);
  }

  /**
   * Increment error count for rate limiting
   * @private
   */
  _incrementErrorCount(operation) {
    const current = this.errorCounts.get(operation) || 0;
    this.errorCounts.set(operation, current + 1);
  }

  /**
   * Emit error event
   * @private
   */
  _emitErrorEvent(error, operation, context) {
    if (this.eventManager) {
      this.eventManager.emit('error', {
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          context: error.context,
          timestamp: error.timestamp,
          stack: error.stack
        },
        operation,
        context
      });
    }
  }

  /**
   * Log error based on severity
   * @private
   */
  _logError(error, operation, context) {
    const logLevel = this._getLogLevel(error);
    const logMessage = `QueueManager ${operation}: ${error.message}`;
    
    switch (logLevel) {
      case 'error':
        console.error(logMessage, {
          code: error.code,
          context: error.context,
          stack: error.stack
        });
        break;
      case 'warn':
        console.warn(logMessage, {
          code: error.code,
          context: error.context
        });
        break;
      case 'info':
        console.info(logMessage, {
          code: error.code,
          context: error.context
        });
        break;
      default:
        console.log(logMessage);
    }
  }

  /**
   * Determine log level based on error type
   * @private
   */
  _getLogLevel(error) {
    if (error instanceof ValidationError) return 'warn';
    if (error instanceof NotFoundError) return 'info';
    if (error instanceof TimeoutError) return 'warn';
    if (error instanceof RedisError) return 'error';
    if (error instanceof CacheError) return 'warn';
    if (error instanceof HookError) return 'error';
    return 'error';
  }

  /**
   * Check if error rate limit is exceeded
   */
  isRateLimited(operation, maxErrors = 10, windowMs = 60000) {
    const now = Date.now();
    const key = `${operation}:${Math.floor(now / windowMs)}`;
    
    const currentCount = this.errorRateLimit.get(key) || 0;
    if (currentCount >= maxErrors) {
      return true;
    }
    
    this.errorRateLimit.set(key, currentCount + 1);
    return false;
  }

  /**
   * Wrap async function with error handling
   */
  wrapAsyncOperation(operation, fn, context = {}) {
    return async (...args) => {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        const handledError = this.handleError(error, operation, context);
        throw handledError;
      }
    };
  }

  /**
   * Create error recovery strategies
   */
  createRecoveryStrategy(operation, options = {}) {
    const {
      maxRetries = 3,
      retryDelay = 1000,
      exponentialBackoff = true,
      retryableErrors = ['REDIS_ERROR', 'TIMEOUT_ERROR']
    } = options;

    return async (fn, context = {}) => {
      let attempt = 0;
      let lastError;

      while (attempt < maxRetries) {
        try {
          return await fn();
        } catch (error) {
          lastError = this.handleError(error, operation, context);
          
          // Check if error is retryable
          if (!retryableErrors.includes(lastError.code)) {
            throw lastError;
          }

          attempt++;
          
          if (attempt < maxRetries) {
            const delay = exponentialBackoff 
              ? retryDelay * Math.pow(2, attempt - 1)
              : retryDelay;
            
            console.warn(`QueueManager: Retrying ${operation} in ${delay}ms (attempt ${attempt}/${maxRetries})`);
            await this._delay(delay);
          }
        }
      }

      throw lastError;
    };
  }

  /**
   * Delay utility for retry strategies
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {};
    
    for (const [operation, count] of this.errorCounts) {
      stats[operation] = count;
    }

    return {
      errorCounts: stats,
      totalErrors: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0),
      rateLimitEntries: this.errorRateLimit.size
    };
  }

  /**
   * Reset error statistics
   */
  resetErrorStats() {
    this.errorCounts.clear();
    this.errorRateLimit.clear();
  }

  /**
   * Create circuit breaker for operation
   */
  createCircuitBreaker(operation, options = {}) {
    const {
      failureThreshold = 5,
      resetTimeout = 60000,
      monitoringPeriod = 10000
    } = options;

    let failures = 0;
    let lastFailureTime = 0;
    let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN

    return {
      execute: async (fn) => {
        if (state === 'OPEN') {
          if (Date.now() - lastFailureTime > resetTimeout) {
            state = 'HALF_OPEN';
          } else {
            throw new QueueManagerError(
              `Circuit breaker is OPEN for ${operation}`,
              'CIRCUIT_BREAKER_OPEN',
              { operation, state }
            );
          }
        }

        try {
          const result = await fn();
          
          if (state === 'HALF_OPEN') {
            state = 'CLOSED';
            failures = 0;
          }
          
          return result;
        } catch (error) {
          failures++;
          lastFailureTime = Date.now();
          
          if (failures >= failureThreshold) {
            state = 'OPEN';
          }
          
          throw this.handleError(error, operation, { circuitBreaker: true });
        }
      },
      
      getState: () => ({ state, failures, lastFailureTime }),
      reset: () => {
        state = 'CLOSED';
        failures = 0;
        lastFailureTime = 0;
      }
    };
  }

  /**
   * Cleanup error handlers
   */
  destroy() {
    this.errorCounts.clear();
    this.errorRateLimit.clear();
    this.eventManager = null;
  }
}

// Export error classes and handler
module.exports = {
  ErrorHandlers,
  QueueManagerError,
  ValidationError,
  RedisError,
  CacheError,
  HookError,
  TimeoutError,
  NotFoundError
};