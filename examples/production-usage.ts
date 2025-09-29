/**
 * Production Worker Example - TypeScript Version
 * Demonstrates a real-world worker implementation with error handling,
 * monitoring, and graceful shutdown with full type safety
 */

import { createQueueManager, QueueManagerInterface, QueueItem, HealthCheck } from '../src/index';

interface TaskData {
  type: 'email' | 'image' | 'report' | 'webhook';
  subject?: string;
  filename?: string;
  reportType?: string;
  url?: string;
  startTime?: number;
  [key: string]: any;
}

interface TaskItem extends QueueItem {
  data: TaskData;
}

interface WorkerConfig {
  queueId: string;
  workerName: string;
  maxConcurrency: number;
  healthCheckInterval: number;
  shutdownTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

interface WorkerStats {
  processed: number;
  failed: number;
  retried: number;
  startTime: number;
  uptime: number;
  activeJobs: number;
  isRunning: boolean;
}

interface ActiveJob {
  item: TaskItem;
  startTime: number;
}

class ProductionWorker {
  private config: WorkerConfig;
  private queueManager: QueueManagerInterface | null = null;
  private isRunning: boolean = false;
  private activeJobs: Map<string, ActiveJob> = new Map();
  private stats: WorkerStats = {
    processed: 0,
    failed: 0,
    retried: 0,
    startTime: Date.now(),
    uptime: 0,
    activeJobs: 0,
    isRunning: false
  };

  constructor(config: Partial<WorkerConfig> = {}) {
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

    this.setupSignalHandlers();
  }

  async initialize(): Promise<void> {
    console.log(`🚀 Initializing ${this.config.workerName}...`);

    this.queueManager = await createQueueManager({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
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
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
      
      this.queueManager!.redisClient.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.queueManager!.redisClient.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Setup queue if it doesn't exist
    try {
      await this.queueManager.getQueue(this.config.queueId);
      console.log(`📦 Connected to existing queue: ${this.config.queueId}`);
    } catch (error: any) {
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

  private setupEventListeners(): void {
    if (!this.queueManager) return;

    const queueListener = this.queueManager.listen(this.config.queueId);
    
    if (queueListener) {
      queueListener.on('change', (event) => {
        if (event.eventType === 'item:added') {
          console.log(`📥 New item added to queue: ${event.item?.id}`);
        }
      });
    }

    // Global error handling
    this.queueManager.eventEmitter.on('queueChange', (event: any) => {
      if (event.eventType.includes('error')) {
        console.error(`⚠️  Queue error: ${event.error}`);
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Worker is already running');
      return;
    }

    console.log(`🎬 Starting ${this.config.workerName}...`);
    this.isRunning = true;
    this.stats.startTime = Date.now();
    this.stats.isRunning = true;

    // Start processing loop
    this.processLoop();

    console.log(`🔄 ${this.config.workerName} is now processing tasks`);
  }

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Check if we can process more jobs
        if (this.activeJobs.size >= this.config.maxConcurrency) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Get next item from queue
        const item = await this.queueManager!.popFromQueue(this.config.queueId);
        
        if (!item) {
          // No items available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // Process item asynchronously
        this.processItem(item as TaskItem).catch(error => {
          console.error(`❌ Unhandled error processing item ${item.id}:`, error.message);
        });

      } catch (error: any) {
        console.error('❌ Error in process loop:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
      }
    }
  }

  private async processItem(item: TaskItem): Promise<void> {
    const jobId = `${item.id}-${Date.now()}`;
    this.activeJobs.set(jobId, { item, startTime: Date.now() });
    this.stats.activeJobs = this.activeJobs.size;

    console.log(`🎯 Processing item ${item.id}: ${item.data.type || 'unknown'}`);

    try {
      // Mark as processing
      await this.queueManager!.updateItem(this.config.queueId, item.id, {
        status: 'processing',
        worker: this.config.workerName,
        processedAt: new Date().toISOString()
      });

      // Process based on item type
      await this.executeTask(item);

      // Mark as completed
      await this.queueManager!.updateItem(this.config.queueId, item.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        processingTime: Date.now() - this.activeJobs.get(jobId)!.startTime
      });

      this.stats.processed++;
      console.log(`✅ Completed item ${item.id}`);

    } catch (error: any) {
      console.error(`❌ Failed to process item ${item.id}:`, error.message);
      
      // Handle retry logic
      await this.handleRetry(item, error);
      
    } finally {
      this.activeJobs.delete(jobId);
      this.stats.activeJobs = this.activeJobs.size;
    }
  }

  private async executeTask(item: TaskItem): Promise<void> {
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

  private async processEmail(data: any): Promise<void> {
    console.log(`📧 Processing email: ${data.subject || 'No subject'}`);
    
    // Simulate email processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));
    
    // Simulate occasional failures
    if (Math.random() < 0.1) {
      throw new Error('Email service unavailable');
    }
  }

  private async processImage(data: any): Promise<void> {
    console.log(`🖼️  Processing image: ${data.filename || 'unknown'}`);
    
    // Simulate image processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 1000));
    
    if (Math.random() < 0.05) {
      throw new Error('Image processing failed');
    }
  }

  private async generateReport(data: any): Promise<void> {
    console.log(`📊 Generating report: ${data.reportType || 'unknown'}`);
    
    // Simulate report generation
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
    
    if (Math.random() < 0.08) {
      throw new Error('Report generation failed');
    }
  }

  private async sendWebhook(data: any): Promise<void> {
    console.log(`🔗 Sending webhook to: ${data.url || 'unknown'}`);
    
    // Simulate webhook sending
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 200));
    
    if (Math.random() < 0.15) {
      throw new Error('Webhook delivery failed');
    }
  }

  private async handleRetry(item: TaskItem, error: Error): Promise<void> {
    const retryCount = (item.retryCount || 0) + 1;
    
    if (retryCount <= this.config.retryAttempts) {
      console.log(`🔄 Retrying item ${item.id} (attempt ${retryCount}/${this.config.retryAttempts})`);
      
      // Update item with retry information
      await this.queueManager!.updateItem(this.config.queueId, item.id, {
        status: 'retry',
        retryCount,
        lastError: error.message,
        nextRetryAt: new Date(Date.now() + this.config.retryDelay).toISOString()
      });

      // Requeue with delay
      await this.queueManager!.requeueItem(this.config.queueId, item.id, {
        position: 'tail',
        delay: this.config.retryDelay,
        updateStatus: true,
        newStatus: 'pending',
        retryCount: true
      });

      this.stats.retried++;
    } else {
      console.error(`💀 Item ${item.id} failed permanently after ${this.config.retryAttempts} attempts`);
      
      await this.queueManager!.updateItem(this.config.queueId, item.id, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        finalError: error.message,
        retryCount
      });

      this.stats.failed++;
    }
  }

  private startHealthMonitoring(): void {
    setInterval(async () => {
      try {
        const health: HealthCheck = await this.queueManager!.healthCheck();
        const queueStats = await this.queueManager!.getQueueStats(this.config.queueId);
        
        const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
        
        console.log(`📊 Health Check - ${this.config.workerName}`);
        console.log(`   Uptime: ${uptime}s | Active Jobs: ${this.activeJobs.size}`);
        console.log(`   Processed: ${this.stats.processed} | Failed: ${this.stats.failed} | Retried: ${this.stats.retried}`);
        console.log(`   Queue Size: ${queueStats.items.total} | Redis: ${health.status}`);
        console.log(`   Cache Hit Rate: ${health.cache?.hitRate || 0}%`);

        if (health.status !== 'healthy') {
          console.error('⚠️  System health check failed!', health);
        }

      } catch (error: any) {
        console.error('❌ Health check failed:', error.message);
      }
    }, this.config.healthCheckInterval);
  }

  private setupSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown();
      });
    });

    process.on('uncaughtException', (error: Error) => {
      console.error('💥 Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  private async gracefulShutdown(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping worker...');
    this.isRunning = false;
    this.stats.isRunning = false;

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

  getStats(): WorkerStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      activeJobs: this.activeJobs.size,
      isRunning: this.isRunning
    };
  }
}

// Example usage
async function runProductionWorker(): Promise<void> {
  const worker = new ProductionWorker({
    workerName: `worker-${process.env.WORKER_ID || '1'}`,
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '3'),
    retryAttempts: 3
  });

  try {
    await worker.initialize();
    await worker.start();
    
    // Keep the process running
    await new Promise(() => {});
    
  } catch (error: any) {
    console.error('💥 Worker failed to start:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runProductionWorker().catch(console.error);
}

export { ProductionWorker, WorkerConfig, WorkerStats, TaskItem, TaskData };
export default ProductionWorker;
