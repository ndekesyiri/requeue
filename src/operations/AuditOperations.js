/**
 * Audit trail operations for job execution history
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const AuditOperations = {
  /**
   * Configure audit trail for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} auditConfig - Audit configuration
   */
  async configureAuditTrail(queueId, auditConfig) {
    ValidationUtils.validateQueueId(queueId);

    const {
      enabled = true,
      logLevel = 'info', // 'debug', 'info', 'warn', 'error'
      retentionDays = 30,
      logEvents = [
        'job:added',
        'job:updated',
        'job:completed',
        'job:failed',
        'job:popped',
        'queue:paused',
        'queue:resumed'
      ],
      includeData = false,
      includeMetadata = true,
      compressOldLogs = true,
      maxLogSize = 1000000 // 1MB
    } = auditConfig;

    try {
      // Execute before hooks
      if (auditConfig.actions?.beforeAction) {
        await this._executeHooks(
          auditConfig.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, auditConfig },
          'configureAuditTrail'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      const config = {
        enabled,
        logLevel,
        retentionDays,
        logEvents: JSON.stringify(logEvents),
        includeData,
        includeMetadata,
        compressOldLogs,
        maxLogSize,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store audit configuration
      const auditKey = `${this.QUEUE_PREFIX}audit:config:${queueId}`;
      await this.redis.hset(auditKey, config);

      // Execute after hooks
      if (auditConfig.actions?.afterAction) {
        await this._executeHooks(
          auditConfig.actions.afterAction,
          'afterAction',
          queueId,
          config,
          'configureAuditTrail'
        );
      }

      // Emit audit configuration event
      this._emitQueueEvent(queueId, 'audit:configured', {
        queueId,
        config: {
          ...config,
          logEvents: logEvents
        }
      });

      return {
        ...config,
        logEvents: logEvents
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'configureAuditTrail', { queueId, auditConfig });
    }
  },

  /**
   * Log an audit event
   * @param {string} queueId - Queue ID
   * @param {string} eventType - Event type
   * @param {Object} eventData - Event data
   * @param {Object} options - Logging options
   */
  async logAuditEvent(queueId, eventType, eventData, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      level = 'info',
      includeData = null,
      includeMetadata = null,
      customFields = {}
    } = options;

    try {
      // Get audit configuration
      const auditKey = `${this.QUEUE_PREFIX}audit:config:${queueId}`;
      const config = await this.redis.hgetall(auditKey);

      if (Object.keys(config).length === 0 || config.enabled !== 'true') {
        return; // Audit not configured
      }

      // Check if this event type should be logged
      const logEvents = JSON.parse(config.logEvents || '[]');
      if (!logEvents.includes(eventType)) {
        return; // Event type not configured for logging
      }

      // Check log level
      const logLevels = ['debug', 'info', 'warn', 'error'];
      const currentLevelIndex = logLevels.indexOf(level);
      const configLevelIndex = logLevels.indexOf(config.logLevel || 'info');
      
      if (currentLevelIndex < configLevelIndex) {
        return; // Log level too low
      }

      // Prepare audit log entry
      const auditEntry = {
        id: uuidv4(),
        queueId,
        eventType,
        level,
        timestamp: new Date().toISOString(),
        data: (includeData !== null ? includeData : config.includeData === 'true') ? eventData : null,
        metadata: (includeMetadata !== null ? includeMetadata : config.includeMetadata === 'true') ? {
          ...options.metadata,
          ...customFields
        } : null,
        ...customFields
      };

      // Store audit log
      await this._storeAuditLog(queueId, auditEntry);

      // Emit audit event
      this._emitQueueEvent(queueId, 'audit:logged', {
        queueId,
        eventType,
        level,
        auditId: auditEntry.id
      });

      return auditEntry;

    } catch (error) {
      console.error(`QueueManager: Error logging audit event for queue ${queueId}:`, error.message);
    }
  },

  /**
   * Store audit log entry
   * @private
   */
  async _storeAuditLog(queueId, auditEntry) {
    const auditLogKey = `${this.QUEUE_PREFIX}audit:log:${queueId}:${auditEntry.id}`;
    const auditIndexKey = `${this.QUEUE_PREFIX}audit:index:${queueId}`;
    
    const pipeline = this.redis.pipeline();
    
    // Store audit log entry
    pipeline.hset(auditLogKey, {
      ...auditEntry,
      data: auditEntry.data ? JSON.stringify(auditEntry.data) : null,
      metadata: auditEntry.metadata ? JSON.stringify(auditEntry.metadata) : null
    });
    
    // Add to audit index (sorted by timestamp)
    const timestamp = new Date(auditEntry.timestamp).getTime();
    pipeline.zadd(auditIndexKey, timestamp, auditEntry.id);
    
    // Set expiration for audit log
    const retentionDays = await this._getRetentionDays(queueId);
    const ttl = retentionDays * 24 * 60 * 60 * 1000; // Convert to milliseconds
    pipeline.pexpire(auditLogKey, ttl);
    
    await pipeline.exec();
  },

  /**
   * Get retention days for a queue
   * @private
   */
  async _getRetentionDays(queueId) {
    const auditKey = `${this.QUEUE_PREFIX}audit:config:${queueId}`;
    const config = await this.redis.hgetall(auditKey);
    return parseInt(config.retentionDays) || 30;
  },

  /**
   * Get audit logs for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getAuditLogs(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      limit = 100,
      offset = 0,
      fromTime = null,
      toTime = null,
      eventType = null,
      level = null,
      includeData = true
    } = options;

    try {
      const auditIndexKey = `${this.QUEUE_PREFIX}audit:index:${queueId}`;
      
      // Build time range query
      let minScore = fromTime ? fromTime.getTime() : '-inf';
      let maxScore = toTime ? toTime.getTime() : '+inf';
      
      // Get audit log IDs in time range
      const auditIds = await this.redis.zrangebyscore(
        auditIndexKey,
        minScore,
        maxScore,
        'LIMIT',
        offset,
        limit
      );

      if (auditIds.length === 0) {
        return { logs: [], total: 0, offset, limit };
      }

      // Get audit log entries
      const pipeline = this.redis.pipeline();
      auditIds.forEach(auditId => {
        pipeline.hgetall(`${this.QUEUE_PREFIX}audit:log:${queueId}:${auditId}`);
      });

      const results = await pipeline.exec();
      const logs = [];

      for (const [error, logData] of results) {
        if (error || Object.keys(logData).length === 0) continue;
        
        // Parse JSON fields
        const log = {
          ...logData,
          data: logData.data ? JSON.parse(logData.data) : null,
          metadata: logData.metadata ? JSON.parse(logData.metadata) : null
        };

        // Apply filters
        if (eventType && log.eventType !== eventType) continue;
        if (level && log.level !== level) continue;
        if (!includeData) {
          delete log.data;
        }

        logs.push(log);
      }

      // Get total count
      const total = await this.redis.zcard(auditIndexKey);

      return {
        logs,
        total,
        offset,
        limit,
        hasMore: offset + limit < total
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getAuditLogs', { queueId, options });
    }
  },

  /**
   * Get audit statistics
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getAuditStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      fromTime = null,
      toTime = null,
      groupBy = 'hour' // 'minute', 'hour', 'day'
    } = options;

    try {
      const auditIndexKey = `${this.QUEUE_PREFIX}audit:index:${queueId}`;
      
      // Build time range query
      let minScore = fromTime ? fromTime.getTime() : '-inf';
      let maxScore = toTime ? toTime.getTime() : '+inf';
      
      // Get all audit log IDs in time range
      const auditIds = await this.redis.zrangebyscore(auditIndexKey, minScore, maxScore);
      
      if (auditIds.length === 0) {
        return {
          totalLogs: 0,
          eventTypeDistribution: {},
          levelDistribution: {},
          timeDistribution: {},
          averageLogsPerPeriod: 0
        };
      }

      // Get audit log entries
      const pipeline = this.redis.pipeline();
      auditIds.forEach(auditId => {
        pipeline.hgetall(`${this.QUEUE_PREFIX}audit:log:${queueId}:${auditId}`);
      });

      const results = await pipeline.exec();
      const logs = [];

      for (const [error, logData] of results) {
        if (error || Object.keys(logData).length === 0) continue;
        logs.push(logData);
      }

      // Calculate statistics
      const totalLogs = logs.length;
      const eventTypeDistribution = {};
      const levelDistribution = {};
      const timeDistribution = {};

      logs.forEach(log => {
        // Event type distribution
        eventTypeDistribution[log.eventType] = (eventTypeDistribution[log.eventType] || 0) + 1;
        
        // Level distribution
        levelDistribution[log.level] = (levelDistribution[log.level] || 0) + 1;
        
        // Time distribution
        const timestamp = new Date(log.timestamp);
        let timeKey;
        
        switch (groupBy) {
          case 'minute':
            timeKey = timestamp.toISOString().substring(0, 16); // YYYY-MM-DDTHH:mm
            break;
          case 'hour':
            timeKey = timestamp.toISOString().substring(0, 13); // YYYY-MM-DDTHH
            break;
          case 'day':
            timeKey = timestamp.toISOString().substring(0, 10); // YYYY-MM-DD
            break;
          default:
            timeKey = timestamp.toISOString().substring(0, 13);
        }
        
        timeDistribution[timeKey] = (timeDistribution[timeKey] || 0) + 1;
      });

      // Calculate average logs per period
      const timeKeys = Object.keys(timeDistribution);
      const averageLogsPerPeriod = timeKeys.length > 0 ? totalLogs / timeKeys.length : 0;

      return {
        totalLogs,
        eventTypeDistribution,
        levelDistribution,
        timeDistribution,
        averageLogsPerPeriod: Math.round(averageLogsPerPeriod * 100) / 100,
        timeRange: {
          from: fromTime?.toISOString(),
          to: toTime?.toISOString()
        },
        groupBy
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getAuditStats', { queueId, options });
    }
  },

  /**
   * Search audit logs
   * @param {string} queueId - Queue ID
   * @param {Object} searchCriteria - Search criteria
   * @param {Object} options - Search options
   */
  async searchAuditLogs(queueId, searchCriteria, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      query = null,
      eventType = null,
      level = null,
      fromTime = null,
      toTime = null,
      limit = 100,
      offset = 0
    } = searchCriteria;

    try {
      // Get audit logs with basic filters
      const logs = await this.getAuditLogs(queueId, {
        limit: limit + offset, // Get more to allow for filtering
        fromTime,
        toTime,
        eventType,
        level,
        includeData: true
      });

      let filteredLogs = logs.logs;

      // Apply text search if query provided
      if (query) {
        const searchTerms = query.toLowerCase().split(' ');
        filteredLogs = filteredLogs.filter(log => {
          const searchText = [
            log.eventType,
            log.level,
            log.data ? JSON.stringify(log.data) : '',
            log.metadata ? JSON.stringify(log.metadata) : ''
          ].join(' ').toLowerCase();

          return searchTerms.every(term => searchText.includes(term));
        });
      }

      // Apply pagination
      const paginatedLogs = filteredLogs.slice(offset, offset + limit);

      return {
        logs: paginatedLogs,
        total: filteredLogs.length,
        offset,
        limit,
        hasMore: offset + limit < filteredLogs.length,
        searchCriteria: {
          query,
          eventType,
          level,
          fromTime: fromTime?.toISOString(),
          toTime: toTime?.toISOString()
        }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'searchAuditLogs', { queueId, searchCriteria, options });
    }
  },

  /**
   * Export audit logs
   * @param {string} queueId - Queue ID
   * @param {Object} options - Export options
   */
  async exportAuditLogs(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      format = 'json', // 'json', 'csv'
      fromTime = null,
      toTime = null,
      eventType = null,
      level = null,
      includeData = true
    } = options;

    try {
      // Get all audit logs
      const logs = await this.getAuditLogs(queueId, {
        limit: 10000, // Large limit for export
        fromTime,
        toTime,
        eventType,
        level,
        includeData
      });

      if (format === 'csv') {
        return this._exportToCSV(logs.logs);
      } else {
        return {
          format: 'json',
          data: logs.logs,
          metadata: {
            exportedAt: new Date().toISOString(),
            totalLogs: logs.logs.length,
            queueId,
            filters: {
              fromTime: fromTime?.toISOString(),
              toTime: toTime?.toISOString(),
              eventType,
              level
            }
          }
        };
      }

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'exportAuditLogs', { queueId, options });
    }
  },

  /**
   * Export logs to CSV format
   * @private
   */
  _exportToCSV(logs) {
    if (logs.length === 0) {
      return {
        format: 'csv',
        data: '',
        metadata: {
          exportedAt: new Date().toISOString(),
          totalLogs: 0
        }
      };
    }

    // Create CSV headers
    const headers = ['id', 'queueId', 'eventType', 'level', 'timestamp', 'data', 'metadata'];
    
    // Create CSV rows
    const rows = logs.map(log => [
      log.id,
      log.queueId,
      log.eventType,
      log.level,
      log.timestamp,
      log.data ? JSON.stringify(log.data) : '',
      log.metadata ? JSON.stringify(log.metadata) : ''
    ]);

    // Combine headers and rows
    const csvData = [headers, ...rows]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    return {
      format: 'csv',
      data: csvData,
      metadata: {
        exportedAt: new Date().toISOString(),
        totalLogs: logs.length
      }
    };
  },

  /**
   * Clean up old audit logs
   * @param {string} queueId - Queue ID
   * @param {Object} options - Cleanup options
   */
  async cleanupAuditLogs(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      olderThanDays = null,
      maxLogs = null,
      dryRun = false
    } = options;

    try {
      const auditIndexKey = `${this.QUEUE_PREFIX}audit:index:${queueId}`;
      
      // Get retention days from config
      const retentionDays = olderThanDays || await this._getRetentionDays(queueId);
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      // Get old audit log IDs
      const oldAuditIds = await this.redis.zrangebyscore(auditIndexKey, '-inf', cutoffTime);
      
      // Apply max logs limit if specified
      let auditIdsToDelete = oldAuditIds;
      if (maxLogs && oldAuditIds.length > maxLogs) {
        auditIdsToDelete = oldAuditIds.slice(0, maxLogs);
      }

      if (auditIdsToDelete.length === 0) {
        return { cleaned: 0, dryRun };
      }

      if (dryRun) {
        return {
          cleaned: auditIdsToDelete.length,
          dryRun: true,
          wouldDelete: auditIdsToDelete
        };
      }

      // Delete old audit logs
      const pipeline = this.redis.pipeline();
      auditIdsToDelete.forEach(auditId => {
        pipeline.del(`${this.QUEUE_PREFIX}audit:log:${queueId}:${auditId}`);
        pipeline.zrem(auditIndexKey, auditId);
      });

      await pipeline.exec();

      // Emit cleanup event
      this._emitQueueEvent(queueId, 'audit:cleaned', {
        queueId,
        cleanedCount: auditIdsToDelete.length,
        olderThanDays: retentionDays
      });

      return {
        cleaned: auditIdsToDelete.length,
        dryRun: false
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'cleanupAuditLogs', { queueId, options });
    }
  },

  /**
   * Disable audit trail
   * @param {string} queueId - Queue ID
   * @param {Object} options - Disable options
   */
  async disableAuditTrail(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'disableAuditTrail'
        );
      }

      const auditKey = `${this.QUEUE_PREFIX}audit:config:${queueId}`;
      
      // Update configuration
      await this.redis.hset(auditKey, {
        enabled: 'false',
        disabledAt: new Date().toISOString(),
        disabledBy: options.disabledBy || 'system',
        reason: options.reason || 'Manual disable'
      });

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { disabledAt: new Date().toISOString() },
          'disableAuditTrail'
        );
      }

      // Emit disable event
      this._emitQueueEvent(queueId, 'audit:disabled', {
        queueId,
        disabledAt: new Date().toISOString(),
        reason: options.reason
      });

      return {
        disabled: true,
        disabledAt: new Date().toISOString(),
        reason: options.reason
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'disableAuditTrail', { queueId, options });
    }
  }
};

module.exports = AuditOperations;

