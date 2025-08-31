/**
 * Performance measurement utilities for QueueManager
 */

class PerformanceUtils {
  constructor() {
    this.operationTimes = new Map();
    this.totalOperations = 0;
    this.errors = 0;
    this.cacheHitRate = 0;
  }

  /**
   * Measure operation performance with decorator pattern
   */
  measurePerformance(operationName, fn) {
    return async (...args) => {
      const start = process.hrtime.bigint();
      
      try {
        const result = await fn.apply(this, args);
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1000000; // Convert to milliseconds

        this._recordTiming(operationName, duration);
        this.totalOperations++;
        
        return result;
      } catch (error) {
        this.errors++;
        throw error;
      }
    };
  }

  /**
   * Record timing for an operation
   * @private
   */
  _recordTiming(operationName, duration) {
    if (!this.operationTimes.has(operationName)) {
      this.operationTimes.set(operationName, []);
    }

    const times = this.operationTimes.get(operationName);
    times.push(duration);

    // Keep only last 1000 measurements to prevent memory leaks
    if (times.length > 1000) {
      times.shift();
    }
  }

  /**
   * Get performance statistics for all operations
   */
  getPerformanceStats() {
    const stats = {};

    for (const [operation, times] of this.operationTimes) {
      if (times.length > 0) {
        const sorted = [...times].sort((a, b) => a - b);
        stats[operation] = this._calculateStats(sorted);
      }
    }

    return {
      operations: stats,
      totalOperations: this.totalOperations,
      totalErrors: this.errors,
      errorRate: this.totalOperations > 0 ?
        Math.round((this.errors / this.totalOperations) * 10000) / 100 : 0
    };
  }

  /**
   * Calculate statistical measures for timing array
   * @private
   */
  _calculateStats(sortedTimes) {
    const count = sortedTimes.length;
    const sum = sortedTimes.reduce((acc, time) => acc + time, 0);
    
    return {
      count,
      avg: Math.round((sum / count) * 100) / 100,
      min: Math.round(sortedTimes[0] * 100) / 100,
      max: Math.round(sortedTimes[count - 1] * 100) / 100,
      p50: Math.round(sortedTimes[Math.floor(count * 0.5)] * 100) / 100,
      p95: Math.round(sortedTimes[Math.floor(count * 0.95)] * 100) / 100,
      p99: Math.round(sortedTimes[Math.floor(count * 0.99)] * 100) / 100
    };
  }

  /**
   * Get performance summary for a specific operation
   */
  getOperationStats(operationName) {
    const times = this.operationTimes.get(operationName);
    
    if (!times || times.length === 0) {
      return null;
    }

    const sorted = [...times].sort((a, b) => a - b);
    return this._calculateStats(sorted);
  }

  /**
   * Reset performance metrics
   */
  reset() {
    this.operationTimes.clear();
    this.totalOperations = 0;
    this.errors = 0;
    this.cacheHitRate = 0;
  }

  /**
   * Get current memory usage statistics
   */
  getMemoryStats() {
    const usage = process.memoryUsage();
    
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100, // MB
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100, // MB
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100 // MB
    };
  }

  /**
   * Monitor performance over time
   */
  startMonitoring(interval = 10000) {
    if (this.monitoringTimer) {
      return;
    }

    this.monitoringTimer = setInterval(() => {
      const stats = this.getPerformanceStats();
      const memory = this.getMemoryStats();
      
      // Emit monitoring data (this would be handled by EventManager in the full system)
      this._onPerformanceUpdate({
        timestamp: new Date().toISOString(),
        performance: stats,
        memory
      });
    }, interval);
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }

  /**
   * Performance update callback (override in main class)
   * @private
   */
  _onPerformanceUpdate(data) {
    // This will be overridden by the main QueueManager class
    // to emit events through the EventManager
  }

  /**
   * Create a timing decorator for methods
   */
  static createTimingDecorator(performanceUtils, operationName) {
    return function(target, propertyKey, descriptor) {
      const originalMethod = descriptor.value;
      
      descriptor.value = async function(...args) {
        return performanceUtils.measurePerformance(operationName, originalMethod).apply(this, args);
      };
      
      return descriptor;
    };
  }

  /**
   * Measure execution time of a function
   */
  static async measureExecutionTime(fn) {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    
    return {
      result,
      duration: Number(end - start) / 1000000 // milliseconds
    };
  }

  /**
   * Create a performance threshold monitor
   */
  createThresholdMonitor(operationName, thresholdMs = 1000) {
    return {
      check: (duration) => {
        if (duration > thresholdMs) {
          console.warn(`QueueManager: ${operationName} took ${duration}ms (threshold: ${thresholdMs}ms)`);
          return false;
        }
        return true;
      }
    };
  }
}

module.exports = PerformanceUtils;