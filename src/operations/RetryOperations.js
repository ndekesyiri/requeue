/**
 * Retry policy and failure handling operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const RetryOperations = {
  /**
   * Execute a job with retry policy
   * @param {string} queueId - Queue ID
   * @param {Object} jobData - Job data
   * @param {Object} retryPolicy - Retry configuration
   * @param {Function} jobProcessor - Function to execute the job
   * @param {Object} options - Execution options
   */
  async executeWithRetry(queueId, jobData, retryPolicy, jobProcessor, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobProcessor || typeof jobProcessor !== 'function') {
      throw new Error('Job processor must be a function');
    }

    const {
      maxRetries = 3,
      retryDelay = 1000,
      backoffMultiplier = 2,
      maxRetryDelay = 30000,
      retryOn = ['error'], // Array of error types to retry on
      retryCondition = null, // Custom retry condition function
      onRetry = null, // Retry callback
      onMaxRetries = null // Max retries reached callback
    } = retryPolicy;

    const jobId = jobData.id || uuidv4();
    let attempt = 0;
    let lastError = null;
    let totalDelay = 0;

    // Initialize retry tracking
    const retryTracking = {
      jobId,
      queueId,
      startTime: Date.now(),
      attempts: [],
      totalRetries: 0,
      status: 'processing'
    };

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, jobData, retryPolicy },
          'executeWithRetry'
        );
      }

      while (attempt <= maxRetries) {
        attempt++;
        const attemptStartTime = Date.now();
        
        try {
          // Execute the job
          const result = await jobProcessor(jobData, { attempt, totalAttempts: maxRetries + 1 });
          
          // Success - record attempt and return result
          retryTracking.attempts.push({
            attempt,
            success: true,
            duration: Date.now() - attemptStartTime,
            timestamp: new Date().toISOString()
          });
          
          retryTracking.status = 'completed';
          retryTracking.totalRetries = attempt - 1;
          retryTracking.endTime = Date.now();
          retryTracking.totalDuration = retryTracking.endTime - retryTracking.startTime;

          // Store retry history
          await this._storeRetryHistory(queueId, retryTracking);

          // Execute after hooks
          if (options.actions?.afterAction) {
            await this._executeHooks(
              options.actions.afterAction,
              'afterAction',
              queueId,
              { result, retryTracking },
              'executeWithRetry'
            );
          }

          // Emit success event
          this._emitQueueEvent(queueId, 'job:retry:success', {
            queueId,
            jobId,
            result,
            retryTracking
          });

          return {
            success: true,
            result,
            retryTracking
          };

        } catch (error) {
          lastError = error;
          const attemptDuration = Date.now() - attemptStartTime;
          
          // Record failed attempt
          retryTracking.attempts.push({
            attempt,
            success: false,
            error: error.message,
            errorType: error.constructor.name,
            duration: attemptDuration,
            timestamp: new Date().toISOString()
          });

          // Check if we should retry
          const shouldRetry = this._shouldRetry(error, retryOn, retryCondition, attempt, maxRetries);
          
          if (!shouldRetry || attempt > maxRetries) {
            // Max retries reached or retry condition not met
            retryTracking.status = 'failed';
            retryTracking.totalRetries = attempt - 1;
            retryTracking.endTime = Date.now();
            retryTracking.totalDuration = retryTracking.endTime - retryTracking.startTime;
            retryTracking.finalError = error.message;

            // Store retry history
            await this._storeRetryHistory(queueId, retryTracking);

            // Execute max retries callback
            if (onMaxRetries && typeof onMaxRetries === 'function') {
              await onMaxRetries(error, retryTracking);
            }

            // Route to dead letter queue if configured
            if (options.deadLetterQueue) {
              await this._routeToDeadLetterQueue(queueId, jobData, error, retryTracking, options.deadLetterQueue);
            }

            // Execute after hooks for failure
            if (options.actions?.afterFailure) {
              await this._executeHooks(
                options.actions.afterFailure,
                'afterFailure',
                queueId,
                { error, retryTracking },
                'executeWithRetry'
              );
            }

            // Emit failure event
            this._emitQueueEvent(queueId, 'job:retry:failed', {
              queueId,
              jobId,
              error: error.message,
              retryTracking
            });

            throw new Error(`Job failed after ${attempt} attempts: ${error.message}`);
          }

          // Calculate delay for next retry
          const delay = this._calculateRetryDelay(attempt, retryDelay, backoffMultiplier, maxRetryDelay);
          totalDelay += delay;

          // Execute retry callback
          if (onRetry && typeof onRetry === 'function') {
            await onRetry(error, attempt, delay, retryTracking);
          }

          // Emit retry event
          this._emitQueueEvent(queueId, 'job:retry:attempt', {
            queueId,
            jobId,
            attempt,
            error: error.message,
            nextRetryIn: delay,
            retryTracking
          });

          // Wait before next retry
          if (attempt <= maxRetries) {
            await this._sleep(delay);
          }
        }
      }

    } catch (error) {
      // Final error handling
      retryTracking.status = 'error';
      retryTracking.finalError = error.message;
      retryTracking.endTime = Date.now();
      retryTracking.totalDuration = retryTracking.endTime - retryTracking.startTime;

      await this._storeRetryHistory(queueId, retryTracking);

      throw this.errorHandlers.handleError(error, 'executeWithRetry', {
        queueId,
        jobData,
        retryTracking
      });
    }
  },

  /**
   * Determine if a job should be retried
   * @private
   */
  _shouldRetry(error, retryOn, retryCondition, attempt, maxRetries) {
    // Check if we've exceeded max retries
    if (attempt > maxRetries) {
      return false;
    }

    // Check custom retry condition
    if (retryCondition && typeof retryCondition === 'function') {
      return retryCondition(error, attempt);
    }

    // Check error type
    const errorType = error.constructor.name;
    return retryOn.includes(errorType) || retryOn.includes('error');
  },

  /**
   * Calculate retry delay with exponential backoff
   * @private
   */
  _calculateRetryDelay(attempt, baseDelay, multiplier, maxDelay) {
    const delay = baseDelay * Math.pow(multiplier, attempt - 1);
    return Math.min(delay, maxDelay);
  },

  /**
   * Sleep utility
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Store retry history for audit trail
   * @private
   */
  async _storeRetryHistory(queueId, retryTracking) {
    try {
      const historyKey = `${this.QUEUE_PREFIX}retry:history:${queueId}`;
      const jobHistoryKey = `${this.QUEUE_PREFIX}retry:job:${retryTracking.jobId}`;
      
      await this.redis.executePipeline([
        { command: 'hset', args: [jobHistoryKey, {
          jobId: retryTracking.jobId,
          queueId: retryTracking.queueId,
          status: retryTracking.status,
          totalRetries: retryTracking.totalRetries,
          totalDuration: retryTracking.totalDuration,
          startTime: retryTracking.startTime,
          endTime: retryTracking.endTime,
          finalError: retryTracking.finalError || '',
          attempts: JSON.stringify(retryTracking.attempts),
          timestamp: new Date().toISOString()
        }] },
        { command: 'zadd', args: [historyKey, Date.now(), retryTracking.jobId] },
        { command: 'pexpire', args: [jobHistoryKey, 7 * 24 * 60 * 60 * 1000] }
      ]);

    } catch (error) {
      console.error('QueueManager: Error storing retry history:', error.message);
    }
  },

  /**
   * Route failed job to dead letter queue
   * @private
   */
  async _routeToDeadLetterQueue(queueId, jobData, error, retryTracking, dlqConfig) {
    try {
      const dlqQueueId = dlqConfig.queueId || `${queueId}-dlq`;
      const dlqItem = {
        id: uuidv4(),
        data: jobData,
        originalQueueId: queueId,
        originalJobId: jobData.id,
        failureReason: error.message,
        retryHistory: retryTracking,
        routedAt: new Date().toISOString(),
        status: 'failed',
        metadata: {
          ...dlqConfig.metadata,
          dlq: true,
          originalQueue: queueId
        }
      };

      // Ensure DLQ exists
      if (!(await this.queueExists(dlqQueueId))) {
        await this.createQueue(dlqQueueId, dlqQueueId, {
          description: `Dead letter queue for ${queueId}`,
          maxSize: dlqConfig.maxSize || 10000,
          retentionDays: dlqConfig.retentionDays || 30
        });
      }

      // Add to DLQ
      await this.addToQueue(dlqQueueId, dlqItem.data, {
        itemId: dlqItem.id,
        metadata: dlqItem.metadata
      });

      // Emit DLQ routing event
      this._emitQueueEvent(queueId, 'job:routed:dlq', {
        originalQueueId: queueId,
        dlqQueueId,
        jobId: dlqItem.id,
        originalJobId: jobData.id,
        failureReason: error.message
      });

    } catch (dlqError) {
      console.error('QueueManager: Error routing to dead letter queue:', dlqError.message);
    }
  },

  /**
   * Get retry history for a job
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID
   */
  async getRetryHistory(queueId, jobId) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    try {
      const jobHistoryKey = `${this.QUEUE_PREFIX}retry:job:${jobId}`;
      const historyData = await this.redis.hgetall(jobHistoryKey);
      
      if (Object.keys(historyData).length === 0) {
        return null;
      }

      return {
        ...historyData,
        attempts: JSON.parse(historyData.attempts || '[]'),
        totalRetries: parseInt(historyData.totalRetries) || 0,
        totalDuration: parseInt(historyData.totalDuration) || 0,
        startTime: parseInt(historyData.startTime) || 0,
        endTime: parseInt(historyData.endTime) || 0
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getRetryHistory', { queueId, jobId });
    }
  },

  /**
   * Get retry statistics for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getRetryStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      fromTime = null,
      toTime = null,
      limit = 100
    } = options;

    try {
      const historyKey = `${this.QUEUE_PREFIX}retry:history:${queueId}`;
      
      // Build time range query
      let minScore = fromTime ? fromTime.getTime() : '-inf';
      let maxScore = toTime ? toTime.getTime() : '+inf';
      
      // Get job IDs in time range
      const jobIds = await this.redis.zrangebyscore(
        historyKey,
        minScore,
        maxScore,
        'LIMIT',
        0,
        limit
      );

      if (jobIds.length === 0) {
        return {
          totalJobs: 0,
          successfulJobs: 0,
          failedJobs: 0,
          averageRetries: 0,
          averageDuration: 0,
          retryDistribution: {},
          recentFailures: []
        };
      }

      // Get retry data for all jobs
      const commands = jobIds.map(jobId => ({
        command: 'hgetall',
        args: [`${this.QUEUE_PREFIX}retry:job:${jobId}`]
      }));

      const results = await this.redis.executePipeline(commands);
      const retryData = [];

      for (const [error, data] of results) {
        if (error || Object.keys(data).length === 0) continue;
        retryData.push({
          ...data,
          totalRetries: parseInt(data.totalRetries) || 0,
          totalDuration: parseInt(data.totalDuration) || 0,
          status: data.status
        });
      }

      // Calculate statistics
      const totalJobs = retryData.length;
      const successfulJobs = retryData.filter(job => job.status === 'completed').length;
      const failedJobs = retryData.filter(job => job.status === 'failed').length;
      const averageRetries = retryData.reduce((sum, job) => sum + job.totalRetries, 0) / totalJobs;
      const averageDuration = retryData.reduce((sum, job) => sum + job.totalDuration, 0) / totalJobs;

      // Retry distribution
      const retryDistribution = retryData.reduce((acc, job) => {
        const retries = job.totalRetries;
        acc[retries] = (acc[retries] || 0) + 1;
        return acc;
      }, {});

      // Recent failures
      const recentFailures = retryData
        .filter(job => job.status === 'failed')
        .sort((a, b) => parseInt(b.endTime) - parseInt(a.endTime))
        .slice(0, 10);

      return {
        totalJobs,
        successfulJobs,
        failedJobs,
        successRate: totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 0,
        averageRetries: Math.round(averageRetries * 100) / 100,
        averageDuration: Math.round(averageDuration),
        retryDistribution,
        recentFailures: recentFailures.map(job => ({
          jobId: job.jobId,
          totalRetries: job.totalRetries,
          finalError: job.finalError,
          failedAt: new Date(parseInt(job.endTime)).toISOString()
        }))
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getRetryStats', { queueId, options });
    }
  },

  /**
   * Clean up old retry history
   * @param {string} queueId - Queue ID
   * @param {number} olderThanDays - Remove history older than this many days
   */
  async cleanupRetryHistory(queueId, olderThanDays = 7) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const historyKey = `${this.QUEUE_PREFIX}retry:history:${queueId}`;
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      
      // Get old job IDs
      const oldJobIds = await this.redis.zrangebyscore(historyKey, '-inf', cutoffTime);
      
      if (oldJobIds.length === 0) {
        return { cleaned: 0 };
      }

      // Remove old job history
      const commands = [];
      oldJobIds.forEach(jobId => {
        commands.push(
          { command: 'zrem', args: [historyKey, jobId] },
          { command: 'del', args: [`${this.QUEUE_PREFIX}retry:job:${jobId}`] }
        );
      });

      if (commands.length > 0) {
        await this.redis.executePipeline(commands);
      }

      // Emit cleanup event
      this._emitQueueEvent(queueId, 'retry:history:cleaned', {
        queueId,
        cleanedCount: oldJobIds.length,
        olderThanDays
      });

      return { cleaned: oldJobIds.length };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cleanupRetryHistory', { queueId, olderThanDays });
    }
  }
};

module.exports = RetryOperations;

