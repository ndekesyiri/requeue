/**
 * Advanced Features Example
 * Demonstrates hooks, events, batch operations, and monitoring
 */

const createQueueManager = require('../index');

async function advancedFeaturesExample() {
  console.log('🚀 Starting Advanced Features Example\n');

  const queueManager = createQueueManager({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    },
    cache: {
      enabled: true,
      strategy: 'write-back',
      maxSize: 5000,
      syncInterval: 1000
    }
  });

  try {
    // Wait for connection
    await new Promise((resolve) => {
      queueManager.redis.on('ready', resolve);
    });
    console.log('✅ Connected to Redis');

    // Create processing queue
    await queueManager.createQueue('Task Processing', 'tasks', {
      description: 'High-priority task processing queue',
      priority: 'high'
    });

    // Set up event listeners
    console.log('📡 Setting up event listeners...');
    
    const taskListener = queueManager.listen('tasks');
    taskListener.on('change', (event) => {
      console.log(`🔔 Event: ${event.eventType} - ${event.queueId}`);
    });

    // Global event listener
    queueManager.eventEmitter.on('queueChange', (event) => {
      if (event.eventType.includes('error')) {
        console.log(`⚠️  Error Event: ${event.error}`);
      }
    });

    // Define hooks for enhanced monitoring
    const hooks = {
      beforeAction: [
        async (item, queueId, context) => {
          console.log(`🎣 Before ${context.operation}: ${item.id || 'new item'}`);
          if (context.operation === 'addToQueue') {
            item.data.startTime = Date.now();
          }
        }
      ],
      afterAction: [
        async (item, queueId, context) => {
          console.log(`🎣 After ${context.operation}: ${item.id}`);
          if (context.operation === 'addToQueue') {
            console.log(`   📊 Item added with priority: ${item.data.priority}`);
          }
        }
      ]
    };

    // Add items with different priorities and hooks
    console.log('\n📝 Adding items with priorities and hooks...');
    const tasks = [
      { name: 'Database backup', priority: 10, category: 'maintenance' },
      { name: 'User notification', priority: 5, category: 'communication' },
      { name: 'Report generation', priority: 3, category: 'analytics' },
      { name: 'Data cleanup', priority: 1, category: 'maintenance' },
      { name: 'Email campaign', priority: 7, category: 'marketing' }
    ];

    for (const task of tasks) {
      await queueManager.addToQueue('tasks', task, { actions: hooks });
    }

    // Demonstrate filtering and searching
    console.log('\n🔍 Filtering and searching...');
    
    const highPriorityTasks = await queueManager.filterItems('tasks', 
      item => item.data.priority >= 7
    );
    console.log(`Found ${highPriorityTasks.length} high priority tasks`);

    const maintenanceTask = await queueManager.findItem('tasks',
      item => item.data.category === 'maintenance'
    );
    console.log(`Found maintenance task: ${maintenanceTask.data.name}`);

    // Demonstrate batch status updates
    console.log('\n📦 Batch operations...');
    const allItems = await queueManager.getQueueItems('tasks');
    const itemIds = allItems.slice(0, 3).map(item => item.id);
    
    const batchResult = await queueManager.bulkUpdateItemStatus('tasks', itemIds, 'processing');
    console.log(`Updated ${batchResult.successful} items to 'processing' status`);

    // Requeue items with different priorities
    console.log('\n🔄 Requeuing with priority...');
    if (allItems.length > 0) {
      await queueManager.requeueItem('tasks', allItems[0].id, {
        position: 'head',
        priority: 15,
        updateStatus: true,
        newStatus: 'urgent',
        retryCount: true
      });
      console.log(`Requeued item ${allItems[0].id} with higher priority`);
    }

    // Demonstrate item lifecycle management
    console.log('\n🔄 Item lifecycle management...');
    let processedItems = 0;
    
    while (processedItems < 3) {
      const item = await queueManager.popFromQueue('tasks');
      if (!item) break;

      console.log(`Processing: ${item.data.name} (Priority: ${item.data.priority})`);
      
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));
      
      // Simulate success/failure
      const success = Math.random() > 0.2; // 80% success rate
      
      if (success) {
        console.log(`  ✅ Completed: ${item.data.name}`);
      } else {
        console.log(`  ❌ Failed: ${item.data.name}, requeuing...`);
        await queueManager.requeueItem('tasks', item.id, {
          position: 'tail',
          delay: 1000,
          updateStatus: true,
          newStatus: 'retry',
          retryCount: true
        });
      }
      
      processedItems++;
    }

    // Get comprehensive statistics
    console.log('\n📊 Performance Statistics...');
    const queueStats = await queueManager.getQueueStats('tasks');
    console.log('Queue Statistics:');
    console.log(`  - Total items: ${queueStats.items.total}`);
    console.log(`  - Status breakdown:`, queueStats.items.statusBreakdown);
    
    const cacheStats = queueManager.getCacheStats();
    console.log('Cache Statistics:');
    console.log(`  - Hit rate: ${cacheStats.stats.hitRate}%`);
    console.log(`  - Cache size: ${cacheStats.stats.queueCacheSize + cacheStats.stats.itemsCacheSize} items`);

    // Health check
    const health = await queueManager.healthCheck();
    console.log('System Health:');
    console.log(`  - Status: ${health.status}`);
    console.log(`  - Response time: ${health.responseTime}ms`);
    console.log(`  - Memory usage: ${JSON.stringify(health.memory)}`);

    // Move items between queues
    console.log('\n🔀 Moving items between queues...');
    
    // Create another queue
    await queueManager.createQueue('Archive Queue', 'archive', {
      description: 'Queue for archived items'
    });

    const remainingItems = await queueManager.getQueueItems('tasks');
    if (remainingItems.length > 0) {
      const moveResult = await queueManager.moveItemBetweenQueues(
        'tasks', 'archive', remainingItems[0].id
      );
      console.log(`Moved item ${moveResult.originalItem.data.name} to archive`);
    }

    // Final statistics
    console.log('\n📈 Final Performance Metrics...');
    const finalStats = queueManager.getCacheStats();
    if (finalStats.enabled) {
      console.log('Final Cache Performance:');
      console.log(`  - Total operations: ${finalStats.performance.totalOperations}`);
      console.log(`  - Error rate: ${finalStats.performance.errorRate}%`);
      console.log(`  - Pending writes: ${finalStats.stats.pendingWrites}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    try {
      await queueManager.deleteQueue('tasks');
      await queueManager.deleteQueue('archive');
      console.log('🧹 Cleaned up queues');
    } catch (error) {
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

module.exports = advancedFeaturesExample;