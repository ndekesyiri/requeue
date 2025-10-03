/**
 * Job timeout handling operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const TimeoutOperations = {
  /**
   * Add job with timeout
   * @param {string} queueId - Queue ID
   * @param {Object} jobData - Job data
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {Object} options - Job options
   */
  async addJobWithTimeout(queueId, jobData, timeoutMs, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (jobData === undefined || jobData === null) {
      throw new Error('Job data cannot be null or undefined');
    }

    if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
      throw new Error('Timeout must be a positive number');
    }

    const jobId = options.jobId || uuidv4();
    const timestamp = new Date().toISOString();

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, jobData, timeoutMs },
          'addJobWithTimeout'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const jobItem = {
        id: jobId,
        data: jobData,
        addedAt: timestamp,
        status: 'pending',
        timeout: timeoutMs,
        timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
        version: '2.0',
        ...options
      };

      // Store job with timeout tracking
      await this._storeJobWithTimeout(queueId, jobItem);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          jobItem,
          'addJobWithTimeout'
        );
      }

      // Emit job added event
      this._emitQueueEvent(queueId, 'job:added:timeout', {
        queueId,
        jobId,
        timeout: timeoutMs,
        timeoutAt: jobItem.timeoutAt
      });

      return jobItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'addJobWithTimeout', {
        queueId,
        jobData,
        timeoutMs
      });
    }
  },

  /**
   * Store job with timeout tracking
   * @private
   */
  async _storeJobWithTimeout(queueId, jobItem) {
    const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${jobItem.id}`;
    const timeoutKey = `${this.QUEUE_PREFIX}timeout:${queueId}:${jobItem.id}`;
    
    const pipeline = this.redis.pipeline();
    
    // Store job item
    pipeline.hset(itemKey, {
      ...jobItem,
      timeout: jobItem.timeout.toString(),
      timeoutAt: jobItem.timeoutAt
    });
    
    // Store timeout tracking
    pipeline.hset(timeoutKey, {
      jobId: jobItem.id,
      queueId,
      timeout: jobItem.timeout.toString(),
      timeoutAt: jobItem.timeoutAt,
      status: 'pending',
      createdAt: jobItem.addedAt
    });
    
    // Set timeout expiration
    pipeline.pexpire(timeoutKey, jobItem.timeout + 60000); // Add 1 minute buffer
    
    // Add to queue items list
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    pipeline.lpush(itemsKey, JSON.stringify(jobItem));
    
    await pipeline.exec();

    // Update cache
    this._updateCache(queueId, null, [jobItem]);
  },

  /**
   * Start job execution with timeout monitoring
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID
   * @param {Function} jobProcessor - Job processing function
   * @param {Object} options - Execution options
   */
  async executeJobWithTimeout(queueId, jobId, jobProcessor, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    if (!jobProcessor || typeof jobProcessor !== 'function') {
      throw new Error('Job processor must be a function');
    }

    try {
      // Get job data
      const jobData = await this.getItem(queueId, jobId);
      
      if (!jobData.timeout) {
        // No timeout specified, execute normally
        return await jobProcessor(jobData.data);
      }

      const timeout = jobData.timeout;
      const timeoutAt = new Date(jobData.timeoutAt).getTime();
      const currentTime = Date.now();

      // Check if job has already timed out
      if (currentTime >= timeoutAt) {
        await this._handleJobTimeout(queueId, jobId, 'Job started after timeout');
        throw new Error('Job has already timed out');
      }

      // Calculate remaining time
      const remainingTime = timeoutAt - currentTime;

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Job timeout after ${timeout}ms`));
        }, remainingTime);
      });

      // Create job execution promise
      const jobPromise = jobProcessor(jobData.data);

      // Race between job completion and timeout
      const result = await Promise.race([jobPromise, timeoutPromise]);

      // Job completed successfully
      await this._markJobCompleted(queueId, jobId, result);
      return result;

    } catch (error) {
      if (error.message.includes('timeout')) {
        await this._handleJobTimeout(queueId, jobId, error.message);
      }
      throw error;
    }
  },

  /**
   * Handle job timeout
   * @private
   */
  async _handleJobTimeout(queueId, jobId, reason) {
    try {
      const timeoutKey = `${this.QUEUE_PREFIX}timeout:${queueId}:${jobId}`;
      
      // Update timeout status
      await this.redis.hset(timeoutKey, {
        status: 'timed_out',
        timedOutAt: new Date().toISOString(),
        reason
      });

      // Update job status
      await this.updateItem(queueId, jobId, {
        status: 'timed_out',
        timedOutAt: new Date().toISOString(),
        timeoutReason: reason
      });

      // Emit timeout event
      this._emitQueueEvent(queueId, 'job:timed_out', {
        queueId,
        jobId,
        reason,
        timedOutAt: new Date().toISOString()
      });

    } catch (error) {
      console.error(`QueueManager: Error handling timeout for job ${jobId}:`, error.message);
    }
  },

  /**
   * Mark job as completed and clean up timeout tracking
   * @private
   */
  async _markJobCompleted(queueId, jobId, result) {
    try {
      const timeoutKey = `${this.QUEUE_PREFIX}timeout:${queueId}:${jobId}`;
      
      // Update timeout status
      await this.redis.hset(timeoutKey, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: JSON.stringify(result || {})
      });

      // Update job status
      await this.updateItem(queueId, jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result
      });

      // Clean up timeout tracking after a delay
      setTimeout(async () => {
        try {
          await this.redis.del(timeoutKey);
        } catch (error) {
          console.error(`QueueManager: Error cleaning up timeout tracking for ${jobId}:`, error.message);
        }
      }, 60000); // Clean up after 1 minute

    } catch (error) {
      console.error(`QueueManager: Error marking job completed:`, error.message);
    }
  },

  /**
   * Check for timed out jobs
   * @param {string} queueId - Queue ID
   * @param {Object} options - Check options
   */
  async checkTimedOutJobs(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      maxJobs = 100,
      olderThanMs = 0
    } = options;

    try {
      const pattern = `${this.QUEUE_PREFIX}timeout:${queueId}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length === 0) {
        return { timedOut: [], checked: 0 };
      }

      const currentTime = Date.now();
      const timedOutJobs = [];
      const pipeline = this.redis.pipeline();

      // Get timeout data for all jobs
      keys.slice(0, maxJobs).forEach(key => {
        pipeline.hgetall(key);
      });

      const results = await pipeline.exec();

      for (let i = 0; i < results.length; i++) {
        const [error, timeoutData] = results[i];
        if (error || Object.keys(timeoutData).length === 0) continue;

        const timeoutAt = new Date(timeoutData.timeoutAt).getTime();
        const age = currentTime - new Date(timeoutData.createdAt).getTime();
        
        // Check if job has timed out
        if (currentTime >= timeoutAt && age >= olderThanMs) {
          const jobId = timeoutData.jobId;
          
          // Only process if job is still pending
          if (timeoutData.status === 'pending') {
            await this._handleJobTimeout(queueId, jobId, 'Timeout check detected expired job');
            timedOutJobs.push({
              jobId,
              timeoutAt: timeoutData.timeoutAt,
              age: age,
              reason: 'Timeout check detected expired job'
            });
          }
        }
      }

      return {
        timedOut: timedOutJobs,
        checked: results.length
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'checkTimedOutJobs', { queueId, options });
    }
  },

  /**
   * Get timeout statistics for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getTimeoutStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      fromTime = null,
      toTime = null
    } = options;

    try {
      const pattern = `${this.QUEUE_PREFIX}timeout:${queueId}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length === 0) {
        return {
          totalJobs: 0,
          pendingJobs: 0,
          completedJobs: 0,
          timedOutJobs: 0,
          averageTimeout: 0,
          timeoutDistribution: {}
        };
      }

      // Get timeout data for all jobs
      const pipeline = this.redis.pipeline();
      keys.forEach(key => {
        pipeline.hgetall(key);
      });

      const results = await pipeline.exec();
      const timeoutData = [];

      for (const [error, data] of results) {
        if (error || Object.keys(data).length === 0) continue;
        
        const createdAt = new Date(data.createdAt);
        const timeoutAt = new Date(data.timeoutAt);
        
        // Apply time filter if specified
        if (fromTime && createdAt < fromTime) continue;
        if (toTime && createdAt > toTime) continue;
        
        timeoutData.push({
          ...data,
          timeout: parseInt(data.timeout),
          createdAt: createdAt.getTime(),
          timeoutAt: timeoutAt.getTime()
        });
      }

      // Calculate statistics
      const totalJobs = timeoutData.length;
      const pendingJobs = timeoutData.filter(job => job.status === 'pending').length;
      const completedJobs = timeoutData.filter(job => job.status === 'completed').length;
      const timedOutJobs = timeoutData.filter(job => job.status === 'timed_out').length;
      
      const averageTimeout = timeoutData.reduce((sum, job) => sum + job.timeout, 0) / totalJobs;
      
      const timeoutDistribution = timeoutData.reduce((acc, job) => {
        const timeout = job.timeout;
        const range = this._getTimeoutRange(timeout);
        acc[range] = (acc[range] || 0) + 1;
        return acc;
      }, {});

      return {
        totalJobs,
        pendingJobs,
        completedJobs,
        timedOutJobs,
        completionRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0,
        timeoutRate: totalJobs > 0 ? (timedOutJobs / totalJobs) * 100 : 0,
        averageTimeout: Math.round(averageTimeout),
        timeoutDistribution,
        timeRange: {
          from: fromTime?.toISOString(),
          to: toTime?.toISOString()
        }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getTimeoutStats', { queueId, options });
    }
  },

  /**
   * Get timeout range for distribution
   * @private
   */
  _getTimeoutRange(timeoutMs) {
    if (timeoutMs < 1000) return '< 1s';
    if (timeoutMs < 5000) return '1-5s';
    if (timeoutMs < 30000) return '5-30s';
    if (timeoutMs < 300000) return '30s-5m';
    if (timeoutMs < 1800000) return '5-30m';
    return '> 30m';
  },

  /**
   * Extend job timeout
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID
   * @param {number} additionalMs - Additional timeout in milliseconds
   * @param {Object} options - Extension options
   */
  async extendJobTimeout(queueId, jobId, additionalMs, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    if (typeof additionalMs !== 'number' || additionalMs <= 0) {
      throw new Error('Additional timeout must be a positive number');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, jobId, additionalMs },
          'extendJobTimeout'
        );
      }

      // Get current job data
      const jobData = await this.getItem(queueId, jobId);
      
      if (!jobData.timeout) {
        throw new Error('Job does not have timeout configured');
      }

      if (jobData.status !== 'pending' && jobData.status !== 'processing') {
        throw new Error('Can only extend timeout for pending or processing jobs');
      }

      const currentTimeout = jobData.timeout;
      const newTimeout = currentTimeout + additionalMs;
      const newTimeoutAt = new Date(Date.now() + newTimeout).toISOString();

      // Update job timeout
      await this.updateItem(queueId, jobId, {
        timeout: newTimeout,
        timeoutAt: newTimeoutAt,
        timeoutExtended: true,
        originalTimeout: currentTimeout,
        timeoutExtension: additionalMs,
        extendedAt: new Date().toISOString()
      });

      // Update timeout tracking
      const timeoutKey = `${this.QUEUE_PREFIX}timeout:${queueId}:${jobId}`;
      await this.redis.hset(timeoutKey, {
        timeout: newTimeout.toString(),
        timeoutAt: newTimeoutAt,
        extendedAt: new Date().toISOString(),
        extensionCount: (parseInt(jobData.extensionCount) || 0) + 1
      });

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { jobId, newTimeout, additionalMs },
          'extendJobTimeout'
        );
      }

      // Emit timeout extension event
      this._emitQueueEvent(queueId, 'job:timeout:extended', {
        queueId,
        jobId,
        originalTimeout: currentTimeout,
        newTimeout,
        additionalMs,
        extendedAt: new Date().toISOString()
      });

      return {
        jobId,
        originalTimeout: currentTimeout,
        newTimeout,
        additionalMs
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'extendJobTimeout', { queueId, jobId, additionalMs });
    }
  },

  /**
   * Clean up old timeout tracking data
   * @param {string} queueId - Queue ID
   * @param {Object} options - Cleanup options
   */
  async cleanupTimeoutData(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      olderThanDays = 7,
      onlyCompleted = true
    } = options;

    try {
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const pattern = `${this.QUEUE_PREFIX}timeout:${queueId}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length === 0) {
        return { cleaned: 0 };
      }

      // Get timeout data for all jobs
      const pipeline = this.redis.pipeline();
      keys.forEach(key => {
        pipeline.hgetall(key);
      });

      const results = await pipeline.exec();
      const keysToDelete = [];

      for (let i = 0; i < results.length; i++) {
        const [error, data] = results[i];
        if (error || Object.keys(data).length === 0) continue;
        
        const createdAt = new Date(data.createdAt).getTime();
        const shouldCleanup = createdAt < cutoffTime;
        
        if (shouldCleanup && (!onlyCompleted || data.status === 'completed')) {
          keysToDelete.push(keys[i]);
        }
      }

      // Delete old timeout data
      if (keysToDelete.length > 0) {
        const deletePipeline = this.redis.pipeline();
        keysToDelete.forEach(key => {
          deletePipeline.del(key);
        });
        await deletePipeline.exec();
      }

      // Emit cleanup event
      this._emitQueueEvent(queueId, 'timeout:data:cleaned', {
        queueId,
        cleanedCount: keysToDelete.length,
        olderThanDays
      });

      return { cleaned: keysToDelete.length };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cleanupTimeoutData', { queueId, options });
    }
  }
};

module.exports = TimeoutOperations;

