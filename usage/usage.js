
const createQueueManager = require('../src/index');

async function UsageExample() {
  console.log('Let start a usage example\n');

  // Initialize queue manager
  const queueManager = await createQueueManager({
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
    console.log('Connected to Redis');

    // Generate a unique queue ID for this example run
    const queueId = `email-queue-${Date.now()}`;
    
    // Create a queue
    const queue = await queueManager.createQueue(
      'Email-Queue', 
      queueId,
      { description: 'Queue for processing email notifications' }
    );
    console.log('Created queue:', queue.name);

    // Add some items to the queue
    const emailTasks = [
      { type: 'welcome', email: 'user1@example.com', template: 'welcome' },
      { type: 'newsletter', email: 'user2@example.com', template: 'weekly' },
      { type: 'reminder', email: 'user3@example.com', template: 'payment' }
    ];

    console.log('\nAdding items to queue...');
    for (const task of emailTasks) {
      const item = await queueManager.addToQueue(queueId, task);
      console.log(`Added item ${item.id}: ${task.type} email`);
    }

    // Get queue statistics
    const stats = await queueManager.getQueueStats(queueId);
    console.log(`\nQueue Stats: ${stats.itemCount} items total`);

    // Peek at the next item without removing it
    const nextItem = await queueManager.peekQueue(queueId);
    console.log('\nNext item to process:', nextItem.data.type);

    // Verify queue is empty
    const finalStats = await queueManager.getQueueStats(queueId);
    console.log(`Final queue size: ${finalStats.itemCount} items`);

    // Clean up
    await queueManager.deleteQueue(queueId);
     console.log('Cleaned up queue');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    // Graceful shutdown
    await queueManager.close();
    console.log('Disconnected from Redis');
  }
}

// Run the example
if (require.main === module) {
  UsageExample().catch(console.error);
}

module.exports = UsageExample;
