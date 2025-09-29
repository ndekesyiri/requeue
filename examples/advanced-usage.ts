/**
 * Advanced Features Example - TypeScript Version
 * Demonstrates hooks, events, batch operations, and monitoring with full type safety
 */

import { createQueueManager, QueueManagerInterface, QueueItem, QueueStats, CacheStats, HealthCheck } from '../src/index';

interface TaskData {
  name: string;
  priority: number;
  category: string;
  startTime?: number;
}

interface TaskItem extends QueueItem {
  data: TaskData;
}

async function advancedFeaturesExample(): Promise<void> {
  console.log('🚀 Starting Advanced Features Example (TypeScript)\n');

  const queueManager: QueueManagerInterface = await createQueueManager({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379')
    },
    cache: {
      enabled: true,
      strategy: 'write-back',
      maxSize: 5000,
      syncInterval: 1000
    }
  });

  try {
    // Wait for initialization to complete
    await queueManager.waitForInitialization();
    console.log('✅ Connected to Redis');

    // Create processing queue (or use existing one)
    try {
      await queueManager.createQueue('Task-Processing', 'tasks', {
        description: 'High-priority task processing queue',
        priority: 'high'
      });
      console.log('📦 Created new queue: tasks');
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        console.log('📦 Using existing queue: tasks');
      } else {
        throw error;
      }
    }

    // Set up event listeners with type safety
    console.log('📡 Setting up event listeners...');
    
    const taskListener = queueManager.listen('tasks');
    if (taskListener) {
      taskListener.on('change', (event) => {
        console.log(`🔔 Event: ${event.eventType} - ${event.queueId}`);
      });
    }

    // Global event listener
    if (queueManager.eventEmitter) {
      queueManager.eventEmitter.on('queueChange', (event: any) => {
        if (event.eventType.includes('error')) {
          console.log(`⚠️  Error Event: ${event.error}`);
        }
      });
    }

    // Define hooks for enhanced monitoring with proper typing
    const hooks = {
      beforeAction: [
        async (item: TaskItem, queueId: string, context: any) => {
          console.log(`🎣 Before ${context.operation}: ${item.id || 'new item'}`);
          if (context.operation === 'addToQueue') {
            item.data.startTime = Date.now();
          }
        }
      ],
      afterAction: [
        async (item: TaskItem, queueId: string, context: any) => {
          console.log(`🎣 After ${context.operation}: ${item.id}`);
          if (context.operation === 'addToQueue') {
            console.log(`   📊 Item added with priority: ${item.data.priority}`);
          }
        }
      ]
    };

    // Add items with different priorities and hooks
    console.log('\n📝 Adding items with priorities and hooks...');
    const tasks: TaskData[] = [
      { name: 'Database backup', priority: 10, category: 'maintenance' },
      { name: 'User notification', priority: 5, category: 'communication' },
      { name: 'Report generation', priority: 3, category: 'analytics' },
      { name: 'Data cleanup', priority: 1, category: 'maintenance' },
      { name: 'Email campaign', priority: 7, category: 'marketing' }
    ];

    for (const task of tasks) {
      const addedItem = await queueManager.addToQueue('tasks', task, { actions: hooks });
      console.log(`Added item: ${addedItem.data.name} (ID: ${addedItem.id})`);
    }

    // Demonstrate filtering and searching with type safety
    console.log('\n🔍 Filtering and searching...');
    
    const highPriorityTasks = await queueManager.filterItems('tasks', 
      (item: TaskItem) => item.data.priority >= 7
    );
    console.log(`Found ${highPriorityTasks.length} high priority tasks`);

    const maintenanceTask = await queueManager.findItem('tasks',
      (item: TaskItem) => item.data.category === 'maintenance'
    );
    if (maintenanceTask) {
      console.log(`Found maintenance task: ${maintenanceTask.data.name}`);
    }

    // Demonstrate batch status updates
    console.log('\n📦 Batch operations...');
    const allItems: TaskItem[] = await queueManager.getQueueItems('tasks');
    
    if (allItems && allItems.length > 0) {
      const itemIds = allItems.slice(0, 3).map(item => item.id);
      
      const batchResult = await queueManager.bulkUpdateItemStatus('tasks', itemIds, 'processing');
      console.log(`Updated ${batchResult.successful} items to 'processing' status`);
    } else {
      console.log('No items available for batch operations');
    }

    // Requeue items with different priorities
    console.log('\n🔄 Requeuing with priority...');
    if (allItems && allItems.length > 0) {
      const firstItem = allItems[0];
      if (firstItem) {
        await queueManager.requeueItem('tasks', firstItem.id, {
          position: 'head',
          priority: 15,
          updateStatus: true,
          newStatus: 'urgent',
          retryCount: true
        });
        console.log(`Requeued item ${firstItem.id} with higher priority`);
      }
    }

    // Demonstrate item lifecycle management
    console.log('\n🔄 Item lifecycle management...');
    let processedItems = 0;
    
    while (processedItems < 3) {
      const item = await queueManager.popFromQueue('tasks');
      if (!item) break;

      const taskItem = item as TaskItem;
      console.log(`Processing: ${taskItem.data.name} (Priority: ${taskItem.data.priority})`);
      
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));
      
      // Simulate success/failure
      const success = Math.random() > 0.2; // 80% success rate
      
      if (success) {
        console.log(`  ✅ Completed: ${taskItem.data.name}`);
      } else {
        console.log(`  ❌ Failed: ${taskItem.data.name}, requeuing...`);
        await queueManager.requeueItem('tasks', taskItem.id, {
          position: 'tail',
          delay: 1000,
          updateStatus: true,
          newStatus: 'retry',
          retryCount: true
        });
      }
      
      processedItems++;
    }

    // Get comprehensive statistics with proper typing
    console.log('\n📊 Performance Statistics...');
    const queueStats: QueueStats = await queueManager.getQueueStats('tasks');
    console.log('Queue Statistics:');
    console.log(`  - Total items: ${queueStats.items.total}`);
    console.log(`  - Status breakdown:`, queueStats.items.statusBreakdown);
    
    const cacheStats: CacheStats = queueManager.getCacheStats();
    console.log('Cache Statistics:');
    console.log(`  - Hit rate: ${cacheStats.stats.hitRate}%`);
    console.log(`  - Cache size: ${cacheStats.stats.queueCacheSize + cacheStats.stats.itemsCacheSize} items`);

    // Health check with proper typing
    const health: HealthCheck = await queueManager.healthCheck();
    console.log('System Health:');
    console.log(`  - Status: ${health.status}`);
    console.log(`  - Response time: ${health.responseTime}ms`);
    console.log(`  - Memory usage: ${JSON.stringify(health.memory)}`);

    // Move items between queues
    console.log('\n🔀 Moving items between queues...');
    
    // Create another queue
    await queueManager.createQueue('Archive-Queue', 'archive', {
      description: 'Queue for archived items'
    });

    const remainingItems: TaskItem[] = await queueManager.getQueueItems('tasks');
    if (remainingItems && remainingItems.length > 0) {
      const firstItem = remainingItems[0];
      if (firstItem) {
        const moveResult = await queueManager.moveItemBetweenQueues(
          'tasks', 'archive', firstItem.id
        );
        console.log(`Moved item ${moveResult.originalItem?.data?.name || firstItem.data.name} to archive`);
      }
    }

    // Final statistics
    console.log('\n📈 Final Performance Metrics...');
    const finalStats: CacheStats = queueManager.getCacheStats();
    if (finalStats.enabled) {
      console.log('Final Cache Performance:');
      console.log(`  - Total operations: ${finalStats.performance.totalOperations}`);
      console.log(`  - Error rate: ${finalStats.performance.errorRate}%`);
      console.log(`  - Pending writes: ${finalStats.stats.pendingWrites}`);
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    try {
      await queueManager.deleteQueue('tasks');
      await queueManager.deleteQueue('archive');
      console.log('🧹 Cleaned up queues');
    } catch (error: any) {
      console.warn('⚠️  Cleanup warning:', error.message);
    }

    await queueManager.close({ forceSyncCache: true });
    console.log('👋 Gracefully shut down');
  }
}

// Run the example
if (require.main === module) {
  advancedFeaturesExample().catch(console.error);
}

export default advancedFeaturesExample;
