/**
 * Core QueueManager class using composition pattern
 */
const { v4: uuidv4 } = require('uuid');

// Core managers
const RedisManager = require('./RedisManager');
const CacheManager = require('./CacheManager');
const EventManager = require('./EventManager');

// Utilities
const ValidationUtils = require('../utils/ValidationUtils');
const PerformanceUtils = require('../utils/PerformanceUtils');
const HookExecutor = require('../utils/HookExecutor');
const { ErrorHandlers } = require('../utils/ErrorHandlers');

class QueueManager {
  constructor(config = {}) {
    // Parse configuration
    const { cache: cacheConfig = {}, redis: redisConfig = {}, events: eventConfig = {}, ...otherConfig } = config;

    // Initialize core managers
    this.events = new EventManager(eventConfig);
    this.errorHandlers = new ErrorHandlers(this.events);
    this.redis = new RedisManager(redisConfig, this.events, this.errorHandlers);
    this.cache = new CacheManager(cacheConfig, this.events, this.errorHandlers);

    // Initialize utilities
    this.performance = new PerformanceUtils();
    this.hooks = new HookExecutor(this.events);

    // Configuration
    this.config = {
      ...otherConfig,
      cache: cacheConfig,
      redis: redisConfig,
      events: eventConfig
    };

    // Key prefixes
    this.QUEUE_PREFIX = 'qm:queue:';
    this.QUEUE_ITEMS_PREFIX = 'qm:items:';
    this.QUEUE_META_PREFIX = 'qm:meta:';

    // State management
    this.isShuttingDown = false;
    this.isInitialized = false;
    this._initializationPromise = null;

    // Override cache sync processor to use Redis
    this._setupCacheSyncProcessor();

    // Mix in operation methods
    this._mixinOperations();

    // FIXED: Start initialization but don't await in constructor
    this._initializationPromise = this._initialize();
  }

  /**
   * Wait for initialization to complete
   * Call this before using any QueueManager operations
   */
  async waitForInitialization() {
    if (this.isInitialized) {
      return true;
    }

    if (this._initializationPromise) {
      await this._initializationPromise;
      return true;
    }

    throw new Error('QueueManager initialization not started');
  }

  /**
   * Create a new QueueManager instance and wait for it to be ready
   * Static factory method for proper async initialization
   */
  static async create(config = {}) {
    const instance = new QueueManager(config);
    await instance.waitForInitialization();
    return instance;
  }

  /**
   * Setup cache sync processor to use Redis operations
   * @private
   */
  _setupCacheSyncProcessor() {
    // Override the cache manager's sync batch processor
    const originalProcessor = this.cache._processSyncBatch.bind(this.cache);

    this.cache._processSyncBatch = async (batch) => {
      // Ensure Redis is ready before processing
      await this.waitForInitialization();

      const pipeline = this.redis.multi();
      let operations = 0;

      for (const [writeKey, data] of batch) {
        const [type, queueId] = writeKey.split(':');

        if (type === 'queue') {
          const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
          await pipeline.hset(queueKey, data);
          operations++;
        } else if (type === 'items') {
          const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
          if (data && data.length > 0) {
            const serializedItems = data.map(item => JSON.stringify(item));
            await pipeline.del(itemsKey);
            await pipeline.rpush(itemsKey, ...serializedItems.reverse());
            operations += 2;
          } else {
            await pipeline.del(itemsKey);
            operations++;
          }
        }

        this.cache.pendingWrites.delete(writeKey);
      }

      if (operations > 0) {
        try {
          await pipeline.exec();
          this.cache.stats.syncs += operations;
          this.cache.stats.batchOperations++;
        } catch (error) {
          console.error('QueueManager: Batch sync failed:', error.message);
          this.performance.errors++;
          throw error;
        }
      }
    };
  }

  /**
   * Mix in operation methods from separate modules
   * @private
   */
  _mixinOperations() {
    // These will be added when we create more operation modules
    // For now, these are what we have

    // Mix in operation modules
    const QueueOperations = require('../operations/QueueOperations');
    const ItemOperations = require('../operations/ItemOperations');
    const PopOperations = require('../operations/PopOperations');
    const PeekOperations = require('../operations/PeekOperations');
    const SearchOperations = require('../operations/SearchOperations');
    const MoveOperations = require('../operations/MoveOperations');

    // Apply mixins
    Object.assign(this, QueueOperations);
    Object.assign(this, ItemOperations);
    Object.assign(this, PopOperations);
    Object.assign(this, PeekOperations);
    Object.assign(this, SearchOperations);
    Object.assign(this, MoveOperations);

    // Mix in performance measurement
    this._wrapMethodsWithPerformance();
  }

  /**
   * Wrap methods with performance measurement and initialization check
   * @private
   */
  _wrapMethodsWithPerformance() {
    const methodsToWrap = [
      // Queue operations
      'createQueue', 'getQueue', 'updateQueue', 'deleteQueue', 'getAllQueues',
      // Item operations  
      'addToQueue', 'getItem', 'updateItem', 'deleteItemFromQueue',
      // Other operations
      'peekQueue', 'popFromQueue', 'moveItemBetweenQueues', 'requeueItem', 'popBatchFromQueue',
      // Search operations
      'findItem', 'filterItems'
    ];

    methodsToWrap.forEach(methodName => {
      if (typeof this[methodName] === 'function') {
        const originalMethod = this[methodName].bind(this);

        // Wrap with both initialization check and performance measurement
        this[methodName] = async (...args) => {
          // Ensure initialization before any operation
          await this.waitForInitialization();

          // Then execute with performance measurement
          return this.performance.measurePerformance(methodName, originalMethod)(...args);
        };
      }
    });
  }

  /**
   * Initialize the QueueManager
   * @private
   */
  async _initialize() {
    try {
      console.log('QueueManager: Starting initialization...');

      // FIXED: Explicitly connect to Redis and wait for it to be ready
      await this.redis.connect();
      await this.redis.waitForConnection();

      // Start performance monitoring
      this.performance.startMonitoring();

      this.isInitialized = true;

      this.events.emit('queuemanager:initialized', {
        timestamp: new Date().toISOString(),
        config: {
          cache: this.cache.config,
          redis: this.redis.getStatus()
        }
      });

      console.log('QueueManager: Initialization completed successfully');

    } catch (error) {
      this.isInitialized = false;
      console.error('QueueManager: Initialization failed:', error.message);
      throw this.errorHandlers.handleError(error, 'QueueManager:initialize');
    }
  }

  /**
   * Get queue from cache or Redis with proper error handling
   * @private
   */
  async _getQueueFromCacheOrRedis(queueId) {
    ValidationUtils.validateQueueId(queueId);

    // Try cache first
    const cachedQueue = this.cache.get('queue', queueId);
    if (cachedQueue) {
      // Update item count from cache if items are also cached
      if (this.cache.has('items', queueId)) {
        const cachedItems = this.cache.get('items', queueId) || [];
        cachedQueue.itemCount = cachedItems.length;
      }
      return cachedQueue;
    }

    // Cache miss - load from Redis
    const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
    const queueData = await this.redis.hgetall(queueKey);

    if (!queueData || Object.keys(queueData).length === 0) {
      throw this.errorHandlers.constructor.createNotFoundError('Queue', queueId);
    }

    // Get current item count from Redis
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    const itemCount = await this.redis.llen(itemsKey);
    queueData.itemCount = parseInt(itemCount) || 0;

    // Cache for future access
    this.cache.set('queue', queueId, queueData);

    return queueData;
  }

  /**
   * Get queue items from cache or Redis
   * @private
   */
  async _getQueueItemsFromCacheOrRedis(queueId, start = 0, end = -1) {
    // Check cache first
    const cachedItems = this.cache.get('items', queueId);
    if (cachedItems) {
      if (start === 0 && end === -1) {
        return [...cachedItems];
      } else {
        const endIndex = end === -1 ? cachedItems.length : end + 1;
        return cachedItems.slice(start, endIndex);
      }
    }

    // Load from Redis
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    const items = await this.redis.lrange(itemsKey, start, end === -1 ? -1 : end);

    const parsedItems = items.map(item => {
      try {
        return JSON.parse(item);
      } catch (error) {
        console.warn(`QueueManager: Failed to parse item in queue ${queueId}:`, error.message);
        return {
          id: uuidv4(),
          data: item,
          corrupted: true,
          addedAt: new Date().toISOString(),
          status: 'corrupted'
        };
      }
    });

    // Cache all items for future access
    if (start === 0 && end === -1) {
      this.cache.set('items', queueId, parsedItems);
    }

    return parsedItems;
  }


  /**
 * Pop (remove and return) the next item from cache or Redis
 * @private
 */
  async _getPopQueueItemFromCacheOrRedis(queueId) {
    // Check cache first
    const cachedItems = this.cache.get('items', queueId) || [];
    if (cachedItems && cachedItems.length > 0) {
      // Remove and return the first item from cache
      const poppedItem = cachedItems.shift();
      // Update cache with remaining items
      this.cache.set('items', queueId, cachedItems);
      return poppedItem;
    }

    // Load from Redis as a fallback - use LPOP to remove and return first item
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    const item = await this.redis.lpop(itemsKey);

    if (!item) {
      return null; // Queue is empty
    }

    try {
      return JSON.parse(item);
    } catch (error) {
      console.warn(`QueueManager: Failed to parse popped item in queue ${queueId}:`, error.message);
      return {
        id: uuidv4(),
        data: item,
        corrupted: true,
        addedAt: new Date().toISOString(),
        status: 'corrupted'
      };
    }
  }
  /**
  * Get pop queue items from cache or Redis
  * @private
  */
  async _getPopQueueItemFromCacheOrRedis(queueId) {
    let poppedItem = null; // variable to hold the popped item
    const cachedItems = this.cache.get('items', queueId) || [];
    if (cachedItems.length > 0) {
      poppedItem = cachedItems.shift();  // to remove the first item
      this._updateCache(queueId, null, cachedItems);
      this._updateQueueItemCount(queueId, cachedItems.length)
      // Handle the different memory scenarios
      if (this.cache.strategy === 'write-through' || !this.cache.enabled) {
        // Here for write through just sync to redis immediately
        await this._syncItemsToRedis(queueId, cachedItems);
      } else if (this.cache.strategy === 'write-back') {
        // For the write back strategy, add it to pending writes
        this.pendingWrites.add(`items:${queueId}`);
      }
    } else {
      // if not in cache, directly from redis
      const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
      const rawItem = await this.redis.rpop(itemsKey);
      // Now, we added items with lpush, the oldest items is at the end of the list, use prop
      if (rawItem) {
        poppedItem = JSON.parse(rawItem);
      }
    }
    return poppedItem;
  }

  /**
   * Update cache with new data
   * @private
   */
  _updateCache(queueId, queueData = null, items = null) {
    if (queueData) {
      this.cache.set('queue', queueId, queueData);
    }
    if (items !== null) {
      this.cache.set('items', queueId, items);
    }
  }

  /**
   * Remove from cache
   * @private
   */
  _removeFromCache(queueId) {
    this.cache.delete('queue', queueId);
    this.cache.delete('items', queueId);
    this.cache.delete('metadata', queueId);
  }

  /**
   * Execute hooks using the hook executor
   * @private
   */
  async _executeHooks(hooks, hookType, queueId, data, operation, context = {}) {
    return this.hooks.executeHooks(hooks, hookType, queueId, data, operation, context);
  }

  /**
   * Emit queue event using the event manager
   * @private
   */
  _emitQueueEvent(queueId, eventType, data) {
    if (this.isShuttingDown) return;

    this.events.emit(eventType, {
      queueId,
      ...data
    });
  }

  /**
   * Update queue item count in metadata
   * @private
   */
  async _updateQueueItemCount(queueId, itemCount = null) {
    // Get item count if not provided
    if (itemCount === null) {
      const cachedItems = this.cache.get('items', queueId);
      if (cachedItems) {
        itemCount = cachedItems.length;
      } else {
        const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
        itemCount = await this.redis.llen(itemsKey);
      }
    }

    const updates = {
      itemCount: itemCount.toString(),
      updatedAt: new Date().toISOString()
    };

    // Update based on cache strategy
    if (this.cache.config.strategy === 'write-through' || !this.cache.config.enabled) {
      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      await this.redis.hset(queueKey, updates);
    }

    // Update cache if queue is cached
    if (this.cache.has('queue', queueId)) {
      const cachedQueue = this.cache.get('queue', queueId);
      const updatedQueue = {
        ...cachedQueue,
        itemCount: parseInt(itemCount) || 0,
        updatedAt: updates.updatedAt
      };
      this.cache.set('queue', queueId, updatedQueue);
    }
  }

  /**
   * Sync items to Redis (for cache write operations)
   * @private
   */
  async _syncItemsToRedis(queueId, items) {
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;

    if (items && items.length > 0) {
      const pipeline = this.redis.multi();
      await pipeline.del(itemsKey);

      // Add items in correct order - reverse and use RPUSH to maintain FIFO
      const reversedItems = [...items].reverse();
      const batchSize = 1000;

      for (let i = 0; i < reversedItems.length; i += batchSize) {
        const batch = reversedItems.slice(i, i + batchSize);
        const serializedItems = batch.map(item => JSON.stringify(item));
        await pipeline.rpush(itemsKey, ...serializedItems);
      }

      await pipeline.exec();
    } else {
      await this.redis.del(itemsKey);
    }
  }

  /**
   * Listen for queue changes (returns queue-specific event emitter)
   */
  listen(queueId) {
    ValidationUtils.validateQueueId(queueId);
    return this.events.getQueueListener(queueId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return this.performance.getPerformanceStats();
  }

  /**
   * Get event statistics
   */
  getEventStats() {
    return this.events.getStats();
  }

  /**
   * Clear cache with options
   */
  clearCache(options = {}) {
    return this.cache.clear(options.cacheType);
  }

  /**
   * Force sync cache to Redis
   */
  async forceSyncCache() {
    await this.waitForInitialization();
    return this.cache.forceSync();
  }

  /**
   * Health check for the entire system
   */
  async healthCheck() {
    try {
      await this.waitForInitialization();

      const [redisHealth, cacheHealth, eventHealth] = await Promise.all([
        this.redis.healthCheck(),
        this.cache.healthCheck(),
        this.events.healthCheck()
      ]);

      const performanceStats = this.performance.getPerformanceStats();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        components: {
          redis: redisHealth,
          cache: cacheHealth,
          events: eventHealth,
          performance: {
            status: 'healthy',
            totalOperations: performanceStats.totalOperations,
            totalErrors: performanceStats.totalErrors,
            errorRate: performanceStats.errorRate
          }
        },
        overall: {
          healthy: redisHealth.status === 'healthy',
          ready: !this.isShuttingDown && this.isInitialized,
          uptime: process.uptime()
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        components: {
          redis: { status: 'unknown' },
          cache: { status: 'unknown' },
          events: { status: 'unknown' }
        }
      };
    }
  }

  /**
   * Get comprehensive system statistics
   */
  getSystemStats() {
    return {
      cache: this.getCacheStats(),
      performance: this.getPerformanceStats(),
      events: this.getEventStats(),
      redis: this.redis.getStatus(),
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        initialized: this.isInitialized
      }
    };
  }

  /**
   * Initialize the QueueManager
   * @private
   */
  async _initialize() {
    try {
      console.log('QueueManager: Starting initialization...');

      // FIXED: Explicitly connect to Redis and wait for it to be ready
      console.log('QueueManager: Connecting to Redis...');
      await this.redis.connect();
      await this.redis.waitForConnection(30000);  // 30 second timeout

      console.log('QueueManager: Redis connected, starting performance monitoring...');

      // Start performance monitoring
      this.performance.startMonitoring();

      this.isInitialized = true;

      this.events.emit('queuemanager:initialized', {
        timestamp: new Date().toISOString(),
        config: {
          cache: this.cache.config,
          redis: this.redis.getStatus()
        }
      });

      console.log('QueueManager: Initialization completed successfully');

    } catch (error) {
      this.isInitialized = false;
      console.error('QueueManager: Initialization failed:', error.message);
      throw this.errorHandlers.handleError(error, 'QueueManager:initialize');
    }
  }

  /**
   * Close the QueueManager and cleanup resources
   */
  async close(options = {}) {
    const { timeout = 30000, forceSyncCache = true } = options;

    try {
      console.log('QueueManager: Starting graceful shutdown...');
      this.isShuttingDown = true;

      // Stop performance monitoring
      this.performance.stopMonitoring();

      // Force sync cache if needed
      if (forceSyncCache && this.cache.config.enabled && this.cache.config.strategy === 'write-back') {
        console.log('QueueManager: Syncing cache...');

        try {
          await Promise.race([
            this.cache.forceSync(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Cache sync timeout')), timeout / 2)
            )
          ]);
        } catch (error) {
          console.warn('QueueManager: Cache sync failed:', error.message);
        }
      }

      // Close components in order
      console.log('QueueManager: Cleaning up components...');

      // Destroy cache manager
      await this.cache.destroy();

      // Close Redis connection
      await this.redis.disconnect(timeout / 2);

      // Destroy event manager
      this.events.destroy();

      // Cleanup hook executor
      this.hooks.destroy();

      this.isInitialized = false;
      console.log('QueueManager: Shutdown completed successfully');

    } catch (error) {
      console.error('QueueManager: Error during shutdown:', error.message);
      throw this.errorHandlers.handleError(error, 'QueueManager:close');
    }
  }
}

module.exports = QueueManager;