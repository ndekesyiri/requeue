/**
 * Basic Usage Example
 * Demonstrates fundamental queue operations
 */

const createQueueManager = require('../index');

async function basicUsageExample() {
  console.log('🚀 Starting Basic Usage Example\n');

  // Initialize queue manager
  const queueManager = createQueueManager({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    },
    cache: {
      enabled: true,
      strategy: 'write-through',
      maxSize: 1000
    }
  });

  try {
    // Wait for Redis connection
    await new Promise((resolve) => {
      queueManager.redis.on('ready', resolve);
    });
    console.log('✅ Connected to Redis');

    // Create a queue
    const queue = await queueManager.createQueue(
      'Email Queue', 
      'email-queue',
      { description: 'Queue for processing email notifications' }
    );
    console.log('📦 Created queue:', queue.name);

    // Add some items to the queue
    const emailTasks = [
      { type: 'welcome', email: 'user1@example.com', template: 'welcome' },
      { type: 'newsletter', email: 'user2@example.com', template: 'weekly' },
      { type: 'reminder', email: 'user3@example.com', template: 'payment' }
    ];

    console.log('\n📝 Adding items to queue...');
    for (const task of emailTasks) {
      const item = await queueManager.addToQueue('email-queue', task);
      console.log(`  ➕ Added item ${item.id}: ${task.type} email`);
    }

    // Get queue statistics
    const stats = await queueManager.getQueueStats('email-queue');
    console.log(`\n📊 Queue Stats: ${stats.items.total} items total`);

    // Peek at the next item without removing it
    const nextItem = await queueManager.peekQueue('email-queue');
    console.log('\n👀 Next item to process:', nextItem.data.type);

    // Process items one by one
    console.log('\n🔄 Processing items...');
    let processedCount = 0;
    
    while (true) {
      const item = await queueManager.popFromQueue('email-queue');
      if (!item) break;

      console.log(`  🎯 Processing: ${item.data.type} email for ${item.data.email}`);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Mark as completed
      // Note: Item is already removed from queue by popFromQueue
      processedCount++;
      console.log(`  ✅ Completed processing item ${item.id}`);
    }

    console.log(`\n🎉 Processed ${processedCount} items successfully`);

    // Verify queue is empty
    const finalStats = await queueManager.getQueueStats('email-queue');
    console.log(`📊 Final queue size: ${finalStats.items.total} items`);

    // Clean up
    await queueManager.deleteQueue('email-queue');
    console.log('🧹 Cleaned up queue');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    // Graceful shutdown
    await queueManager.close();
    console.log('👋 Disconnected from Redis');
  }
}

// Run the example
if (require.main === module) {
  basicUsageExample().catch(console.error);
}

module.exports = basicUsageExample;