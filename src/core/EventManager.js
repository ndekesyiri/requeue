/**
 * Event management system for QueueManager
 */
const EventEmitter = require('events');

class EventManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxListeners: 50,
      enableAuditLog: true,
      enableMetrics: true,
      enableRateLimiting: true,
      rateLimit: {
        maxEventsPerSecond: 1000,
        windowSizeMs: 1000
      },
      ...config
    };

    // Set max listeners
    this.setMaxListeners(this.config.maxListeners);

    // Queue-specific event emitters
    this.queueListeners = new Map();

    // Event metrics and audit logging
    this.eventMetrics = new Map();
    this.auditLog = [];
    this.maxAuditLogSize = 10000;

    // Rate limiting
    this.rateLimitWindow = new Map();

    // Event middleware
    this.middleware = [];

    this._setupDefaultHandlers();
  }

  /**
   * Setup default event handlers
   * @private
   */
  _setupDefaultHandlers() {
    // Handle uncaught errors in event handlers
    this.on('error', (error) => {
      console.error('EventManager: Unhandled event error:', error);
    });

    // Global event listener for metrics
    if (this.config.enableMetrics) {
      this.onAny((eventType, data) => {
        this._recordEventMetric(eventType, data);
      });
    }

    // Global event listener for audit logging
    if (this.config.enableAuditLog) {
      this.onAny((eventType, data) => {
        this._recordAuditLog(eventType, data);
      });
    }
  }

  /**
   * Listen to all events (custom implementation)
   */
  onAny(callback) {
    const originalEmit = this.emit;
    
    this.emit = function(eventType, ...args) {
      try {
        callback(eventType, ...args);
      } catch (error) {
        console.error('EventManager: Error in onAny callback:', error);
      }
      return originalEmit.apply(this, [eventType, ...args]);
    };
  }

  /**
   * Emit event with rate limiting and middleware
   */
  emit(eventType, data = {}) {
    // Rate limiting check
    if (this.config.enableRateLimiting && this._isRateLimited(eventType)) {
      console.warn(`EventManager: Rate limit exceeded for event type: ${eventType}`);
      return false;
    }

    // Apply middleware
    const processedData = this._applyMiddleware(eventType, data);
    
    // Add standard metadata
    const eventData = {
      timestamp: new Date().toISOString(),
      eventType,
      version: '2.0',
      source: 'QueueManager',
      ...processedData
    };

    try {
      // Emit to global listeners
      const result = super.emit(eventType, eventData);

      // Emit to queue-specific listeners if queueId is present
      if (eventData.queueId && this.queueListeners.has(eventData.queueId)) {
        this.queueListeners.get(eventData.queueId).emit('change', eventData);
      }

      return result;
    } catch (error) {
      console.error(`EventManager: Error emitting ${eventType}:`, error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Get or create queue-specific listener
   */
  getQueueListener(queueId) {
    if (!queueId || typeof queueId !== 'string') {
      throw new Error('Queue ID must be a non-empty string');
    }

    if (!this.queueListeners.has(queueId)) {
      const queueEmitter = new EventEmitter();
      queueEmitter.setMaxListeners(this.config.maxListeners);
      this.queueListeners.set(queueId, queueEmitter);
    }

    return this.queueListeners.get(queueId);
  }

  /**
   * Remove queue-specific listener
   */
  removeQueueListener(queueId) {
    if (this.queueListeners.has(queueId)) {
      const emitter = this.queueListeners.get(queueId);
      emitter.removeAllListeners();
      this.queueListeners.delete(queueId);
      return true;
    }
    return false;
  }

  /**
   * Add event middleware
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middleware.push(middleware);
  }

  /**
   * Apply middleware to event data
   * @private
   */
  _applyMiddleware(eventType, data) {
    let processedData = { ...data };

    for (const middleware of this.middleware) {
      try {
        const result = middleware(eventType, processedData);
        if (result !== undefined) {
          processedData = result;
        }
      } catch (error) {
        console.error('EventManager: Middleware error:', error);
      }
    }

    return processedData;
  }

  /**
   * Check if event type is rate limited
   * @private
   */
  _isRateLimited(eventType) {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.rateLimit.windowSizeMs) * this.config.rateLimit.windowSizeMs;
    const key = `${eventType}:${windowStart}`;

    const currentCount = this.rateLimitWindow.get(key) || 0;
    
    if (currentCount >= this.config.rateLimit.maxEventsPerSecond) {
      return true;
    }

    this.rateLimitWindow.set(key, currentCount + 1);

    // Clean up old rate limit entries
    this._cleanupRateLimitWindow();

    return false;
  }

  /**
   * Clean up old rate limit entries
   * @private
   */
  _cleanupRateLimitWindow() {
    const now = Date.now();
    const cutoff = now - (this.config.rateLimit.windowSizeMs * 2);

    for (const [key] of this.rateLimitWindow) {
      const [, timestamp] = key.split(':');
      if (parseInt(timestamp) < cutoff) {
        this.rateLimitWindow.delete(key);
      }
    }
  }

  /**
   * Record event metrics
   * @private
   */
  _recordEventMetric(eventType, data) {
    if (!this.eventMetrics.has(eventType)) {
      this.eventMetrics.set(eventType, {
        count: 0,
        lastEmitted: null,
        firstEmitted: new Date().toISOString(),
        errors: 0
      });
    }

    const metric = this.eventMetrics.get(eventType);
    metric.count++;
    metric.lastEmitted = new Date().toISOString();

    // Track errors
    if (eventType.includes('error') || data.error) {
      metric.errors++;
    }
  }

  /**
   * Record audit log entry
   * @private
   */
  _recordAuditLog(eventType, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      queueId: data.queueId,
      operation: data.operation || 'unknown',
      userId: data.userId,
      metadata: {
        source: data.source || 'internal',
        version: data.version || '2.0'
      }
    };

    this.auditLog.push(logEntry);

    // Maintain audit log size
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog.shift();
    }
  }

  /**
   * Get event metrics
   */
  getMetrics() {
    const metrics = {};
    
    for (const [eventType, metric] of this.eventMetrics) {
      metrics[eventType] = { ...metric };
    }

    return {
      eventTypes: Object.keys(metrics).length,
      totalEvents: Object.values(metrics).reduce((sum, m) => sum + m.count, 0),
      totalErrors: Object.values(metrics).reduce((sum, m) => sum + m.errors, 0),
      metrics,
      queueListeners: this.queueListeners.size,
      globalListeners: this.listenerCount(),
      rateLimitEntries: this.rateLimitWindow.size
    };
  }

  /**
   * Get audit log
   */
  getAuditLog(options = {}) {
    const {
      queueId,
      eventType,
      operation,
      limit = 100,
      since
    } = options;

    let filteredLog = [...this.auditLog];

    // Apply filters
    if (queueId) {
      filteredLog = filteredLog.filter(entry => entry.queueId === queueId);
    }

    if (eventType) {
      filteredLog = filteredLog.filter(entry => entry.eventType === eventType);
    }

    if (operation) {
      filteredLog = filteredLog.filter(entry => entry.operation === operation);
    }

    if (since) {
      const sinceTime = new Date(since);
      filteredLog = filteredLog.filter(entry => new Date(entry.timestamp) >= sinceTime);
    }

    // Sort by timestamp (newest first) and limit
    return filteredLog
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Clear audit log
   */
  clearAuditLog() {
    this.auditLog = [];
  }

  /**
   * Create event filters
   */
  createFilter(filterFn) {
    return (eventType, data) => {
      if (filterFn(eventType, data)) {
        return data;
      }
      return null; // Filter out the event
    };
  }

  /**
   * Create event transformers
   */
  createTransformer(transformFn) {
    return (eventType, data) => {
      return transformFn(eventType, data);
    };
  }

  /**
   * Batch emit multiple events
   */
  emitBatch(events) {
    const results = [];
    
    for (const event of events) {
      try {
        const result = this.emit(event.type, event.data);
        results.push({ success: true, eventType: event.type, result });
      } catch (error) {
        results.push({ 
          success: false, 
          eventType: event.type, 
          error: error.message 
        });
      }
    }

    return results;
  }

  /**
   * Create event debouncer
   */
  createDebouncer(eventType, delay = 1000) {
    let timeout = null;
    let pendingData = [];

    return (data) => {
      pendingData.push(data);
      
      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(() => {
        this.emit(eventType, {
          batchData: pendingData,
          batchSize: pendingData.length
        });
        pendingData = [];
        timeout = null;
      }, delay);
    };
  }

  /**
   * Get event statistics for monitoring
   */
  getStats() {
    const metrics = this.getMetrics();
    
    return {
      enabled: true,
      globalListeners: this.listenerCount(),
      queueListeners: this.queueListeners.size,
      totalEvents: metrics.totalEvents,
      totalErrors: metrics.totalErrors,
      errorRate: metrics.totalEvents > 0 ? 
        Math.round((metrics.totalErrors / metrics.totalEvents) * 10000) / 100 : 0,
      auditLogSize: this.auditLog.length,
      rateLimitEntries: this.rateLimitWindow.size,
      middleware: this.middleware.length,
      config: this.config
    };
  }

  /**
   * Health check for event system
   */
  healthCheck() {
    const stats = this.getStats();
    const memoryUsage = process.memoryUsage();
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats,
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        auditLogMemory: Math.round((this.auditLog.length * 200) / 1024) // Rough estimate
      },
      performance: {
        avgEventsPerSecond: this._calculateAvgEventsPerSecond(),
        peakMemoryUsage: this.auditLog.length >= this.maxAuditLogSize
      }
    };
  }

  /**
   * Calculate average events per second
   * @private
   */
  _calculateAvgEventsPerSecond() {
    if (this.auditLog.length < 2) return 0;
    
    const first = new Date(this.auditLog[0].timestamp);
    const last = new Date(this.auditLog[this.auditLog.length - 1].timestamp);
    const durationSeconds = (last - first) / 1000;
    
    return durationSeconds > 0 ? Math.round(this.auditLog.length / durationSeconds) : 0;
  }

  /**
   * Cleanup and destroy event manager
   */
  destroy() {
    // Remove all global listeners
    this.removeAllListeners();

    // Clean up queue-specific listeners
    for (const [queueId, emitter] of this.queueListeners) {
      emitter.removeAllListeners();
    }
    this.queueListeners.clear();

    // Clear data structures
    this.eventMetrics.clear();
    this.auditLog = [];
    this.rateLimitWindow.clear();
    this.middleware = [];
  }
}

module.exports = EventManager;