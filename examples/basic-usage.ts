/**
 * Basic Usage Example - TypeScript Version
 * Demonstrates basic queue operations with full type safety
 */

import { createQueueManager, QueueManagerInterface, QueueItem } from '../src/index';

interface UserData {
  name: string;
  email: string;
  action: string;
}

interface UserTask extends QueueItem {
  data: UserData;
}

async function basicUsageExample(): Promise<void> {
  console.log('🚀 Starting Basic Usage Example (TypeScript)\n');

  // Create QueueManager with type safety
  const queueManager: QueueManagerInterface = await createQueueManager({
    redis: {
      host: 'localhost',
      port: 6379
    },
    cache: {
      enabled: true,
      strategy: 'write-through'
    }
  });

  try {
    // Wait for initialization
    await queueManager.waitForInitialization();
    console.log('✅ Connected to Redis');

    // Create a queue
    await queueManager.createQueue('User Tasks', 'user-tasks', {
      description: 'Queue for user-related tasks'
    });
    console.log('📦 Created queue: user-tasks');

    // Add items to queue with type safety
    const userTasks: UserData[] = [
      { name: 'John Doe', email: 'john@example.com', action: 'send_welcome_email' },
      { name: 'Jane Smith', email: 'jane@example.com', action: 'update_profile' },
      { name: 'Bob Johnson', email: 'bob@example.com', action: 'send_notification' }
    ];

    console.log('\n📝 Adding user tasks...');
    const addedItems: UserTask[] = [];
    
    for (const task of userTasks) {
      const item = await queueManager.addToQueue('user-tasks', task);
      addedItems.push(item as UserTask);
      console.log(`Added: ${task.name} - ${task.action}`);
    }

    // Get queue statistics
    const stats = await queueManager.getQueueStats('user-tasks');
    console.log(`\n📊 Queue Statistics:`);
    console.log(`  - Total items: ${stats.items.total}`);
    console.log(`  - Status breakdown:`, stats.items.statusBreakdown);

    // Process items from queue
    console.log('\n🔄 Processing tasks...');
    let processedCount = 0;
    
    while (processedCount < addedItems.length) {
      const item = await queueManager.popFromQueue('user-tasks');
      if (!item) break;

      const userTask = item as UserTask;
      console.log(`Processing: ${userTask.data.name} - ${userTask.data.action}`);
      
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update item status
      await queueManager.updateItem('user-tasks', userTask.id, {
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      
      console.log(`✅ Completed: ${userTask.data.name}`);
      processedCount++;
    }

    // Get final statistics
    const finalStats = await queueManager.getQueueStats('user-tasks');
    console.log(`\n📈 Final Statistics:`);
    console.log(`  - Total items: ${finalStats.items.total}`);
    console.log(`  - Status breakdown:`, finalStats.items.statusBreakdown);

    // Health check
    const health = await queueManager.healthCheck();
    console.log(`\n🏥 System Health:`);
    console.log(`  - Status: ${health.status}`);
    console.log(`  - Response time: ${health.responseTime}ms`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    // Cleanup
    try {
      await queueManager.deleteQueue('user-tasks');
      console.log('🧹 Cleaned up queue');
    } catch (error: any) {
      console.warn('⚠️  Cleanup warning:', error.message);
    }

    await queueManager.close();
    console.log('👋 Gracefully shut down');
  }
}

// Run the example
if (require.main === module) {
  basicUsageExample().catch(console.error);
}

export default basicUsageExample;
