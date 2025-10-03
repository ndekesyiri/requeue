/**
 * Job dependencies and chaining operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const DependencyOperations = {
  /**
   * Add job with dependencies
   * @param {string} queueId - Queue ID
   * @param {Object} jobData - Job data
   * @param {Array} dependencies - Array of dependency job IDs
   * @param {Object} options - Job options
   */
  async addJobWithDependencies(queueId, jobData, dependencies = [], options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (jobData === undefined || jobData === null) {
      throw new Error('Job data cannot be null or undefined');
    }

    if (!Array.isArray(dependencies)) {
      throw new Error('Dependencies must be an array');
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
          { queueId, jobData, dependencies },
          'addJobWithDependencies'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      // Validate dependencies exist
      if (dependencies.length > 0) {
        await this._validateDependencies(queueId, dependencies);
      }

      const jobItem = {
        id: jobId,
        data: jobData,
        addedAt: timestamp,
        status: dependencies.length > 0 ? 'waiting' : 'pending',
        dependencies,
        dependencyStatus: this._createDependencyStatus(dependencies),
        version: '2.0',
        ...options
      };

      // Store job with dependencies
      await this._storeJobWithDependencies(queueId, jobItem);

      // Check if all dependencies are satisfied
      if (dependencies.length === 0) {
        await this._markJobAsReady(queueId, jobId);
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          jobItem,
          'addJobWithDependencies'
        );
      }

      // Emit job added event
      this._emitQueueEvent(queueId, 'job:added:dependencies', {
        queueId,
        jobId,
        dependencies,
        status: jobItem.status
      });

      return jobItem;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'addJobWithDependencies', {
        queueId,
        jobData,
        dependencies
      });
    }
  },

  /**
   * Create dependency status tracking object
   * @private
   */
  _createDependencyStatus(dependencies) {
    const status = {};
    dependencies.forEach(depId => {
      status[depId] = {
        satisfied: false,
        completedAt: null,
        failed: false
      };
    });
    return status;
  },

  /**
   * Validate that all dependencies exist
   * @private
   */
  async _validateDependencies(queueId, dependencies) {
    const pipeline = this.redis.pipeline();
    
    dependencies.forEach(depId => {
      const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${depId}`;
      pipeline.exists(itemKey);
    });

    const results = await pipeline.exec();
    const missingDependencies = [];

    for (let i = 0; i < results.length; i++) {
      const [error, exists] = results[i];
      if (error || !exists) {
        missingDependencies.push(dependencies[i]);
      }
    }

    if (missingDependencies.length > 0) {
      throw new Error(`Missing dependencies: ${missingDependencies.join(', ')}`);
    }
  },

  /**
   * Store job with dependency tracking
   * @private
   */
  async _storeJobWithDependencies(queueId, jobItem) {
    const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${jobItem.id}`;
    const dependencyKey = `${this.QUEUE_PREFIX}dependencies:${queueId}:${jobItem.id}`;
    
    const pipeline = this.redis.pipeline();
    
    // Store job item
    pipeline.hset(itemKey, {
      ...jobItem,
      dependencies: JSON.stringify(jobItem.dependencies),
      dependencyStatus: JSON.stringify(jobItem.dependencyStatus),
      addedAt: jobItem.addedAt
    });
    
    // Store dependency relationships
    if (jobItem.dependencies.length > 0) {
      pipeline.sadd(dependencyKey, ...jobItem.dependencies);
      pipeline.pexpire(dependencyKey, 7 * 24 * 60 * 60 * 1000); // 7 days
    }
    
    // Add to queue items list
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    pipeline.lpush(itemsKey, JSON.stringify(jobItem));
    
    await pipeline.exec();

    // Update cache
    this._updateCache(queueId, null, [jobItem]);
  },

  /**
   * Mark job as ready when dependencies are satisfied
   * @private
   */
  async _markJobAsReady(queueId, jobId) {
    const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${jobId}`;
    
    await this.redis.hset(itemKey, {
      status: 'pending',
      readyAt: new Date().toISOString()
    });

    // Update cache if item is cached
    const cachedItems = this.cache.get('items', queueId);
    if (cachedItems) {
      const itemIndex = cachedItems.findIndex(item => item.id === jobId);
      if (itemIndex !== -1) {
        cachedItems[itemIndex].status = 'pending';
        cachedItems[itemIndex].readyAt = new Date().toISOString();
        this.cache.set('items', queueId, cachedItems);
      }
    }

    // Emit job ready event
    this._emitQueueEvent(queueId, 'job:ready', {
      queueId,
      jobId,
      readyAt: new Date().toISOString()
    });
  },

  /**
   * Mark a job as completed and check dependent jobs
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Completed job ID
   * @param {Object} options - Completion options
   */
  async markJobCompleted(queueId, jobId, options = {}) {
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
          'markJobCompleted'
        );
      }

      const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${jobId}`;
      
      // Update job status
      await this.redis.hset(itemKey, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: JSON.stringify(options.result || {})
      });

      // Find jobs that depend on this job
      const dependentJobs = await this._findDependentJobs(queueId, jobId);
      
      // Update dependent jobs
      const readyJobs = [];
      for (const dependentJobId of dependentJobs) {
        const isReady = await this._updateDependentJob(queueId, dependentJobId, jobId);
        if (isReady) {
          readyJobs.push(dependentJobId);
        }
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { jobId, readyJobs },
          'markJobCompleted'
        );
      }

      // Emit completion event
      this._emitQueueEvent(queueId, 'job:completed', {
        queueId,
        jobId,
        readyJobs,
        completedAt: new Date().toISOString()
      });

      return {
        completed: jobId,
        readyJobs
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'markJobCompleted', { queueId, jobId });
    }
  },

  /**
   * Find jobs that depend on a specific job
   * @private
   */
  async _findDependentJobs(queueId, jobId) {
    const pattern = `${this.QUEUE_PREFIX}dependencies:${queueId}:*`;
    const keys = await this.redis.keys(pattern);
    
    const dependentJobs = [];
    
    for (const key of keys) {
      const isDependency = await this.redis.sismember(key, jobId);
      if (isDependency) {
        const dependentJobId = key.split(':').pop();
        dependentJobs.push(dependentJobId);
      }
    }
    
    return dependentJobs;
  },

  /**
   * Update a dependent job when a dependency is satisfied
   * @private
   */
  async _updateDependentJob(queueId, dependentJobId, completedJobId) {
    const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${dependentJobId}`;
    
    // Get current job data
    const jobData = await this.redis.hgetall(itemKey);
    if (Object.keys(jobData).length === 0) {
      return false;
    }

    const dependencies = JSON.parse(jobData.dependencies || '[]');
    const dependencyStatus = JSON.parse(jobData.dependencyStatus || '{}');

    // Update dependency status
    if (dependencyStatus[completedJobId]) {
      dependencyStatus[completedJobId] = {
        satisfied: true,
        completedAt: new Date().toISOString(),
        failed: false
      };
    }

    // Check if all dependencies are satisfied
    const allSatisfied = dependencies.every(depId => 
      dependencyStatus[depId] && dependencyStatus[depId].satisfied
    );

    if (allSatisfied) {
      // Mark job as ready
      await this.redis.hset(itemKey, {
        status: 'pending',
        dependencyStatus: JSON.stringify(dependencyStatus),
        readyAt: new Date().toISOString()
      });

      // Update cache
      const cachedItems = this.cache.get('items', queueId);
      if (cachedItems) {
        const itemIndex = cachedItems.findIndex(item => item.id === dependentJobId);
        if (itemIndex !== -1) {
          cachedItems[itemIndex].status = 'pending';
          cachedItems[itemIndex].dependencyStatus = dependencyStatus;
          cachedItems[itemIndex].readyAt = new Date().toISOString();
          this.cache.set('items', queueId, cachedItems);
        }
      }

      return true;
    } else {
      // Update dependency status but job still waiting
      await this.redis.hset(itemKey, {
        dependencyStatus: JSON.stringify(dependencyStatus)
      });

      return false;
    }
  },

  /**
   * Mark a job as failed and handle dependent jobs
   * @param {string} queueId - Queue ID
   * @param {string} jobId - Failed job ID
   * @param {Object} error - Error information
   * @param {Object} options - Failure options
   */
  async markJobFailed(queueId, jobId, error, options = {}) {
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
          { queueId, jobId, error },
          'markJobFailed'
        );
      }

      const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${jobId}`;
      
      // Update job status
      await this.redis.hset(itemKey, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: error.message || 'Unknown error',
        errorType: error.constructor.name
      });

      // Handle dependent jobs based on failure policy
      const failurePolicy = options.failurePolicy || 'fail_dependents';
      const affectedJobs = [];

      if (failurePolicy === 'fail_dependents') {
        const dependentJobs = await this._findDependentJobs(queueId, jobId);
        
        for (const dependentJobId of dependentJobs) {
          await this._failDependentJob(queueId, dependentJobId, jobId, error);
          affectedJobs.push(dependentJobId);
        }
      }

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { jobId, affectedJobs, error },
          'markJobFailed'
        );
      }

      // Emit failure event
      this._emitQueueEvent(queueId, 'job:failed', {
        queueId,
        jobId,
        error: error.message,
        affectedJobs,
        failedAt: new Date().toISOString()
      });

      return {
        failed: jobId,
        affectedJobs
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'markJobFailed', { queueId, jobId, error });
    }
  },

  /**
   * Fail a dependent job when its dependency fails
   * @private
   */
  async _failDependentJob(queueId, dependentJobId, failedDependencyId, error) {
    const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${dependentJobId}`;
    
    await this.redis.hset(itemKey, {
      status: 'failed',
      failedAt: new Date().toISOString(),
      failureReason: 'dependency_failed',
      failedDependency: failedDependencyId,
      error: error.message || 'Dependency failed'
    });

    // Update cache
    const cachedItems = this.cache.get('items', queueId);
    if (cachedItems) {
      const itemIndex = cachedItems.findIndex(item => item.id === dependentJobId);
      if (itemIndex !== -1) {
        cachedItems[itemIndex].status = 'failed';
        cachedItems[itemIndex].failedAt = new Date().toISOString();
        cachedItems[itemIndex].failureReason = 'dependency_failed';
        this.cache.set('items', queueId, cachedItems);
      }
    }
  },

  /**
   * Get job dependency graph
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getDependencyGraph(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      includeCompleted = false,
      includeFailed = false,
      maxDepth = 10
    } = options;

    try {
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Filter items based on options
      let filteredItems = items;
      if (!includeCompleted) {
        filteredItems = filteredItems.filter(item => item.status !== 'completed');
      }
      if (!includeFailed) {
        filteredItems = filteredItems.filter(item => item.status !== 'failed');
      }

      // Build dependency graph
      const graph = {
        nodes: [],
        edges: [],
        stats: {
          total: filteredItems.length,
          pending: 0,
          waiting: 0,
          completed: 0,
          failed: 0
        }
      };

      // Add nodes
      filteredItems.forEach(item => {
        graph.nodes.push({
          id: item.id,
          status: item.status,
          priority: item.priority || 0,
          addedAt: item.addedAt,
          dependencies: item.dependencies || [],
          dependencyStatus: item.dependencyStatus || {}
        });

        // Update stats
        graph.stats[item.status] = (graph.stats[item.status] || 0) + 1;
      });

      // Add edges (dependencies)
      filteredItems.forEach(item => {
        if (item.dependencies && item.dependencies.length > 0) {
          item.dependencies.forEach(depId => {
            graph.edges.push({
              from: depId,
              to: item.id,
              type: 'dependency'
            });
          });
        }
      });

      return graph;

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getDependencyGraph', { queueId, options });
    }
  },

  /**
   * Get jobs ready for execution (no pending dependencies)
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getReadyJobs(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      limit = 100,
      priority = null
    } = options;

    try {
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Filter ready jobs
      let readyJobs = items.filter(item => 
        item.status === 'pending' && 
        (!item.dependencies || item.dependencies.length === 0)
      );

      // Filter by priority if specified
      if (priority !== null) {
        readyJobs = readyJobs.filter(item => (item.priority || 0) === priority);
      }

      // Sort by priority (highest first)
      readyJobs.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      // Apply limit
      readyJobs = readyJobs.slice(0, limit);

      return {
        jobs: readyJobs,
        count: readyJobs.length,
        total: items.length
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getReadyJobs', { queueId, options });
    }
  },

  /**
   * Clean up completed job dependencies
   * @param {string} queueId - Queue ID
   * @param {Object} options - Cleanup options
   */
  async cleanupDependencies(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      olderThanDays = 7,
      onlyCompleted = true
    } = options;

    try {
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      let itemsToCleanup = items.filter(item => {
        const itemTime = new Date(item.addedAt).getTime();
        return itemTime < cutoffTime;
      });

      if (onlyCompleted) {
        itemsToCleanup = itemsToCleanup.filter(item => item.status === 'completed');
      }

      const cleanedCount = 0;
      
      for (const item of itemsToCleanup) {
        try {
          // Remove dependency tracking
          const dependencyKey = `${this.QUEUE_PREFIX}dependencies:${queueId}:${item.id}`;
          await this.redis.del(dependencyKey);
          
          // Remove item data
          const itemKey = `${this.QUEUE_PREFIX}item:${queueId}:${item.id}`;
          await this.redis.del(itemKey);
          
          cleanedCount++;
        } catch (error) {
          console.error(`QueueManager: Error cleaning up dependencies for ${item.id}:`, error.message);
        }
      }

      // Emit cleanup event
      this._emitQueueEvent(queueId, 'dependencies:cleaned', {
        queueId,
        cleanedCount,
        olderThanDays
      });

      return { cleaned: cleanedCount };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cleanupDependencies', { queueId, options });
    }
  }
};

module.exports = DependencyOperations;

