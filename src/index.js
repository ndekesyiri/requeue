const Redis = require('ioredis');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class QueueManager {
  constructor(config = {}) {
    // Extract the cache and Redis configs
    const { cache: cacheConfig = {}, redis: redisConfig = {}, ...otherConfig } = config;

    // Default Redis configs
    const defaultRedisConfig = {
      host: 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      ...redisConfig,
      ...otherConfig
    };

    // Default cache configss
    const defaultCacheConfig = {
      enabled: true,
      strategy: 'write-through', // 'write-through' | 'write-back' | 'read-through'
      maxSize: 1000, // Maximum number of cached items
      ttl: 1000 * 60 * 30, // 30 minutes TTL
      syncInterval: 5000, // Write-back sync interval (5 seconds)
      ...cacheConfig
    };

    this.redis = new Redis(defaultRedisConfig);
    this.eventEmitter = new EventEmitter();
    this.listeners = new Map(); // Store queue-specific event emitters
    this.cacheConfig = defaultCacheConfig;

    // Initialize cache layers now
    this._initializeCaches();

    // Redis key prefixes
    this.QUEUE_PREFIX = 'qm:queue:';
    this.QUEUE_ITEMS_PREFIX = 'qm:items:';
    this.QUEUE_META_PREFIX = 'qm:meta:';

    // Cache sync tracking for write-back strategy
    this.pendingWrites = new Set();
    this.syncTimer = null;

    // Initialize Redis connection, attempt to connect to redis
    this._initializeRedis();

    // Start background sync if write-back is enabled
    if (this.cacheConfig.enabled && this.cacheConfig.strategy === 'write-back') {
      this._startBackgroundSync();
    }
  }

  /**
   * Initialize cache layers
   * @private
   */
  _initializeCaches() {
    if (!this.cacheConfig.enabled) return;

    const LRU = require('lru-cache');
    // Detect lru-cache version and then init cache
    const isModernLRU = LRU && LRU.version && parseInt(LRU.version.split('.')[0]) >= 7;

    // Verify version compatibility - this should be done befor initializing caches to handle different LRU versions
    if (isModernLRU) {
      // Modern API
      const lruOptions = {
        max: this.cacheConfig.maxSize,
        ttl: this.cacheConfig.ttl,
        updateAgeOnGet: true,
        updateAgeOnHas: true,
        allowStale: false
      }
      // Cache for queue metadata
      this.queueCache = new LRU(lruOptions);

      // Cache for queue items (nested structure: queueId -> items array)
      this.itemsCache = new LRU(lruOptions);
    } else {
      // Legacy API
      const lruOptions = {
        max: this.cacheConfig.maxSize,
        maxAge: this.cacheConfig.ttl, // Legacy API uses maxAge instead of ttl
        updateAgeOnGet: true,
        updateAgeOnHas: true
      };
      this.queueCache = new LRU(lruOptions);
      this.itemsCache = new LRU(lruOptions);
    }

    // Track which queues have been loaded into cache
    this.loadedQueues = new Set();

    // Cache statistics
    this.cacheStats = {
      hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0,
      syncs: 0
    };

    // Listen for cache evictions to maintain consistency
    this.queueCache.on('evict', (key, value) => {
      this.cacheStats.evictions++;
      this.loadedQueues.delete(key);
      if (this.cacheConfig.strategy === 'write-back' && this.pendingWrites.has(`queue:${key}`)) {
        this._syncQueueToRedis(key, value);
      }
    });

    this.itemsCache.on('evict', (key, value) => {
      this.cacheStats.evictions++;
      if (this.cacheConfig.strategy === 'write-back' && this.pendingWrites.has(`items:${key}`)) {
        this._syncItemsToRedis(key, value);
      }
    });
  }

  /**
   * Initialize Redis connection with error handling
   */
  async _initializeRedis() {
    try {
      await this.redis.connect();
      console.log('QueueManager: Redis connection established');
    } catch (error) {
      console.error('QueueManager: Failed to connect to Redis:', error.message);
      throw new Error(`Redis connection failed: ${error.message}`);
    }

    // Handle Redis connection events
    this.redis.on('error', (error) => {
      console.error('QueueManager: Redis error:', error.message);
    });

    this.redis.on('reconnecting', () => {
      console.log('QueueManager: Reconnecting to Redis...');
    });
  }

  /**
   * Start background sync for write-back strategy
   * @private
   */
  _startBackgroundSync() {
    this.syncTimer = setInterval(async () => {
      if (this.pendingWrites.size > 0) {
        await this._syncPendingWrites();
      }
    }, this.cacheConfig.syncInterval);
  }

  /**
   * Sync pending writes to Redis
   * @private
   */
  async _syncPendingWrites() {
    const writes = Array.from(this.pendingWrites);
    const syncPromises = [];

    for (const writeKey of writes) {
      const [type, queueId] = writeKey.split(':');

      if (type === 'queue' && this.queueCache.has(queueId)) {
        const queueData = this.queueCache.get(queueId);
        syncPromises.push(this._syncQueueToRedis(queueId, queueData));
      } else if (type === 'items' && this.itemsCache.has(queueId)) {
        const items = this.itemsCache.get(queueId);
        syncPromises.push(this._syncItemsToRedis(queueId, items));
      }

      this.pendingWrites.delete(writeKey);
    }

    if (syncPromises.length > 0) {
      try {
        await Promise.all(syncPromises);
        this.cacheStats.syncs += syncPromises.length;
      } catch (error) {
        console.error('QueueManager: Background sync failed:', error.message);
      }
    }
  }

  /**
   * Sync queue metadata to Redis
   * @private
   */
  async _syncQueueToRedis(queueId, queueData) {
    const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
    await this.redis.hset(queueKey, queueData);
  }

  /**
   * Sync queue items to Redis
   * @private
   */
  async _syncItemsToRedis(queueId, items) {
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;

    if (items && items.length > 0) {
      const serializedItems = items.map(item => JSON.stringify(item));
      await this.redis.del(itemsKey);
      await this.redis.lpush(itemsKey, ...serializedItems);
    } else {
      await this.redis.del(itemsKey);
    }
  }

  /**
   * Get queue from cache or Redis
   * @private
   */
  async _getQueueFromCacheOrRedis(queueId) {
    if (!this.cacheConfig.enabled) {
      return this._getQueueFromRedis(queueId);
    }

    // Try cache first
    if (this.queueCache.has(queueId)) {
      this.cacheStats.hits++;
      const cachedQueue = this.queueCache.get(queueId);

      // Update item count from cache if items are also cached
      if (this.itemsCache.has(queueId)) {
        const cachedItems = this.itemsCache.get(queueId) || [];
        cachedQueue.itemCount = cachedItems.length;
      }

      return cachedQueue;
    }

    // Cache miss - load from Redis
    this.cacheStats.misses++;
    const queueData = await this._getQueueFromRedis(queueId);

    // Cache the result
    this.queueCache.set(queueId, queueData);
    this.loadedQueues.add(queueId);

    return queueData;
  }

  /**
   * Get queue directly from Redis
   * @private
   */
  async _getQueueFromRedis(queueId) {
    const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
    const queueData = await this.redis.hgetall(queueKey);

    if (Object.keys(queueData).length === 0) {
      throw new Error(`Queue with ID ${queueId} not found`);
    }

    // Get current item count from Redis
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    const itemCount = await this.redis.llen(itemsKey);
    queueData.itemCount = itemCount;

    return queueData;
  }

  /**
   * Get queue items from cache or Redis
   * @private
   */
  async _getQueueItemsFromCacheOrRedis(queueId, start = 0, end = -1) {
    if (!this.cacheConfig.enabled) {
      return this._getQueueItemsFromRedis(queueId, start, end);
    }

    // Check if items are in cache
    if (this.itemsCache.has(queueId)) {
      this.cacheStats.hits++;
      const cachedItems = this.itemsCache.get(queueId) || [];

      // Handle range selection
      if (start === 0 && end === -1) {
        return cachedItems;
      } else {
        const endIndex = end === -1 ? cachedItems.length : end + 1;
        return cachedItems.slice(start, endIndex);
      }
    }

    // Cache miss - load from Redis
    this.cacheStats.misses++;
    const items = await this._getQueueItemsFromRedis(queueId, 0, -1); // Load all items for cache

    // Cache all items
    this.itemsCache.set(queueId, items);

    // Return requested range
    if (start === 0 && end === -1) {
      return items;
    } else {
      const endIndex = end === -1 ? items.length : end + 1;
      return items.slice(start, endIndex);
    }
  }

  /**
   * Get queue items directly from Redis
   * @private
   */
  async _getQueueItemsFromRedis(queueId, start = 0, end = -1) {
    const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
    const items = await this.redis.lrange(itemsKey, start, end);
    return items.map(item => JSON.parse(item));
  }

  /**
   * Update cache after write operations
   * @private
   */
  _updateCache(queueId, queueData = null, items = null) {
    if (!this.cacheConfig.enabled) return;

    this.cacheStats.writes++;

    if (queueData) {
      this.queueCache.set(queueId, queueData);

      if (this.cacheConfig.strategy === 'write-back') {
        this.pendingWrites.add(`queue:${queueId}`);
      }
    }

    if (items !== null) {
      this.itemsCache.set(queueId, items);

      if (this.cacheConfig.strategy === 'write-back') {
        this.pendingWrites.add(`items:${queueId}`);
      }
    }
  }

  /**
   * Remove from cache
   * @private
   */
  _removeFromCache(queueId) {
    if (!this.cacheConfig.enabled) return;

    this.queueCache.delete(queueId);
    this.itemsCache.delete(queueId);
    this.loadedQueues.delete(queueId);
    this.pendingWrites.delete(`queue:${queueId}`);
    this.pendingWrites.delete(`items:${queueId}`);
  }

  /**
   * Create a new queue
   * @param {string} name - Queue name
   * @param {string} queueId - Unique queue identifier
   * @param {Object} config - Queue configuration
   */
  async createQueue(name, queueId, config = {}) {
    try {
      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      const timestamp = new Date().toISOString();

      const queueMetadata = {
        id: queueId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        itemCount: 0,
        ...config
      };

      // Check if queue already exists (check cache first, then Redis)
      let exists = false;
      if (this.cacheConfig.enabled && this.queueCache.has(queueId)) {
        exists = true;
      } else {
        exists = await this.redis.exists(queueKey);
      }

      if (exists) {
        throw new Error(`Queue with ID ${queueId} already exists`);
      }

      // Write to Redis immediately for all strategies
      await this.redis.hset(queueKey, queueMetadata);

      // Initialize empty queue list in Redis
      const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
      await this.redis.del(itemsKey);

      // Update cache
      this._updateCache(queueId, queueMetadata, []);

      // Emit creation event
      this._emitQueueEvent(queueId, 'queue:created', {
        queueId,
        name,
        config: queueMetadata
      });

      return queueMetadata;
    } catch (error) {
      console.error(`QueueManager: Error creating queue ${queueId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get queue details
   * @param {string} queueId - Queue identifier
   */
  async getQueue(queueId) {
    try {
      return await this._getQueueFromCacheOrRedis(queueId);
    } catch (error) {
      console.error(`QueueManager: Error getting queue ${queueId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update queue configuration
   * @param {string} queueId - Queue identifier
   * @param {Object} updates - Configuration updates
   */
  async updateQueue(queueId, updates) {
    try {
      // Verify queue exists
      const existingQueue = await this._getQueueFromCacheOrRedis(queueId);

      // Add timestamp
      updates.updatedAt = new Date().toISOString();

      const updatedQueue = { ...existingQueue, ...updates };

      // Update based on strategy
      if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
        // Write to Redis immediately
        const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
        await this.redis.hset(queueKey, updates);
      }

      // Update cache
      this._updateCache(queueId, updatedQueue);

      // Emit update event
      this._emitQueueEvent(queueId, 'queue:updated', {
        queueId,
        updates,
        queue: updatedQueue
      });

      return updatedQueue;
    } catch (error) {
      console.error(`QueueManager: Error updating queue ${queueId}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete a queue and all its items
   * @param {string} queueId - Queue identifier
   */
  async deleteQueue(queueId) {
    try {
      // Verify queue exists
      const queueData = await this._getQueueFromCacheOrRedis(queueId);

      // Delete from Redis
      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;

      const pipeline = this.redis.pipeline();
      pipeline.del(queueKey);
      pipeline.del(itemsKey);
      await pipeline.exec();

      // Remove from cache
      this._removeFromCache(queueId);

      // Clean up listeners
      if (this.listeners.has(queueId)) {
        this.listeners.get(queueId).removeAllListeners();
        this.listeners.delete(queueId);
      }

      // Emit deletion event
      this._emitQueueEvent(queueId, 'queue:deleted', {
        queueId,
        deletedQueue: queueData
      });

      return { success: true, deletedQueue: queueData };
    } catch (error) {
      console.error(`QueueManager: Error deleting queue ${queueId}:`, error.message);
      throw error;
    }
  }

  /**
   * Add item to queue with before/after hooks
   * @param {string} queueId - Queue identifier
   * @param {Object} item - Item to add
   * @param {Object} options - Options including hooks
   */
  async addToQueue(queueId, item, options = {}) {
    const itemId = uuidv4();
    const timestamp = new Date().toISOString();

    try {
      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const queueItem = {
        id: itemId,
        data: item,
        addedAt: timestamp,
        status: 'pending'
      };

      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(options.actions.beforeAction, 'beforeAction', queueId, queueItem);
      }

      // Get current items from cache or Redis
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);
      const updatedItems = [queueItem, ...currentItems]; // Add to front

      // Update based on strategy
      if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
        // Write to Redis immediately
        const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
        await this.redis.lpush(itemsKey, JSON.stringify(queueItem));
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Update queue item count
      await this._updateQueueItemCount(queueId, updatedItems.length);

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(options.actions.afterAction, 'afterAction', queueId, queueItem);
      }

      // Emit item added event
      this._emitQueueEvent(queueId, 'item:added', {
        queueId,
        item: queueItem
      });

      return queueItem;
    } catch (error) {
      console.error(`QueueManager: Error adding item to queue ${queueId}:`, error.message);

      // Emit error event
      this._emitQueueEvent(queueId, 'item:add:error', {
        queueId,
        item,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Get items from queue
   * @param {string} queueId - Queue identifier
   * @param {number} start - Start index (default: 0)
   * @param {number} end - End index (default: -1 for all)
   */
  async getQueueItems(queueId, start = 0, end = -1) {
    try {
      await this._getQueueFromCacheOrRedis(queueId); // Verify queue exists
      return await this._getQueueItemsFromCacheOrRedis(queueId, start, end);
    } catch (error) {
      console.error(`QueueManager: Error getting items from queue ${queueId}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete item from queue
   * @param {string} queueId - Queue identifier
   * @param {string} itemId - Item identifier
   */
  async deleteItemFromQueue(queueId, itemId) {
    try {
      await this._getQueueFromCacheOrRedis(queueId); // Verify queue exists

      // Get current items
      const currentItems = await this._getQueueItemsFromCacheOrRedis(queueId);

      // Find and remove the item
      const itemIndex = currentItems.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item with ID ${itemId} not found in queue ${queueId}`);
      }

      const deletedItem = currentItems[itemIndex];
      const updatedItems = currentItems.filter(item => item.id !== itemId);

      // Update based on strategy
      if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
        // Update Redis immediately
        await this._syncItemsToRedis(queueId, updatedItems);
      }

      // Update cache
      this._updateCache(queueId, null, updatedItems);

      // Update queue item count
      await this._updateQueueItemCount(queueId, updatedItems.length);

      // Emit item deleted event
      this._emitQueueEvent(queueId, 'item:deleted', {
        queueId,
        deletedItem
      });

      return deletedItem;
    } catch (error) {
      console.error(`QueueManager: Error deleting item ${itemId} from queue ${queueId}:`, error.message);
      throw error;
    }
  }

  /**
   * Listen for queue changes
   * @param {string} queueId - Queue identifier
   */
  listen(queueId) {
    if (!this.listeners.has(queueId)) {
      this.listeners.set(queueId, new EventEmitter());
    }
    return this.listeners.get(queueId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    if (!this.cacheConfig.enabled) {
      return { enabled: false };
    }

    return {
      enabled: true,
      strategy: this.cacheConfig.strategy,
      stats: {
        ...this.cacheStats,
        hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
        queueCacheSize: this.queueCache.size,
        itemsCacheSize: this.itemsCache.size,
        loadedQueues: this.loadedQueues.size,
        pendingWrites: this.pendingWrites.size
      },
      config: this.cacheConfig
    };
  }

  /**
   * Clear cache (useful for testing or manual cache management)
   */
  clearCache() {
    if (!this.cacheConfig.enabled) return;

    this.queueCache.clear();
    this.itemsCache.clear();
    this.loadedQueues.clear();
    this.pendingWrites.clear();

    // Reset stats
    this.cacheStats = {
      hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0,
      syncs: 0
    };
  }

  /**
   * Force sync all pending writes (useful for shutdown)
   */
  async forceSyncCache() {
    if (!this.cacheConfig.enabled || this.cacheConfig.strategy !== 'write-back') {
      return;
    }

    await this._syncPendingWrites();
  }

  /**
   * Execute hooks with error handling
   * @private
   */
  async _executeHooks(hooks, hookType, queueId, item) {
    if (!Array.isArray(hooks) || hooks.length === 0) return;

    // Limit to 3 hooks as per requirements
    const limitedHooks = hooks.slice(0, 3);

    for (let i = 0; i < limitedHooks.length; i++) {
      try {
        const hook = limitedHooks[i];
        if (typeof hook === 'function') {
          await hook(item, queueId);
        } else {
          console.warn(`QueueManager: Hook at index ${i} is not a function`);
        }
      } catch (error) {
        console.error(`QueueManager: Error executing ${hookType} hook ${i}:`, error.message);

        // Emit hook error event
        this._emitQueueEvent(queueId, `hook:${hookType}:error`, {
          queueId,
          hookIndex: i,
          item,
          error: error.message
        });

        throw new Error(`${hookType} hook failed at index ${i}: ${error.message}`);
      }
    }
  }

  /**
   * Update queue item count in metadata
   * @private
   */
  async _updateQueueItemCount(queueId, itemCount = null) {
    // Get item count if not provided
    if (itemCount === null) {
      if (this.cacheConfig.enabled && this.itemsCache.has(queueId)) {
        const cachedItems = this.itemsCache.get(queueId) || [];
        itemCount = cachedItems.length;
      } else {
        const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
        itemCount = await this.redis.llen(itemsKey);
      }
    }

    const updates = {
      itemCount,
      updatedAt: new Date().toISOString()
    };

    // Update based on strategy
    if (this.cacheConfig.strategy === 'write-through' || !this.cacheConfig.enabled) {
      const queueKey = `${this.QUEUE_META_PREFIX}${queueId}`;
      await this.redis.hset(queueKey, updates);
    }

    // Update cache if queue is cached
    if (this.cacheConfig.enabled && this.queueCache.has(queueId)) {
      const cachedQueue = this.queueCache.get(queueId);
      const updatedQueue = { ...cachedQueue, ...updates };
      this._updateCache(queueId, updatedQueue);
    }
  }

  /**
   * Emit queue-specific events
   * @private
   */
  _emitQueueEvent(queueId, eventType, data) {
    const eventData = {
      timestamp: new Date().toISOString(),
      eventType,
      queueId,
      ...data
    };

    // Emit to global event emitter
    this.eventEmitter.emit('queueChange', eventData);

    // Emit to queue-specific listener if it exists
    if (this.listeners.has(queueId)) {
      this.listeners.get(queueId).emit('change', eventData);
    }
  }

  /**
   * Get all queues
   */
  async getAllQueues() {
    try {
      if (this.cacheConfig.enabled) {
        // Get cached queues first
        const cachedQueues = [];
        for (const [queueId, queueData] of this.queueCache.entries()) {
          // Update item count from cache if available
          if (this.itemsCache.has(queueId)) {
            const cachedItems = this.itemsCache.get(queueId) || [];
            queueData.itemCount = cachedItems.length;
          }
          cachedQueues.push(queueData);
        }

        // Get remaining queues from Redis
        const pattern = `${this.QUEUE_META_PREFIX}*`;
        const keys = await this.redis.keys(pattern);

        for (const key of keys) {
          const queueId = key.replace(this.QUEUE_META_PREFIX, '');

          // Skip if already in cache
          if (this.queueCache.has(queueId)) continue;

          const queueData = await this.redis.hgetall(key);
          if (Object.keys(queueData).length > 0) {
            // Get current item count
            const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
            const itemCount = await this.redis.llen(itemsKey);
            queueData.itemCount = itemCount;

            cachedQueues.push(queueData);

            // Cache for future access
            this.queueCache.set(queueId, queueData);
          }
        }

        return cachedQueues;
      } else {
        // Non-cached version
        const pattern = `${this.QUEUE_META_PREFIX}*`;
        const keys = await this.redis.keys(pattern);

        const queues = [];
        for (const key of keys) {
          const queueData = await this.redis.hgetall(key);
          if (Object.keys(queueData).length > 0) {
            // Get current item count
            const queueId = queueData.id;
            const itemsKey = `${this.QUEUE_ITEMS_PREFIX}${queueId}`;
            const itemCount = await this.redis.llen(itemsKey);
            queueData.itemCount = itemCount;

            queues.push(queueData);
          }
        }

        return queues;
      }
    } catch (error) {
      console.error('QueueManager: Error getting all queues:', error.message);
      throw error;
    }
  }

  /**
   * Close Redis connection and cleanup
   */
  async close() {
    try {
      // Stop background sync
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }

      // Force sync any pending writes
      if (this.cacheConfig.enabled && this.cacheConfig.strategy === 'write-back') {
        await this.forceSyncCache();
      }

      // Remove all listeners
      this.listeners.forEach(listener => listener.removeAllListeners());
      this.listeners.clear();

      // Clear cache
      if (this.cacheConfig.enabled) {
        this.clearCache();
      }

      // Close Redis connection
      await this.redis.quit();
      console.log('QueueManager: Redis connection closed');
    } catch (error) {
      console.error('QueueManager: Error closing connections:', error.message);
      throw error;
    }
  }
}

/**
 * A Factory function to create QueueManager instance
 */
function createQueueManager(config) {
  return new QueueManager(config);
}

// Thats a wrap...

/**
 * Export
 */
module.exports = createQueueManager;