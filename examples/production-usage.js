/**
 * Production Worker Example
 * Demonstrates a real-world worker implementation with error handling,
 * monitoring, and graceful shutdown
 */

const createQueueManager = require('../src/index');

class ProductionWorker {
  constructor(config = {}) {
    this.config = {
      queueId: 'production-tasks',
      workerName: `worker-${process.pid}`,
      maxConcurrency: 3,
      healthCheckInterval: 30000,
      shutdownTimeout: 30000,
      retryAttempts: 3,
      retryDelay: 5000,
      ...config
    };

    this.queueManager = null;
    this.isRunning = false;
    this.activeJobs = new Map();
    this.stats = {
      processed: 0,
      failed: 0,
      retried: 0,
      startTime: Date.now()
    };

    this.setupSignalHandlers();
  }

  async initialize() {
    console.log(`🚀 Initializing ${this.config.workerName}...`);

    this.queueManager = createQueueManager({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        connectTimeout: 10000
      },
      cache: {
        enabled: true,
        strategy: 'write-through',
        maxSize: 10000,
        ttl: 1800000 // 30 minutes
      }
    });

    // Wait for Redis connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
      
      this.queueManager.redisClient.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.queueManager.redisClient.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Setup queue if it doesn't exist
    try {
      await this.queueManager.getQueue(this.config.queueId);
      console.log(`📦 Connected to existing queue: ${this.config.queueId}`);
    } catch (error) {
      if (error.message.includes('not found')) {
        await this.queueManager.createQueue('Production Tasks', this.config.queueId, {
          description: 'Production task processing queue',
          worker: this.config.workerName,
          createdBy: 'production-worker'
        });
        console.log(`📦 Created queue: ${this.config.queueId}`);
      } else {
        throw error;
      }
    }

    // Setup event listeners
    this.setupEventListeners();

    // Start health monitoring
    this.startHealthMonitoring();

    console.log(`✅ ${this.config.workerName} initialized successfully`);
  }

  setupEventListeners() {
    const queueListener = this.queueManager.listen(this.config.queueId);
    
    queueListener.on('change', (event) => {
      if (event.eventType === 'item:added') {
        console.log(`📥 New item added to queue: ${event.item.id}`);
      }
    });

    // Global error handling
    this.queueManager.eventEmitter.on('queueChange', (event) => {
      if (event.eventType.includes('error')) {
        console.error(`⚠️  Queue error: ${event.error}`);
      }
    });
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️  Worker is already running');
      return;
    }

    console.log(`🎬 Starting ${this.config.workerName}...`);
    this.isRunning = true;
    this.stats.startTime = Date.now();

    // Start processing loop
    this.processLoop();

    console.log(`🔄 ${this.config.workerName} is now processing tasks`);
  }

  async processLoop() {
    while (this.isRunning) {
      try {
        // Check if we can process more jobs
        if (this.activeJobs.size >= this.config.maxConcurrency) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Get next item from queue
        const item = await this.queueManager.popFromQueue(this.config.queueId);
        
        if (!item) {
          // No items available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // Process item asynchronously
        this.processItem(item).catch(error => {
          console.error(`❌ Unhandled error processing item ${item.id}:`, error.message);
        });

      } catch (error) {
        console.error('❌ Error in process loop:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
      }
    }
  }

  async processItem(item) {
    const jobId = `${item.id}-${Date.now()}`;
    this.activeJobs.set(jobId, { item, startTime: Date.now() });

    console.log(`🎯 Processing item ${item.id}: ${item.data.type || 'unknown'}`);

    try {
      // Mark as processing
      await this.queueManager.updateItem(this.config.queueId, item.id, {
        status: 'processing',
        worker: this.config.workerName,
        processedAt: new Date().toISOString()
      });

      // Process based on item type
      await this.executeTask(item);

      // Mark as completed
      await this.queueManager.updateItem(this.config.queueId, item.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        processingTime: Date.now() - this.activeJobs.get(jobId).startTime
      });

      this.stats.processed++;
      console.log(`✅ Completed item ${item.id}`);

    } catch (error) {
      console.error(`❌ Failed to process item ${item.id}:`, error.message);
      
      // Handle retry logic
      await this.handleRetry(item, error);
      
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async executeTask(item) {
    const { type, ...taskData } = item.data;

    switch (type) {
      case 'email':
        await this.processEmail(taskData);
        break;
      
      case 'image':
        await this.processImage(taskData);
        break;
      
      case 'report':
        await this.generateReport(taskData);
        break;
      
      case 'webhook':
        await this.sendWebhook(taskData);
        break;
      
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }

  async processEmail(data) {
    console.log(`📧 Processing email: ${data.subject || 'No subject'}`);
    
    // Simulate email processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));
    
    // Simulate occasional failures
    if (Math.random() < 0.1) {
      throw new Error('Email service unavailable');
    }
  }

  async processImage(data) {
    console.log(`🖼️  Processing image: ${data.filename || 'unknown'}`);
    
    // Simulate image processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 1000));
    
    if (Math.random() < 0.05) {
      throw new Error('Image processing failed');
    }
  }

  async generateReport(data) {
    console.log(`📊 Generating report: ${data.reportType || 'unknown'}`);
    
    // Simulate report generation
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
    
    if (Math.random() < 0.08) {
      throw new Error('Report generation failed');
    }
  }

  async sendWebhook(data) {
    console.log(`🔗 Sending webhook to: ${data.url || 'unknown'}`);
    
    // Simulate webhook sending
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 200));
    
    if (Math.random() < 0.15) {
      throw new Error('Webhook delivery failed');
    }
  }

  async handleRetry(item, error) {
    const retryCount = (item.retryCount || 0) + 1;
    
    if (retryCount <= this.config.retryAttempts) {
      console.log(`🔄 Retrying item ${item.id} (attempt ${retryCount}/${this.config.retryAttempts})`);
      
      // Update item with retry information
      await this.queueManager.updateItem(this.config.queueId, item.id, {
        status: 'retry',
        retryCount,
        lastError: error.message,
        nextRetryAt: new Date(Date.now() + this.config.retryDelay).toISOString()
      });

      // Requeue with delay
      await this.queueManager.requeueItem(this.config.queueId, item.id, {
        position: 'tail',
        delay: this.config.retryDelay,
        updateStatus: true,
        newStatus: 'pending',
        retryCount: true
      });

      this.stats.retried++;
    } else {
      console.error(`💀 Item ${item.id} failed permanently after ${this.config.retryAttempts} attempts`);
      
      await this.queueManager.updateItem(this.config.queueId, item.id, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        finalError: error.message,
        retryCount
      });

      this.stats.failed++;
    }
  }

  startHealthMonitoring() {
    setInterval(async () => {
      try {
        const health = await this.queueManager.healthCheck();
        const queueStats = await this.queueManager.getQueueStats(this.config.queueId);
        
        const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
        
        console.log(`📊 Health Check - ${this.config.workerName}`);
        console.log(`   Uptime: ${uptime}s | Active Jobs: ${this.activeJobs.size}`);
        console.log(`   Processed: ${this.stats.processed} | Failed: ${this.stats.failed} | Retried: ${this.stats.retried}`);
        console.log(`   Queue Size: ${queueStats.items.total} | Redis: ${health.status}`);
        console.log(`   Cache Hit Rate: ${health.cache.enabled ? health.cache.hitRate + '%' : 'disabled'}`);

        if (health.status !== 'healthy') {
          console.error('⚠️  System health check failed!', health);
        }

      } catch (error) {
        console.error('❌ Health check failed:', error.message);
      }
    }, this.config.healthCheckInterval);
  }

  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown();
      });
    });

    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  async gracefulShutdown() {
    if (!this.isRunning) return;

    console.log('🛑 Stopping worker...');
    this.isRunning = false;

    // Wait for active jobs to complete
    const shutdownStart = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - shutdownStart < this.config.shutdownTimeout) {
      console.log(`⏳ Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (this.activeJobs.size > 0) {
      console.warn(`⚠️  Forcing shutdown with ${this.activeJobs.size} active jobs`);
    }

    // Close queue manager
    if (this.queueManager) {
      await this.queueManager.close({ forceSyncCache: true });
    }

    console.log('👋 Worker shutdown complete');
    process.exit(0);
  }

  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      activeJobs: this.activeJobs.size,
      isRunning: this.isRunning
    };
  }
}

// Example usage
async function runProductionWorker() {
  const worker = new ProductionWorker({
    workerName: `worker-${process.env.WORKER_ID || '1'}`,
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY) || 3,
    retryAttempts: 3
  });

  try {
    await worker.initialize();
    await worker.start();
    
    // Keep the process running
    await new Promise(() => {});
    
  } catch (error) {
    console.error('💥 Worker failed to start:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runProductionWorker().catch(console.error);
}

module.exports = ProductionWorker;