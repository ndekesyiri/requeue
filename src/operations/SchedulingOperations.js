/**
 * Delayed jobs and scheduling operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const SchedulingOperations = {
  /**
   * Schedule a job to run at a specific time
   * @param {string} queueId - Target queue ID
   * @param {Object} jobData - Job data
   * @param {Date|number|string} scheduleTime - When to execute the job
   * @param {Object} options - Scheduling options
   */
  async scheduleJob(queueId, jobData, scheduleTime, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobData || typeof jobData !== 'object') {
      throw new Error('Job data must be an object');
    }

    // Parse schedule time
    let executionTime;
    if (scheduleTime instanceof Date) {
      executionTime = scheduleTime.getTime();
    } else if (typeof scheduleTime === 'number') {
      executionTime = scheduleTime;
    } else if (typeof scheduleTime === 'string') {
      executionTime = new Date(scheduleTime).getTime();
    } else {
      throw new Error('Schedule time must be a Date, timestamp, or ISO string');
    }

    if (executionTime <= Date.now()) {
      throw new Error('Schedule time must be in the future');
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
          { queueId, jobData, scheduleTime: executionTime, jobId },
          'scheduleJob'
        );
      }

      // Create scheduled job object
      const scheduledJob = {
        id: jobId,
        queueId,
        data: jobData,
        scheduledFor: executionTime,
        scheduledAt: timestamp,
        status: 'scheduled',
        priority: options.priority || 0,
        retryPolicy: options.retryPolicy || null,
        timeout: options.timeout || null,
        dependencies: options.dependencies || [],
        metadata: {
          ...options.metadata,
          version: '2.0',
          scheduledBy: options.scheduledBy || 'system'
        }
      };

      // Store in Redis sorted set for time-based retrieval
      const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
      const jobDataKey = `${this.QUEUE_PREFIX}job:${jobId}`;
      
      // Use RedisManager's pipeline method
      await this.redis.executePipeline([
        { command: 'hset', args: [jobDataKey, {
          ...scheduledJob,
          scheduledFor: executionTime.toString(),
          scheduledAt: timestamp
        }] },
        { command: 'zadd', args: [scheduledJobsKey, executionTime, jobId] },
        { command: 'pexpire', args: [jobDataKey, options.ttl || 7 * 24 * 60 * 60 * 1000] }
      ]);

      // Update cache if enabled
      if (this.cache.config.enabled) {
        this.cache.set('scheduled_job', jobId, scheduledJob);
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          scheduledJob,
          'scheduleJob'
        );
      }

      // Emit scheduling event
      this._emitQueueEvent(queueId, 'job:scheduled', {
        queueId,
        jobId,
        scheduledJob,
        executionTime: new Date(executionTime).toISOString()
      });

      return scheduledJob;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'scheduleJob', {
        queueId,
        jobData,
        scheduleTime: executionTime
      });
    }
  },

  /**
   * Get scheduled jobs for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getScheduledJobs(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      limit = 100,
      offset = 0,
      fromTime = null,
      toTime = null,
      status = null
    } = options;

    try {
      const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
      
      // Build query parameters
      let minScore = fromTime ? fromTime.getTime() : '-inf';
      let maxScore = toTime ? toTime.getTime() : '+inf';
      
      // Get job IDs from sorted set
      const jobIds = await this.redis.zrangebyscore(
        scheduledJobsKey,
        minScore,
        maxScore,
        'LIMIT',
        offset,
        limit
      );

      if (jobIds.length === 0) {
        return { jobs: [], total: 0, offset, limit };
      }

      // Get job details
      const pipeline = this.redis.pipeline();
      jobIds.forEach(jobId => {
        pipeline.hgetall(`${this.QUEUE_PREFIX}job:${jobId}`);
      });

      const results = await pipeline.exec();
      const jobs = [];

      for (let i = 0; i < results.length; i++) {
        const [error, jobData] = results[i];
        if (error) continue;
        
        if (Object.keys(jobData).length > 0) {
          // Convert string values back to appropriate types
          const job = {
            ...jobData,
            scheduledFor: parseInt(jobData.scheduledFor),
            priority: parseInt(jobData.priority) || 0,
            timeout: jobData.timeout ? parseInt(jobData.timeout) : null
          };

          // Filter by status if specified
          if (!status || job.status === status) {
            jobs.push(job);
          }
        }
      }

      // Get total count
      const total = await this.redis.zcard(scheduledJobsKey);

      return {
        jobs,
        total,
        offset,
        limit,
        hasMore: offset + limit < total
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getScheduledJobs', { queueId, options });
    }
  },

  /**
   * Cancel a scheduled job
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID to cancel
   * @param {Object} options - Cancellation options
   */
  async cancelScheduledJob(queueId, jobId, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, jobId },
          'cancelScheduledJob'
        );
      }

      const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
      const jobDataKey = `${this.QUEUE_PREFIX}job:${jobId}`;

      // Check if job exists
      const jobExists = await this.redis.zscore(scheduledJobsKey, jobId);
      if (!jobExists) {
        throw new Error(`Scheduled job ${jobId} not found in queue ${queueId}`);
      }

      // Get job data before deletion
      const jobData = await this.redis.hgetall(jobDataKey);
      
      // Remove from scheduled jobs and delete job data
      await this.redis.executePipeline([
        { command: 'zrem', args: [scheduledJobsKey, jobId] },
        { command: 'del', args: [jobDataKey] }
      ]);

      // Remove from cache
      if (this.cache.config.enabled) {
        this.cache.delete('scheduled_job', jobId);
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { ...jobData, status: 'cancelled' },
          'cancelScheduledJob'
        );
      }

      // Emit cancellation event
      this._emitQueueEvent(queueId, 'job:cancelled', {
        queueId,
        jobId,
        cancelledJob: { ...jobData, status: 'cancelled' }
      });

      return {
        success: true,
        jobId,
        cancelledJob: { ...jobData, status: 'cancelled' }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cancelScheduledJob', { queueId, jobId });
    }
  },

  /**
   * Process due scheduled jobs (internal method)
   * @param {string} queueId - Queue ID
   * @param {number} currentTime - Current timestamp
   */
  async processDueJobs(queueId, currentTime = Date.now()) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
      
      // Get jobs that are due (score <= currentTime)
      const dueJobIds = await this.redis.zrangebyscore(
        scheduledJobsKey,
        '-inf',
        currentTime,
        'LIMIT',
        0,
        100 // Process up to 100 jobs at a time
      );

      if (dueJobIds.length === 0) {
        return { processed: 0, jobs: [] };
      }

      const processedJobs = [];
      
      // Get job data for all due jobs
      const commands = dueJobIds.map(jobId => ({
        command: 'hgetall',
        args: [`${this.QUEUE_PREFIX}job:${jobId}`]
      }));

      const results = await this.redis.executePipeline(commands);

      for (let i = 0; i < results.length; i++) {
        const [error, jobData] = results[i];
        if (error || Object.keys(jobData).length === 0) continue;

        const job = {
          ...jobData,
          scheduledFor: parseInt(jobData.scheduledFor),
          priority: parseInt(jobData.priority) || 0,
          timeout: jobData.timeout ? parseInt(jobData.timeout) : null
        };

        try {
          // Add job to the target queue
          const queueItem = {
            id: job.id,
            data: job.data,
            addedAt: new Date().toISOString(),
            status: 'pending',
            scheduledJob: true,
            originalScheduleTime: job.scheduledFor,
            priority: job.priority,
            retryPolicy: job.retryPolicy,
            timeout: job.timeout,
            dependencies: job.dependencies,
            metadata: job.metadata
          };

          // Add to queue using existing method
          await this.addToQueue(queueId, queueItem.data, {
            itemId: job.id,
            priority: job.priority,
            retryPolicy: job.retryPolicy,
            timeout: job.timeout,
            dependencies: job.dependencies,
            metadata: {
              ...job.metadata,
              scheduledJob: true,
              originalScheduleTime: job.scheduledFor
            }
          });

          processedJobs.push(job);

          // Remove from scheduled jobs
          this.redis.zrem(scheduledJobsKey, job.id);
          this.redis.del(`${this.QUEUE_PREFIX}job:${job.id}`);

        } catch (jobError) {
          console.error(`QueueManager: Error processing scheduled job ${job.id}:`, jobError.message);
          // Mark job as failed but don't remove from scheduled set
          await this.redis.hset(`${this.QUEUE_PREFIX}job:${job.id}`, 'status', 'failed');
        }
      }

      // Emit processing event
      if (processedJobs.length > 0) {
        this._emitQueueEvent(queueId, 'scheduled:jobs:processed', {
          queueId,
          processedCount: processedJobs.length,
          jobs: processedJobs
        });
      }

      return {
        processed: processedJobs.length,
        jobs: processedJobs
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'processDueJobs', { queueId, currentTime });
    }
  },

  /**
   * Get next scheduled job execution time
   * @param {string} queueId - Queue ID
   */
  async getNextScheduledTime(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
      
      // Get the job with the lowest score (earliest execution time)
      const result = await this.redis.zrange(scheduledJobsKey, 0, 0, 'WITHSCORES');
      
      if (result.length === 0) {
        return null;
      }

      return {
        jobId: result[0],
        executionTime: parseInt(result[1]),
        executionTimeISO: new Date(parseInt(result[1])).toISOString()
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getNextScheduledTime', { queueId });
    }
  },

  /**
   * Reschedule a job to a new time
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Job ID
   * @param {Date|number|string} newScheduleTime - New execution time
   * @param {Object} options - Reschedule options
   */
  async rescheduleJob(queueId, jobId, newScheduleTime, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job ID must be a non-empty string');
    }

    // Parse new schedule time
    let executionTime;
    if (newScheduleTime instanceof Date) {
      executionTime = newScheduleTime.getTime();
    } else if (typeof newScheduleTime === 'number') {
      executionTime = newScheduleTime;
    } else if (typeof newScheduleTime === 'string') {
      executionTime = new Date(newScheduleTime).getTime();
    } else {
      throw new Error('New schedule time must be a Date, timestamp, or ISO string');
    }

    if (executionTime <= Date.now()) {
      throw new Error('New schedule time must be in the future');
    }

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, jobId, newScheduleTime: executionTime },
          'rescheduleJob'
        );
      }

      const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
      const jobDataKey = `${this.QUEUE_PREFIX}job:${jobId}`;

      // Check if job exists
      const jobExists = await this.redis.zscore(scheduledJobsKey, jobId);
      if (!jobExists) {
        throw new Error(`Scheduled job ${jobId} not found in queue ${queueId}`);
      }

      // Get current job data
      const currentJobData = await this.redis.hgetall(jobDataKey);
      if (Object.keys(currentJobData).length === 0) {
        throw new Error(`Job data for ${jobId} not found`);
      }

      // Update job with new schedule time
      const updatedJobData = {
        ...currentJobData,
        scheduledFor: executionTime.toString(),
        updatedAt: new Date().toISOString(),
        rescheduledCount: (parseInt(currentJobData.rescheduledCount) || 0) + 1
      };

      // Update job data and schedule
      await this.redis.executePipeline([
        { command: 'hset', args: [jobDataKey, updatedJobData] },
        { command: 'zadd', args: [scheduledJobsKey, executionTime, jobId] }
      ]);

      // Update cache
      if (this.cache.config.enabled) {
        this.cache.set('scheduled_job', jobId, {
          ...updatedJobData,
          scheduledFor: executionTime
        });
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { ...updatedJobData, scheduledFor: executionTime },
          'rescheduleJob'
        );
      }

      // Emit reschedule event
      this._emitQueueEvent(queueId, 'job:rescheduled', {
        queueId,
        jobId,
        oldScheduleTime: parseInt(currentJobData.scheduledFor),
        newScheduleTime: executionTime,
        updatedJob: { ...updatedJobData, scheduledFor: executionTime }
      });

      return {
        success: true,
        jobId,
        oldScheduleTime: parseInt(currentJobData.scheduledFor),
        newScheduleTime: executionTime,
        updatedJob: { ...updatedJobData, scheduledFor: executionTime }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'rescheduleJob', { queueId, jobId, newScheduleTime: executionTime });
    }
  }
};

module.exports = SchedulingOperations;

