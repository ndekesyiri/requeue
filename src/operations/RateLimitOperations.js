/**
 * Rate limiting and concurrency control operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const RateLimitOperations = {
  /**
   * Configure rate limiting for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} rateLimitConfig - Rate limiting configuration
   */
  async configureRateLimit(queueId, rateLimitConfig) {
    ValidationUtils.validateQueueId(queueId);

    const {
      maxJobsPerSecond = null,
      maxJobsPerMinute = null,
      maxJobsPerHour = null,
      maxJobsPerDay = null,
      maxConcurrentJobs = null,
      burstLimit = null,
      windowSize = 60, // seconds
      enabled = true
    } = rateLimitConfig;

    try {
      // Execute before hooks
      if (rateLimitConfig.actions?.beforeAction) {
        await this._executeHooks(
          rateLimitConfig.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, rateLimitConfig },
          'configureRateLimit'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const config = {
        enabled,
        maxJobsPerSecond,
        maxJobsPerMinute,
        maxJobsPerHour,
        maxJobsPerDay,
        maxConcurrentJobs,
        burstLimit,
        windowSize,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store rate limit configuration
      const rateLimitKey = `${this.QUEUE_PREFIX}rate_limit:${queueId}`;
      await this.redis.hset(rateLimitKey, config);

      // Initialize rate limit counters
      await this._initializeRateLimitCounters(queueId, config);

      // Execute after hooks
      if (rateLimitConfig.actions?.afterAction) {
        await this._executeHooks(
          rateLimitConfig.actions.afterAction,
          'afterAction',
          queueId,
          config,
          'configureRateLimit'
        );
      }

      // Emit rate limit configuration event
      this._emitQueueEvent(queueId, 'rate_limit:configured', {
        queueId,
        config
      });

      return config;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'configureRateLimit', { queueId, rateLimitConfig });
    }
  },

  /**
   * Initialize rate limit counters
   * @private
   */
  async _initializeRateLimitCounters(queueId, config) {
    const counters = {};

    if (config.maxJobsPerSecond) {
      counters.secondly = 0;
    }
    if (config.maxJobsPerMinute) {
      counters.minutely = 0;
    }
    if (config.maxJobsPerHour) {
      counters.hourly = 0;
    }
    if (config.maxJobsPerDay) {
      counters.daily = 0;
    }
    if (config.maxConcurrentJobs) {
      counters.concurrent = 0;
    }

    if (Object.keys(counters).length > 0) {
      const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;
      await this.redis.hset(countersKey, counters);
    }
  },

  /**
   * Check if job can be processed based on rate limits
   * @param {string} queueId - Queue ID
   * @param {Object} options - Check options
   */
  async checkRateLimit(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      jobId = null,
      priority = 0,
      bypassRateLimit = false
    } = options;

    try {
      // Get rate limit configuration
      const rateLimitKey = `${this.QUEUE_PREFIX}rate_limit:${queueId}`;
      const config = await this.redis.hgetall(rateLimitKey);

      if (Object.keys(config).length === 0 || config.enabled !== 'true') {
        return { allowed: true, reason: 'No rate limiting configured' };
      }

      if (bypassRateLimit) {
        return { allowed: true, reason: 'Rate limit bypassed' };
      }

      // Check concurrent job limit
      if (config.maxConcurrentJobs) {
        const concurrentCount = await this._getConcurrentJobCount(queueId);
        if (concurrentCount >= parseInt(config.maxConcurrentJobs)) {
          return {
            allowed: false,
            reason: 'Concurrent job limit exceeded',
            current: concurrentCount,
            limit: parseInt(config.maxConcurrentJobs)
          };
        }
      }

      // Check time-based rate limits
      const rateChecks = await this._checkTimeBasedLimits(queueId, config);
      
      for (const check of rateChecks) {
        if (!check.allowed) {
          return check;
        }
      }

      // All checks passed
      return { allowed: true, reason: 'Rate limit check passed' };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'checkRateLimit', { queueId, options });
    }
  },

  /**
   * Check time-based rate limits
   * @private
   */
  async _checkTimeBasedLimits(queueId, config) {
    const checks = [];
    const currentTime = Date.now();
    const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;

    // Check per-second limit
    if (config.maxJobsPerSecond) {
      const secondKey = `second:${Math.floor(currentTime / 1000)}`;
      const count = await this.redis.hget(countersKey, secondKey) || 0;
      
      if (parseInt(count) >= parseInt(config.maxJobsPerSecond)) {
        checks.push({
          allowed: false,
          reason: 'Per-second rate limit exceeded',
          current: parseInt(count),
          limit: parseInt(config.maxJobsPerSecond),
          window: 'second'
        });
      }
    }

    // Check per-minute limit
    if (config.maxJobsPerMinute) {
      const minuteKey = `minute:${Math.floor(currentTime / 60000)}`;
      const count = await this.redis.hget(countersKey, minuteKey) || 0;
      
      if (parseInt(count) >= parseInt(config.maxJobsPerMinute)) {
        checks.push({
          allowed: false,
          reason: 'Per-minute rate limit exceeded',
          current: parseInt(count),
          limit: parseInt(config.maxJobsPerMinute),
          window: 'minute'
        });
      }
    }

    // Check per-hour limit
    if (config.maxJobsPerHour) {
      const hourKey = `hour:${Math.floor(currentTime / 3600000)}`;
      const count = await this.redis.hget(countersKey, hourKey) || 0;
      
      if (parseInt(count) >= parseInt(config.maxJobsPerHour)) {
        checks.push({
          allowed: false,
          reason: 'Per-hour rate limit exceeded',
          current: parseInt(count),
          limit: parseInt(config.maxJobsPerHour),
          window: 'hour'
        });
      }
    }

    // Check per-day limit
    if (config.maxJobsPerDay) {
      const dayKey = `day:${Math.floor(currentTime / 86400000)}`;
      const count = await this.redis.hget(countersKey, dayKey) || 0;
      
      if (parseInt(count) >= parseInt(config.maxJobsPerDay)) {
        checks.push({
          allowed: false,
          reason: 'Per-day rate limit exceeded',
          current: parseInt(count),
          limit: parseInt(config.maxJobsPerDay),
          window: 'day'
        });
      }
    }

    return checks;
  },

  /**
   * Record job execution for rate limiting
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID
   * @param {Object} options - Recording options
   */
  async recordJobExecution(queueId, jobId, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    try {
      // Get rate limit configuration
      const rateLimitKey = `${this.QUEUE_PREFIX}rate_limit:${queueId}`;
      const config = await this.redis.hgetall(rateLimitKey);

      if (Object.keys(config).length === 0 || config.enabled !== 'true') {
        return; // No rate limiting configured
      }

      const currentTime = Date.now();
      const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;
      const pipeline = this.redis.pipeline();

      // Update time-based counters
      if (config.maxJobsPerSecond) {
        const secondKey = `second:${Math.floor(currentTime / 1000)}`;
        pipeline.hincrby(countersKey, secondKey, 1);
        pipeline.pexpire(countersKey, 2000); // Expire after 2 seconds
      }

      if (config.maxJobsPerMinute) {
        const minuteKey = `minute:${Math.floor(currentTime / 60000)}`;
        pipeline.hincrby(countersKey, minuteKey, 1);
        pipeline.pexpire(countersKey, 120000); // Expire after 2 minutes
      }

      if (config.maxJobsPerHour) {
        const hourKey = `hour:${Math.floor(currentTime / 3600000)}`;
        pipeline.hincrby(countersKey, hourKey, 1);
        pipeline.pexpire(countersKey, 7200000); // Expire after 2 hours
      }

      if (config.maxJobsPerDay) {
        const dayKey = `day:${Math.floor(currentTime / 86400000)}`;
        pipeline.hincrby(countersKey, dayKey, 1);
        pipeline.pexpire(countersKey, 172800000); // Expire after 2 days
      }

      // Update concurrent job counter
      if (config.maxConcurrentJobs) {
        pipeline.hincrby(countersKey, 'concurrent', 1);
      }

      // Record job execution
      const executionKey = `${this.QUEUE_PREFIX}execution:${queueId}:${jobId}`;
      pipeline.hset(executionKey, {
        jobId,
        queueId,
        executedAt: new Date().toISOString(),
        timestamp: currentTime.toString()
      });
      pipeline.pexpire(executionKey, 7 * 24 * 60 * 60 * 1000); // 7 days

      await pipeline.exec();

      // Emit job execution event
      this._emitQueueEvent(queueId, 'job:execution:recorded', {
        queueId,
        jobId,
        executedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error(`QueueManager: Error recording job execution for ${jobId}:`, error.message);
    }
  },

  /**
   * Record job completion for rate limiting
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID
   * @param {Object} options - Completion options
   */
  async recordJobCompletion(queueId, jobId, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    try {
      // Get rate limit configuration
      const rateLimitKey = `${this.QUEUE_PREFIX}rate_limit:${queueId}`;
      const config = await this.redis.hgetall(rateLimitKey);

      if (Object.keys(config).length === 0 || config.enabled !== 'true') {
        return; // No rate limiting configured
      }

      const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;

      // Decrement concurrent job counter
      if (config.maxConcurrentJobs) {
        await this.redis.hincrby(countersKey, 'concurrent', -1);
      }

      // Update job execution record
      const executionKey = `${this.QUEUE_PREFIX}execution:${queueId}:${jobId}`;
      await this.redis.hset(executionKey, {
        completedAt: new Date().toISOString(),
        status: 'completed',
        duration: options.duration || null
      });

      // Emit job completion event
      this._emitQueueEvent(queueId, 'job:completion:recorded', {
        queueId,
        jobId,
        completedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error(`QueueManager: Error recording job completion for ${jobId}:`, error.message);
    }
  },

  /**
   * Get current concurrent job count
   * @private
   */
  async _getConcurrentJobCount(queueId) {
    const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;
    const count = await this.redis.hget(countersKey, 'concurrent');
    return parseInt(count) || 0;
  },

  /**
   * Get rate limit statistics
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getRateLimitStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      window = 'hour', // 'second', 'minute', 'hour', 'day'
      fromTime = null,
      toTime = null
    } = options;

    try {
      // Get rate limit configuration
      const rateLimitKey = `${this.QUEUE_PREFIX}rate_limit:${queueId}`;
      const config = await this.redis.hgetall(rateLimitKey);

      if (Object.keys(config).length === 0) {
        return {
          configured: false,
          message: 'No rate limiting configured'
        };
      }

      // Get current counters
      const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;
      const counters = await this.redis.hgetall(countersKey);

      // Get execution history
      const pattern = `${this.QUEUE_PREFIX}execution:${queueId}:*`;
      const executionKeys = await this.redis.keys(pattern);
      
      let executions = [];
      if (executionKeys.length > 0) {
        const pipeline = this.redis.pipeline();
        executionKeys.forEach(key => {
          pipeline.hgetall(key);
        });
        
        const results = await pipeline.exec();
        executions = results
          .filter(([error, data]) => !error && Object.keys(data).length > 0)
          .map(([error, data]) => data);
      }

      // Filter executions by time range
      if (fromTime || toTime) {
        executions = executions.filter(exec => {
          const execTime = new Date(exec.executedAt).getTime();
          if (fromTime && execTime < fromTime.getTime()) return false;
          if (toTime && execTime > toTime.getTime()) return false;
          return true;
        });
      }

      // Calculate statistics
      const currentConcurrent = parseInt(counters.concurrent) || 0;
      const totalExecutions = executions.length;
      const completedExecutions = executions.filter(exec => exec.status === 'completed').length;
      const averageDuration = executions
        .filter(exec => exec.duration)
        .reduce((sum, exec) => sum + parseInt(exec.duration), 0) / completedExecutions || 0;

      // Get current rate based on window
      let currentRate = 0;
      let rateLimit = null;
      
      switch (window) {
        case 'second':
          currentRate = parseInt(counters[`second:${Math.floor(Date.now() / 1000)}`]) || 0;
          rateLimit = parseInt(config.maxJobsPerSecond) || null;
          break;
        case 'minute':
          currentRate = parseInt(counters[`minute:${Math.floor(Date.now() / 60000)}`]) || 0;
          rateLimit = parseInt(config.maxJobsPerMinute) || null;
          break;
        case 'hour':
          currentRate = parseInt(counters[`hour:${Math.floor(Date.now() / 3600000)}`]) || 0;
          rateLimit = parseInt(config.maxJobsPerHour) || null;
          break;
        case 'day':
          currentRate = parseInt(counters[`day:${Math.floor(Date.now() / 86400000)}`]) || 0;
          rateLimit = parseInt(config.maxJobsPerDay) || null;
          break;
      }

      return {
        configured: true,
        config: {
          enabled: config.enabled === 'true',
          maxConcurrentJobs: parseInt(config.maxConcurrentJobs) || null,
          maxJobsPerSecond: parseInt(config.maxJobsPerSecond) || null,
          maxJobsPerMinute: parseInt(config.maxJobsPerMinute) || null,
          maxJobsPerHour: parseInt(config.maxJobsPerHour) || null,
          maxJobsPerDay: parseInt(config.maxJobsPerDay) || null
        },
        current: {
          concurrentJobs: currentConcurrent,
          currentRate,
          rateLimit,
          utilizationRate: rateLimit ? (currentRate / rateLimit) * 100 : null
        },
        statistics: {
          totalExecutions,
          completedExecutions,
          completionRate: totalExecutions > 0 ? (completedExecutions / totalExecutions) * 100 : 0,
          averageDuration: Math.round(averageDuration)
        },
        timeRange: {
          from: fromTime?.toISOString(),
          to: toTime?.toISOString(),
          window
        }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getRateLimitStats', { queueId, options });
    }
  },

  /**
   * Reset rate limit counters
   * @param {string} queueId - Queue ID
   * @param {Object} options - Reset options
   */
  async resetRateLimitCounters(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      resetConcurrent = true,
      resetTimeBased = true,
      resetExecutions = false
    } = options;

    try {
      const countersKey = `${this.QUEUE_PREFIX}rate_counters:${queueId}`;
      const pipeline = this.redis.pipeline();

      if (resetConcurrent) {
        pipeline.hset(countersKey, 'concurrent', 0);
      }

      if (resetTimeBased) {
        // Reset all time-based counters
        const keys = await this.redis.hkeys(countersKey);
        const timeKeys = keys.filter(key => 
          key.startsWith('second:') || 
          key.startsWith('minute:') || 
          key.startsWith('hour:') || 
          key.startsWith('day:')
        );
        
        timeKeys.forEach(key => {
          pipeline.hdel(countersKey, key);
        });
      }

      await pipeline.exec();

      if (resetExecutions) {
        // Reset execution history
        const pattern = `${this.QUEUE_PREFIX}execution:${queueId}:*`;
        const executionKeys = await this.redis.keys(pattern);
        
        if (executionKeys.length > 0) {
          await this.redis.del(...executionKeys);
        }
      }

      // Emit reset event
      this._emitQueueEvent(queueId, 'rate_limit:counters:reset', {
        queueId,
        resetConcurrent,
        resetTimeBased,
        resetExecutions
      });

      return {
        reset: true,
        resetConcurrent,
        resetTimeBased,
        resetExecutions
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'resetRateLimitCounters', { queueId, options });
    }
  },

  /**
   * Disable rate limiting for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Disable options
   */
  async disableRateLimit(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'disableRateLimit'
        );
      }

      const rateLimitKey = `${this.QUEUE_PREFIX}rate_limit:${queueId}`;
      
      // Update configuration
      await this.redis.hset(rateLimitKey, {
        enabled: 'false',
        disabledAt: new Date().toISOString(),
        disabledBy: options.disabledBy || 'system',
        reason: options.reason || 'Manual disable'
      });

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { disabledAt: new Date().toISOString() },
          'disableRateLimit'
        );
      }

      // Emit disable event
      this._emitQueueEvent(queueId, 'rate_limit:disabled', {
        queueId,
        disabledAt: new Date().toISOString(),
        reason: options.reason
      });

      return {
        disabled: true,
        disabledAt: new Date().toISOString(),
        reason: options.reason
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'disableRateLimit', { queueId, options });
    }
  }
};

module.exports = RateLimitOperations;

