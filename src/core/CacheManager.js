/**
 * Cache management with multiple strategies and LRU cache
 */
const { ErrorHandlers, CacheError } = require('../utils/ErrorHandlers');

class CacheManager {
  constructor(config = {}, eventManager = null, errorHandlers = null) {
    this.eventManager = eventManager;
    this.errorHandlers = errorHandlers || new ErrorHandlers(eventManager);
    
    // Default cache configuration
    this.config = {
      enabled: true,
      strategy: 'write-through', // 'write-through' | 'write-back' | 'read-through'
      maxSize: 1000,
      ttl: 1000 * 60 * 30, // 30 minutes
      syncInterval: 5000, // Write-back sync interval
      batchSize: 200,
      ...config
    };

    // Cache instances
    this.queueCache = null;
    this.itemsCache = null;
    this.metadataCache = null;

    // Tracking sets
    this.loadedQueues = new Set();
    this.dirtyQueues = new Set();
    this.pendingWrites = new Map(); // Changed from Set to Map for better data tracking

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0,
      syncs: 0,
      lastSync: null,
      batchOperations: 0
    };

    // Sync control
    this.syncInProgress = false;
    this.syncTimer = null;

    if (this.config.enabled) {
      this._initializeCaches();
      
      if (this.config.strategy === 'write-back') {
        this._startBackgroundSync();
      }
    }
  }

  /**
   * Initialize LRU caches
   * @private
   */
  _initializeCaches() {
    try {
      const { LRUCache } = require('lru-cache');
      
      // Detect LRU cache version
      const isModernLRU = LRUCache && LRUCache.version && 
        parseInt(LRUCache.version.split('.')[0]) >= 7;

      if (isModernLRU) {
        this._initializeModernLRU();
      } else {
        this._initializeLegacyLRU();
      }
    } catch (error) {
      throw this.errorHandlers.handleError(
        new CacheError(`Failed to initialize caches: ${error.message}`, this.config.strategy, 'initialize'),
        'CacheManager:initialize'
      );
    }
  }

  /**
   * Initialize modern LRU cache (v7+)
   * @private
   */
  _initializeModernLRU() {
    const { LRUCache } = require('lru-cache');
    
    const cacheOptions = {
      max: this.config.maxSize,
      ttl: this.config.ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
      allowStale: false
    };

    this.queueCache = new LRUCache({
      ...cacheOptions,
      disposeAfter: (value, key, reason) => {
        this.stats.evictions++;
        this.loadedQueues.delete(key);
        this._handleCacheEviction('queue', key, value, reason);
      }
    });

    this.itemsCache = new LRUCache({
      ...cacheOptions,
      disposeAfter: (value, key, reason) => {
        this.stats.evictions++;
        this._handleCacheEviction('items', key, value, reason);
      }
    });

    this.metadataCache = new LRUCache({
      ...cacheOptions,
      max: Math.min(this.config.maxSize, 500) // Smaller cache for metadata
    });
  }

  /**
   * Initialize legacy LRU cache
   * @private
   */
  _initializeLegacyLRU() {
    const { LRUCache } = require('lru-cache');
    
    const cacheOptions = {
      max: this.config.maxSize,
      maxAge: this.config.ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: true
    };

    this.queueCache = new LRUCache({
      ...cacheOptions,
      dispose: (value, key) => {
        this.stats.evictions++;
        this.loadedQueues.delete(key);
        this._handleCacheEviction('queue', key, value, 'dispose');
      }
    });

    this.itemsCache = new LRUCache({
      ...cacheOptions,
      dispose: (value, key) => {
        this.stats.evictions++;
        this._handleCacheEviction('items', key, value, 'dispose');
      }
    });

    this.metadataCache = new LRUCache({
      ...cacheOptions,
      max: Math.min(this.config.maxSize, 500)
    });
  }

  /**
   * Handle cache eviction based on strategy
   * @private
   */
  _handleCacheEviction(cacheType, key, value, reason) {
    if (this.config.strategy === 'write-back' && this.pendingWrites.has(`${cacheType}:${key}`)) {
      // Schedule immediate sync for evicted dirty data
      this._scheduleSync(`${cacheType}:${key}`, value, true);
    }

    if (this.eventManager) {
      this.eventManager.emit('cache:eviction', {
        cacheType,
        key,
        reason,
        strategy: this.config.strategy,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get item from cache
   */
  get(cacheType, key) {
    if (!this.config.enabled) return null;
    
    const cache = this._getCache(cacheType);
    if (!cache) return null;

    const value = cache.get(key);
    
    if (value !== undefined) {
      this.stats.hits++;
      return this._deepCopy(value);
    } else {
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set item in cache
   */
  set(cacheType, key, value, options = {}) {
    if (!this.config.enabled) return;
    
    const cache = this._getCache(cacheType);
    if (!cache) return;

    try {
      const valueToStore = this._deepCopy(value);
      cache.set(key, valueToStore, options.ttl);
      this.stats.writes++;

      // Handle different cache strategies
      if (this.config.strategy === 'write-back') {
        this._scheduleSync(`${cacheType}:${key}`, valueToStore);
        this.dirtyQueues.add(key);
      }

      // Track loaded queues
      if (cacheType === 'queue') {
        this.loadedQueues.add(key);
      }

      if (this.eventManager) {
        this.eventManager.emit('cache:set', {
          cacheType,
          key,
          strategy: this.config.strategy,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      throw this.errorHandlers.handleError(
        new CacheError(`Failed to set cache item: ${error.message}`, this.config.strategy, 'set'),
        'CacheManager:set'
      );
    }
  }

  /**
   * Check if item exists in cache
   */
  has(cacheType, key) {
    if (!this.config.enabled) return false;
    
    const cache = this._getCache(cacheType);
    return cache ? cache.has(key) : false;
  }

  /**
   * Delete item from cache
   */
  delete(cacheType, key) {
    if (!this.config.enabled) return;
    
    const cache = this._getCache(cacheType);
    if (!cache) return;

    cache.delete(key);
    
    // Clean up tracking
    if (cacheType === 'queue') {
      this.loadedQueues.delete(key);
    }
    this.dirtyQueues.delete(key);
    this.pendingWrites.delete(`${cacheType}:${key}`);

    if (this.eventManager) {
      this.eventManager.emit('cache:delete', {
        cacheType,
        key,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Clear specific cache or all caches
   */
  clear(cacheType = null) {
    if (!this.config.enabled) return;

    if (cacheType) {
      const cache = this._getCache(cacheType);
      if (cache) {
        cache.clear();
      }
    } else {
      // Clear all caches
      if (this.queueCache) this.queueCache.clear();
      if (this.itemsCache) this.itemsCache.clear();
      if (this.metadataCache) this.metadataCache.clear();
    }

    // Clear tracking data
    this.loadedQueues.clear();
    this.dirtyQueues.clear();
    this.pendingWrites.clear();

    // Reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0,
      syncs: 0,
      lastSync: null,
      batchOperations: 0
    };
  }

  /**
   * Update cache with new data
   */
  update(cacheType, key, updates) {
    if (!this.config.enabled) return;

    const existing = this.get(cacheType, key);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.set(cacheType, key, updated);
      return updated;
    }
    return null;
  }

  /**
   * Get multiple cache items
   */
  getMultiple(cacheType, keys) {
    if (!this.config.enabled) return {};

    const results = {};
    keys.forEach(key => {
      const value = this.get(cacheType, key);
      if (value !== null) {
        results[key] = value;
      }
    });
    return results;
  }

  /**
   * Set multiple cache items
   */
  setMultiple(cacheType, items) {
    if (!this.config.enabled) return;

    Object.entries(items).forEach(([key, value]) => {
      this.set(cacheType, key, value);
    });
  }

  /**
   * Schedule sync operation for write-back strategy
   * @private
   */
  _scheduleSync(writeKey, data, immediate = false) {
    if (this.config.strategy !== 'write-back') return;

    this.pendingWrites.set(writeKey, data);

    if (immediate && !this.syncInProgress) {
      // Schedule immediate sync for critical data
      setImmediate(() => this._syncPendingWrites());
    }
  }

  /**
   * Start background sync for write-back strategy
   * @private
   */
  _startBackgroundSync() {
    if (this.syncTimer) return;

    this.syncTimer = setInterval(async () => {
      if (!this.syncInProgress && this.pendingWrites.size > 0) {
        try {
          await this._syncPendingWrites();
        } catch (error) {
          console.error('CacheManager: Background sync error:', error.message);
        }
      }
    }, this.config.syncInterval);
  }

  /**
   * Sync pending writes to persistent storage
   * @private
   */
  async _syncPendingWrites() {
    if (this.syncInProgress || this.pendingWrites.size === 0) return;

    this.syncInProgress = true;
    
    try {
      const writes = Array.from(this.pendingWrites.entries());
      const batches = this._createSyncBatches(writes);

      for (const batch of batches) {
        await this._processSyncBatch(batch);
      }

      this.stats.lastSync = new Date();
      this.stats.syncs += writes.length;

      if (this.eventManager) {
        this.eventManager.emit('cache:sync:completed', {
          itemssynced: writes.length,
          strategy: this.config.strategy,
          timestamp: new Date().toISOString()
        });
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Create sync batches for efficient processing
   * @private
   */
  _createSyncBatches(writes) {
    const batches = [];
    const batchSize = this.config.batchSize;

    for (let i = 0; i < writes.length; i += batchSize) {
      batches.push(writes.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Process a single sync batch
   * @private
   */
  async _processSyncBatch(batch) {
    // This method should be overridden by the main QueueManager
    // to handle actual persistence operations
    console.warn('CacheManager: _processSyncBatch should be overridden');
  }

  /**
   * Force sync all pending writes
   */
  async forceSync() {
    if (this.config.strategy !== 'write-back') {
      return { synced: 0, message: 'Not using write-back strategy' };
    }

    if (this.syncInProgress) {
      return { synced: 0, message: 'Sync already in progress' };
    }

    const pendingCount = this.pendingWrites.size;
    await this._syncPendingWrites();

    return {
      synced: pendingCount,
      message: `Synced ${pendingCount} pending writes`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get appropriate cache instance
   * @private
   */
  _getCache(cacheType) {
    switch (cacheType) {
      case 'queue':
        return this.queueCache;
      case 'items':
        return this.itemsCache;
      case 'metadata':
        return this.metadataCache;
      default:
        console.warn(`CacheManager: Unknown cache type: ${cacheType}`);
        return null;
    }
  }

  /**
   * Deep copy utility to prevent mutations
   * @private
   */
  _deepCopy(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      console.warn('CacheManager: Failed to deep copy object, returning reference');
      return obj;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    if (!this.config.enabled) {
      return { enabled: false };
    }

    const totalOps = this.stats.hits + this.stats.misses;
    const hitRate = totalOps > 0 ? this.stats.hits / totalOps : 0;

    return {
      enabled: true,
      strategy: this.config.strategy,
      stats: {
        ...this.stats,
        hitRate: Math.round(hitRate * 10000) / 100, // Percentage with 2 decimal places
        queueCacheSize: this.queueCache?.size || 0,
        itemsCacheSize: this.itemsCache?.size || 0,
        metadataCacheSize: this.metadataCache?.size || 0,
        loadedQueues: this.loadedQueues.size,
        dirtyQueues: this.dirtyQueues.size,
        pendingWrites: this.pendingWrites.size
      },
      config: this.config,
      syncStatus: {
        syncInProgress: this.syncInProgress,
        pendingWritesCount: this.pendingWrites.size,
        lastSync: this.stats.lastSync
      }
    };
  }

  /**
   * Get cache sizes
   */
  getSizes() {
    return {
      queue: this.queueCache?.size || 0,
      items: this.itemsCache?.size || 0,
      metadata: this.metadataCache?.size || 0,
      total: (this.queueCache?.size || 0) + (this.itemsCache?.size || 0) + (this.metadataCache?.size || 0)
    };
  }

  /**
   * Get memory usage estimation
   */
  getMemoryUsage() {
    const sizes = this.getSizes();
    const avgItemSize = 1024; // Rough estimation in bytes
    
    return {
      estimated: sizes.total * avgItemSize,
      breakdown: {
        queue: (this.queueCache?.size || 0) * avgItemSize,
        items: (this.itemsCache?.size || 0) * avgItemSize,
        metadata: (this.metadataCache?.size || 0) * avgItemSize
      }
    };
  }

  /**
   * Health check for cache system
   */
  healthCheck() {
    const stats = this.getStats();
    const sizes = this.getSizes();
    
    return {
      status: this.config.enabled ? 'enabled' : 'disabled',
      strategy: this.config.strategy,
      healthy: this.config.enabled ? sizes.total < this.config.maxSize * 0.95 : true,
      stats: stats.stats,
      sizes,
      syncStatus: stats.syncStatus,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Configure cache behavior
   */
  configure(newConfig) {
    const oldStrategy = this.config.strategy;
    this.config = { ...this.config, ...newConfig };

    // Handle strategy changes
    if (oldStrategy !== this.config.strategy) {
      this._handleStrategyChange(oldStrategy, this.config.strategy);
    }

    if (this.eventManager) {
      this.eventManager.emit('cache:configured', {
        oldConfig: { strategy: oldStrategy },
        newConfig: this.config,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle cache strategy changes
   * @private
   */
  _handleStrategyChange(oldStrategy, newStrategy) {
    // Stop old background processes
    if (oldStrategy === 'write-back' && this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Start new background processes
    if (newStrategy === 'write-back') {
      this._startBackgroundSync();
    } else if (newStrategy === 'write-through' && this.pendingWrites.size > 0) {
      // Force sync any pending writes when switching away from write-back
      this.forceSync().catch(error => {
        console.error('CacheManager: Error during strategy change sync:', error.message);
      });
    }
  }

  /**
   * Cleanup and destroy cache manager
   */
  async destroy() {
    // Stop background sync
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Force sync any pending writes
    if (this.config.strategy === 'write-back' && this.pendingWrites.size > 0) {
      try {
        await this.forceSync();
      } catch (error) {
        console.error('CacheManager: Error during cleanup sync:', error.message);
      }
    }

    // Clear all caches
    this.clear();

    // Reset state
    this.syncInProgress = false;
    this.eventManager = null;
  }
}

module.exports = CacheManager;