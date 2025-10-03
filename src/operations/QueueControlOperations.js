/**
 * Queue control operations (pause, resume, batch operations)
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const QueueControlOperations = {
  /**
   * Pause a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Pause options
   */
  async pauseQueue(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      reason = 'Manual pause',
      pauseScheduledJobs = true,
      pauseProcessing = true
    } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'pauseQueue'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const pauseInfo = {
        paused: true,
        pausedAt: new Date().toISOString(),
        pausedBy: options.pausedBy || 'system',
        reason,
        pauseScheduledJobs,
        pauseProcessing
      };

      // Update queue metadata
      await this.updateQueue(queueId, {
        ...pauseInfo,
        status: 'paused'
      });

      // Pause scheduled jobs if requested
      if (pauseScheduledJobs) {
        await this._pauseScheduledJobs(queueId);
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          pauseInfo,
          'pauseQueue'
        );
      }

      // Emit pause event
      this._emitQueueEvent(queueId, 'queue:paused', {
        queueId,
        pauseInfo
      });

      return pauseInfo;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'pauseQueue', { queueId, options });
    }
  },

  /**
   * Resume a paused queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Resume options
   */
  async resumeQueue(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'resumeQueue'
        );
      }

      // Verify queue exists
      const queue = await this._getQueueFromCacheOrRedis(queueId);
      
      if (!queue.paused) {
        throw new Error(`Queue ${queueId} is not paused`);
      }

      const resumeInfo = {
        paused: false,
        resumedAt: new Date().toISOString(),
        resumedBy: options.resumedBy || 'system',
        pausedDuration: Date.now() - new Date(queue.pausedAt).getTime()
      };

      // Update queue metadata
      await this.updateQueue(queueId, {
        ...resumeInfo,
        status: 'active',
        paused: false,
        pausedAt: null,
        reason: null
      });

      // Resume scheduled jobs
      await this._resumeScheduledJobs(queueId);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          resumeInfo,
          'resumeQueue'
        );
      }

      // Emit resume event
      this._emitQueueEvent(queueId, 'queue:resumed', {
        queueId,
        resumeInfo
      });

      return resumeInfo;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'resumeQueue', { queueId, options });
    }
  },

  /**
   * Pause scheduled jobs for a queue
   * @private
   */
  async _pauseScheduledJobs(queueId) {
    const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
    const pauseKey = `${this.QUEUE_PREFIX}scheduled:paused:${queueId}`;
    
    // Get all scheduled job IDs
    const jobIds = await this.redis.zrange(scheduledJobsKey, 0, -1);
    
    if (jobIds.length > 0) {
      // Store paused jobs
      await this.redis.sadd(pauseKey, ...jobIds);
      await this.redis.pexpire(pauseKey, 7 * 24 * 60 * 60 * 1000); // 7 days
    }
  },

  /**
   * Resume scheduled jobs for a queue
   * @private
   */
  async _resumeScheduledJobs(queueId) {
    const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
    const pauseKey = `${this.QUEUE_PREFIX}scheduled:paused:${queueId}`;
    
    // Get paused job IDs
    const pausedJobIds = await this.redis.smembers(pauseKey);
    
    if (pausedJobIds.length > 0) {
      // Remove from paused set
      await this.redis.del(pauseKey);
    }
  },

  /**
   * Cancel multiple jobs in a queue
   * @param {string} queueId - Queue ID
   * @param {Array} jobIds - Array of job IDs to cancel
   * @param {Object} options - Cancellation options
   */
  async cancelJobs(queueId, jobIds, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      throw new Error('Job IDs must be a non-empty array');
    }

    const {
      reason = 'Batch cancellation',
      cancelScheduledJobs = true,
      cancelPendingJobs = true,
      cancelProcessingJobs = false
    } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, jobIds, options },
          'cancelJobs'
        );
      }

      const cancelledJobs = [];
      const failedCancellations = [];

      // Cancel each job
      for (const jobId of jobIds) {
        try {
          const result = await this._cancelSingleJob(queueId, jobId, {
            reason,
            cancelScheduledJobs,
            cancelPendingJobs,
            cancelProcessingJobs
          });
          
          if (result.success) {
            cancelledJobs.push(result.jobId);
          } else {
            failedCancellations.push({ jobId, error: result.error });
          }
        } catch (error) {
          failedCancellations.push({ jobId, error: error.message });
        }
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { cancelledJobs, failedCancellations },
          'cancelJobs'
        );
      }

      // Emit batch cancellation event
      this._emitQueueEvent(queueId, 'jobs:cancelled:batch', {
        queueId,
        cancelledJobs,
        failedCancellations,
        totalRequested: jobIds.length,
        successCount: cancelledJobs.length,
        failureCount: failedCancellations.length
      });

      return {
        cancelled: cancelledJobs,
        failed: failedCancellations,
        successCount: cancelledJobs.length,
        failureCount: failedCancellations.length
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cancelJobs', { queueId, jobIds, options });
    }
  },

  /**
   * Cancel a single job
   * @private
   */
  async _cancelSingleJob(queueId, jobId, options) {
    try {
      // Check if job exists in queue
      const item = await this.getItem(queueId, jobId);
      
      if (!item) {
        return { success: false, jobId, error: 'Job not found' };
      }

      // Check if job can be cancelled based on status
      if (item.status === 'completed') {
        return { success: false, jobId, error: 'Cannot cancel completed job' };
      }

      if (item.status === 'processing' && !options.cancelProcessingJobs) {
        return { success: false, jobId, error: 'Cannot cancel processing job' };
      }

      // Cancel the job
      await this.updateItem(queueId, jobId, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancellationReason: options.reason
      });

      // Cancel scheduled job if it exists
      if (options.cancelScheduledJobs) {
        try {
          await this.cancelScheduledJob(queueId, jobId);
        } catch (error) {
          // Scheduled job might not exist, which is fine
        }
      }

      return { success: true, jobId };

    } catch (error) {
      return { success: false, jobId, error: error.message };
    }
  },

  /**
   * Cancel jobs by criteria
   * @param {string} queueId - Queue ID
   * @param {Object} criteria - Cancellation criteria
   * @param {Object} options - Cancellation options
   */
  async cancelJobsByCriteria(queueId, criteria, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      status = null,
      priority = null,
      addedBefore = null,
      addedAfter = null,
      limit = 1000,
      reason = 'Criteria-based cancellation'
    } = criteria;

    try {
      // Get all items
      const allItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Filter items based on criteria
      let filteredItems = allItems;

      if (status) {
        filteredItems = filteredItems.filter(item => item.status === status);
      }

      if (priority !== null) {
        filteredItems = filteredItems.filter(item => (item.priority || 0) === priority);
      }

      if (addedBefore) {
        const beforeTime = new Date(addedBefore).getTime();
        filteredItems = filteredItems.filter(item => 
          new Date(item.addedAt).getTime() < beforeTime
        );
      }

      if (addedAfter) {
        const afterTime = new Date(addedAfter).getTime();
        filteredItems = filteredItems.filter(item => 
          new Date(item.addedAt).getTime() > afterTime
        );
      }

      // Apply limit
      const itemsToCancel = filteredItems.slice(0, limit);
      const jobIds = itemsToCancel.map(item => item.id);

      // Cancel the filtered jobs
      return await this.cancelJobs(queueId, jobIds, {
        ...options,
        reason
      });

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cancelJobsByCriteria', { queueId, criteria, options });
    }
  },

  /**
   * Clear all items from a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Clear options
   */
  async clearQueue(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      clearScheduledJobs = true,
      clearCompletedJobs = false,
      reason = 'Queue clear'
    } = options;

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'clearQueue'
        );
      }

      // Get current items
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      let itemsToClear = items;
      
      // Filter based on options
      if (!clearCompletedJobs) {
        itemsToClear = itemsToClear.filter(item => item.status !== 'completed');
      }

      const clearedCount = itemsToClear.length;

      // Clear queue items
      const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
      await this.redis.del(itemsKey);

      // Clear scheduled jobs if requested
      if (clearScheduledJobs) {
        const scheduledJobsKey = `${this.QUEUE_PREFIX}scheduled:${queueId}`;
        await this.redis.del(scheduledJobsKey);
      }

      // Update cache
      this._updateCache(queueId, null, []);

      // Update queue item count
      await this._updateQueueItemCount(queueId, 0);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { clearedCount },
          'clearQueue'
        );
      }

      // Emit clear event
      this._emitQueueEvent(queueId, 'queue:cleared', {
        queueId,
        clearedCount,
        reason
      });

      return {
        cleared: clearedCount,
        reason
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'clearQueue', { queueId, options });
    }
  },

  /**
   * Get queue control status
   * @param {string} queueId - Queue ID
   */
  async getQueueControlStatus(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const queue = await this._getQueueFromCacheOrRedis(queueId);
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Count items by status
      const statusCounts = items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      // Check for paused scheduled jobs
      const pauseKey = `${this.QUEUE_PREFIX}scheduled:paused:${queueId}`;
      const pausedScheduledJobs = await this.redis.scard(pauseKey);

      return {
        queueId,
        paused: queue.paused || false,
        pausedAt: queue.pausedAt || null,
        pauseReason: queue.reason || null,
        statusCounts,
        totalItems: items.length,
        pausedScheduledJobs,
        canResume: queue.paused === true,
        canPause: queue.paused !== true
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getQueueControlStatus', { queueId });
    }
  },

  /**
   * Bulk operations on multiple queues
   * @param {Array} queueIds - Array of queue IDs
   * @param {string} operation - Operation to perform
   * @param {Object} options - Operation options
   */
  async bulkQueueOperation(queueIds, operation, options = {}) {
    if (!Array.isArray(queueIds) || queueIds.length === 0) {
      throw new Error('Queue IDs must be a non-empty array');
    }

    const validOperations = ['pause', 'resume', 'clear'];
    if (!validOperations.includes(operation)) {
      throw new Error(`Operation must be one of: ${validOperations.join(', ')}`);
    }

    try {
      const results = [];
      const errors = [];

      // Execute operation on each queue
      for (const queueId of queueIds) {
        try {
          let result;
          
          switch (operation) {
            case 'pause':
              result = await this.pauseQueue(queueId, options);
              break;
            case 'resume':
              result = await this.resumeQueue(queueId, options);
              break;
            case 'clear':
              result = await this.clearQueue(queueId, options);
              break;
          }
          
          results.push({ queueId, success: true, result });
        } catch (error) {
          errors.push({ queueId, error: error.message });
        }
      }

      // Emit bulk operation event
      this.events.emit('queues:bulk:operation', {
        operation,
        totalQueues: queueIds.length,
        successCount: results.length,
        errorCount: errors.length,
        results,
        errors
      });

      return {
        operation,
        totalQueues: queueIds.length,
        successCount: results.length,
        errorCount: errors.length,
        results,
        errors
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'bulkQueueOperation', { queueIds, operation, options });
    }
  },

  /**
   * Emergency stop all queues
   * @param {Object} options - Emergency stop options
   */
  async emergencyStop(options = {}) {
    const {
      reason = 'Emergency stop',
      stopProcessing = true,
      stopScheduledJobs = true,
      preserveData = true
    } = options;

    try {
      // Get all queues
      const allQueues = await this.getAllQueues({ limit: 1000 });
      
      const results = [];
      
      for (const queue of allQueues.queues) {
        try {
          // Pause queue
          await this.pauseQueue(queue.id, {
            reason,
            pauseScheduledJobs: stopScheduledJobs,
            pauseProcessing: stopProcessing
          });
          
          results.push({ queueId: queue.id, success: true });
        } catch (error) {
          results.push({ queueId: queue.id, success: false, error: error.message });
        }
      }

      // Emit emergency stop event
      this.events.emit('system:emergency:stop', {
        reason,
        totalQueues: allQueues.queues.length,
        successCount: results.filter(r => r.success).length,
        results
      });

      return {
        reason,
        totalQueues: allQueues.queues.length,
        successCount: results.filter(r => r.success).length,
        results
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'emergencyStop', { options });
    }
  }
};

module.exports = QueueControlOperations;

