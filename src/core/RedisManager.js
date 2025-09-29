/**
 * Redis connection and operations manager
 */
const Redis = require('ioredis');
const { ErrorHandlers, RedisError, TimeoutError } = require('../utils/ErrorHandlers');

class RedisManager {
  constructor(config = {}, eventManager = null, errorHandlers = null) {
    this.eventManager = eventManager;
    this.errorHandlers = errorHandlers || new ErrorHandlers(eventManager);
    this.isConnected = false;
    this.isReady = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.connectionPromise = null;

    // Default Redis configuration - FIXED SETTINGS
    this.config = {
      host: 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,  // CHANGED: Use lazy connect to control connection timing
      enableReadyCheck: true,
      enableOfflineQueue: true,  // CHANGED: Enable offline queue
      connectTimeout: 10000,  // CHANGED: Increased from 1000ms to 10000ms
      commandTimeout: 10000,  // CHANGED: Increased from 5000ms to 10000ms
      family: 4,
      keepAlive: true,
      enableAutoPipelining: true,
      // Added retry configuration
      retryDelayOnFailed: 200,
      maxRetriesPerRequest: null,  // Allow unlimited retries
      ...config
    };

    this.redis = null;
    this._initializeConnection();
  }

  /**
   * Initialize Redis connection
   * @private
   */
  _initializeConnection() {
    try {
      this.redis = new Redis(this.config);
      this._setupEventHandlers();
      
      // Start connection explicitly since we're using lazyConnect
      this.connectionPromise = this._connect();
    } catch (error) {
      throw this.errorHandlers.handleError(
        new RedisError('Failed to create Redis instance', 'initialize', error),
        'RedisManager:initialize'
      );
    }
  }

  /**
   * Establish connection to Redis
   * @private
   */
  async _connect() {
    try {
      console.log('RedisManager: Connecting to Redis...');
      await this.redis.connect();
      return true;
    } catch (error) {
      const handledError = this.errorHandlers.handleError(
        new RedisError('Failed to connect to Redis', 'connect', error),
        'RedisManager:connect'
      );
      throw handledError;
    }
  }

  /**
   * Setup Redis event handlers
   * @private
   */
  _setupEventHandlers() {
    this.redis.on('ready', () => {
      this.isConnected = true;
      this.isReady = true;
      this.reconnectAttempts = 0;
      console.log('RedisManager: Connection established and ready');
      
      if (this.eventManager) {
        this.eventManager.emit('redis:connected', {
          timestamp: new Date().toISOString(),
          host: this.config.host,
          port: this.config.port
        });
      }
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      this.isReady = false;
      console.error('RedisManager: Redis error:', error.message);
      
      // Only handle if it's not a connection error during initialization
      if (this.reconnectAttempts > 0 || error.message.includes('ECONNREFUSED')) {
        const handledError = this.errorHandlers.handleError(
          new RedisError('Redis connection error', 'connection', error),
          'RedisManager:connection'
        );

        if (this.eventManager) {
          this.eventManager.emit('redis:error', {
            timestamp: new Date().toISOString(),
            error: handledError.message,
            reconnectAttempts: this.reconnectAttempts
          });
        }
      }
    });

    this.redis.on('reconnecting', (delay) => {
      this.reconnectAttempts++;
      this.isConnected = false;
      this.isReady = false;
      console.log(`RedisManager: Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
      
      if (this.eventManager) {
        this.eventManager.emit('redis:reconnecting', {
          timestamp: new Date().toISOString(),
          attempt: this.reconnectAttempts,
          delay
        });
      }
    });

    this.redis.on('connect', () => {
      this.isConnected = true;
      console.log('RedisManager: Connected to Redis');
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      this.isReady = false;
      console.log('RedisManager: Connection closed');
      
      if (this.eventManager) {
        this.eventManager.emit('redis:disconnected', {
          timestamp: new Date().toISOString()
        });
      }
    });

    this.redis.on('end', () => {
      this.isConnected = false;
      this.isReady = false;
      console.log('RedisManager: Connection ended');
    });
  }

  /**
   * Wait for Redis connection to be ready
   */
  async waitForConnection(timeout = 30000) {  // CHANGED: Increased timeout
    // If already ready, return immediately
    if (this.isReady && this.isConnected) {
      return true;
    }

    // Wait for initial connection if it's in progress
    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
        if (this.isReady) {
          return true;
        }
      } catch (error) {
        // Continue to the promise-based waiting below
      }
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError('Redis connection timeout', 'connection', timeout));
      }, timeout);

      // Check if already ready
      if (this.isReady && this.isConnected) {
        clearTimeout(timeoutId);
        resolve(true);
        return;
      }

      this.redis.once('ready', () => {
        clearTimeout(timeoutId);
        resolve(true);
      });

      this.redis.once('error', (error) => {
        clearTimeout(timeoutId);
        reject(this.errorHandlers.handleError(
          new RedisError('Redis connection failed', 'connection', error),
          'RedisManager:waitForConnection'
        ));
      });
    });
  }

  /**
   * Ensure Redis is ready before executing commands
   * @private
   */
  async _ensureReady() {
    if (!this.redis) {
      throw new RedisError('Redis client not initialized', 'execute', null);
    }

    if (!this.isReady) {
      console.log('RedisManager: Waiting for connection to be ready...');
      await this.waitForConnection();
    }
  }

  /**
   * Execute Redis command with error handling and retry logic
   */
  async executeCommand(command, ...args) {
    await this._ensureReady();

    try {
      const result = await this.redis[command](...args);
      return result;
    } catch (error) {
      throw this.errorHandlers.handleError(
        new RedisError(`Redis ${command} command failed: ${error.message}`, command, error),
        `RedisManager:${command}`
      );
    }
  }

  /**
   * Create and execute pipeline
   */
  async executePipeline(commands) {
    await this._ensureReady();

    try {
      const pipeline = this.redis.pipeline();
      
      commands.forEach(({ command, args }) => {
        pipeline[command](...args);
      });

      const results = await pipeline.exec();
      
      // Check for errors in pipeline results
      const errors = [];
      const successResults = [];
      
      results.forEach(([error, result], index) => {
        if (error) {
          errors.push({
            index,
            command: commands[index].command,
            error: error.message
          });
        } else {
          successResults.push(result);
        }
      });

      if (errors.length > 0) {
        throw new RedisError(
          `Pipeline execution failed: ${errors.length} commands failed`,
          'pipeline',
          { errors, totalCommands: commands.length }
        );
      }

      return successResults;
    } catch (error) {
      throw this.errorHandlers.handleError(
        error instanceof RedisError ? error : new RedisError(`Pipeline execution error: ${error.message}`, 'pipeline', error),
        'RedisManager:pipeline'
      );
    }
  }

  /**
   * Hash operations
   */
  async hset(key, field, value) {
    if (typeof field === 'object') {
      // Multiple fields
      return this.executeCommand('hset', key, field);
    }
    return this.executeCommand('hset', key, field, value);
  }

  async hget(key, field) {
    return this.executeCommand('hget', key, field);
  }

  async hgetall(key) {
    return this.executeCommand('hgetall', key);
  }

  async hdel(key, ...fields) {
    return this.executeCommand('hdel', key, ...fields);
  }

  async hexists(key, field) {
    return this.executeCommand('hexists', key, field);
  }

  /**
   * List operations
   */
  async lpush(key, ...elements) {
    return this.executeCommand('lpush', key, ...elements);
  }

  async rpush(key, ...elements) {
    return this.executeCommand('rpush', key, ...elements);
  }

  async lpop(key) {
    return this.executeCommand('lpop', key);
  }

  async rpop(key) {
    return this.executeCommand('rpop', key);
  }

  async lrange(key, start, stop) {
    return this.executeCommand('lrange', key, start, stop);
  }

  async llen(key) {
    return this.executeCommand('llen', key);
  }

  async lindex(key, index) {
    return this.executeCommand('lindex', key, index);
  }

  async lrem(key, count, element) {
    return this.executeCommand('lrem', key, count, element);
  }

  /**
   * Key operations
   */
  async exists(...keys) {
    return this.executeCommand('exists', ...keys);
  }

  async del(...keys) {
    return this.executeCommand('del', ...keys);
  }

  async keys(pattern) {
    return this.executeCommand('keys', pattern);
  }

  async expire(key, seconds) {
    return this.executeCommand('expire', key, seconds);
  }

  async ttl(key) {
    return this.executeCommand('ttl', key);
  }

  /**
   * String operations
   */
  async set(key, value, ...options) {
    return this.executeCommand('set', key, value, ...options);
  }

  async get(key) {
    return this.executeCommand('get', key);
  }

  async incr(key) {
    return this.executeCommand('incr', key);
  }

  async decr(key) {
    return this.executeCommand('decr', key);
  }

  /**
   * Connection operations
   */
  async ping() {
    return this.executeCommand('ping');
  }

  async info(section) {
    return this.executeCommand('info', section);
  }

  /**
   * Transaction operations
   */
  async multi() {
    await this._ensureReady();
    return this.redis.multi();
  }

  /**
   * Pub/Sub operations
   */
  async publish(channel, message) {
    return this.executeCommand('publish', channel, message);
  }

  async subscribe(...channels) {
    return this.executeCommand('subscribe', ...channels);
  }

  async unsubscribe(...channels) {
    return this.executeCommand('unsubscribe', ...channels);
  }

  /**
   * Lua script execution
   */
  async eval(script, keys, args) {
    return this.executeCommand('eval', script, keys.length, ...keys, ...args);
  }

  /**
   * Get Redis client status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      ready: this.isReady,
      status: this.redis?.status || 'disconnected',
      reconnectAttempts: this.reconnectAttempts,
      host: this.config.host,
      port: this.config.port,
      commandTimeout: this.config.commandTimeout,
      connectTimeout: this.config.connectTimeout
    };
  }

  /**
   * Get Redis server info
   */
  async getServerInfo() {
    try {
      const info = await this.info();
      const lines = info.split('\r\n');
      const parsed = {};
      let section = 'general';

      lines.forEach(line => {
        if (line.startsWith('# ')) {
          section = line.substring(2).toLowerCase();
          parsed[section] = {};
        } else if (line.includes(':')) {
          const [key, value] = line.split(':');
          if (!parsed[section]) parsed[section] = {};
          parsed[section][key] = value;
        }
      });

      return parsed;
    } catch (error) {
      throw this.errorHandlers.handleError(
        new RedisError(`Failed to get server info: ${error.message}`, 'info', error),
        'RedisManager:getServerInfo'
      );
    }
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck() {
    try {
      const start = Date.now();
      await this.ping();
      const responseTime = Date.now() - start;

      return {
        status: 'healthy',
        connected: this.isConnected,
        ready: this.isReady,
        responseTime,
        reconnectAttempts: this.reconnectAttempts,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        ready: false,
        error: error.message,
        reconnectAttempts: this.reconnectAttempts,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Manual connection initiation (useful for lazy connect)
   */
  async connect() {
    if (this.isReady && this.isConnected) {
      return true;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    return this.connectionPromise;
  }

  /**
   * Close Redis connection
   */
  async disconnect(timeout = 5000) {
    if (!this.redis) {
      return;
    }

    try {
      console.log('RedisManager: Closing Redis connection...');
      
      const closePromise = this.redis.quit();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new TimeoutError('Redis close timeout', 'disconnect', timeout)), timeout)
      );

      await Promise.race([closePromise, timeoutPromise]);
      console.log('RedisManager: Connection closed gracefully');
    } catch (error) {
      console.warn('RedisManager: Graceful close failed, forcing disconnect');
      this.redis.disconnect();
    } finally {
      this.isConnected = false;
      this.isReady = false;
      this.redis = null;
      this.connectionPromise = null;
    }
  }

  /**
   * Get the Redis client for direct access
   */
  get client() {
    return this.redis;
  }
}

module.exports = RedisManager;