const createQueueManager = require('../src/index');

async function popOperationsExample() {
  console.log('🚀 Starting Pop Operations Example\n');

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
    console.log('✅ Connected to Redis');

    // Generate a unique queue ID for this example run
    const queueId = `task-queue-${Date.now()}`;
    
    // Create a queue
    const queue = await queueManager.createQueue(
      'Task-Queue', 
      queueId,
      { description: 'Queue for processing various tasks' }
    );
    console.log(`📦 Created queue: ${queue.name}`);

    // Add multiple items to the queue
    const tasks = [
      { id: 1, type: 'email', recipient: 'user1@example.com', subject: 'Welcome!' },
      { id: 2, type: 'sms', recipient: '+1234567890', message: 'Your order is ready' },
      { id: 3, type: 'push', recipient: 'user123', title: 'New notification' },
      { id: 4, type: 'email', recipient: 'user2@example.com', subject: 'Newsletter' },
      { id: 5, type: 'sms', recipient: '+0987654321', message: 'Payment reminder' },
      { id: 6, type: 'push', recipient: 'user456', title: 'Update available' },
      { id: 7, type: 'email', recipient: 'user3@example.com', subject: 'Order confirmation' },
      { id: 8, type: 'sms', recipient: '+1122334455', message: 'Delivery scheduled' }
    ];

    console.log('\n📝 Adding items to queue...');
    for (const task of tasks) {
      const item = await queueManager.addToQueue(queueId, task);
      console.log(`   Added item ${item.id}: ${task.type} for ${task.recipient}`);
    }

    // Get initial queue statistics
    const initialStats = await queueManager.getQueueStats(queueId);
    console.log(`\n📊 Initial Queue Stats: ${initialStats.itemCount} items total`);

    // ===== SINGLE POP OPERATIONS =====
    console.log('\n🔍 === SINGLE POP OPERATIONS ===');
    
    // Pop one item at a time
    console.log('\n1️⃣ Popping items one by one:');
    for (let i = 0; i < 3; i++) {
      const poppedItem = await queueManager.popFromQueue(queueId);
      if (poppedItem) {
        console.log(`   Popped item ${poppedItem.id}: ${poppedItem.data.type} for ${poppedItem.data.recipient}`);
      } else {
        console.log('   No items left to pop');
        break;
      }
    }

    // Check queue size after single pops
    const afterSinglePops = await queueManager.getQueueStats(queueId);
    console.log(`\n📊 Queue size after single pops: ${afterSinglePops.itemCount} items`);

    // ===== BATCH POP OPERATIONS =====
    console.log('\n🔍 === BATCH POP OPERATIONS ===');
    
    // Pop multiple items at once
    console.log('\n2️⃣ Popping 3 items in batch:');
    const batch1 = await queueManager.popBatchFromQueue(queueId, 3);
    console.log(`   Popped ${batch1.length} items in batch:`);
    batch1.forEach((item, index) => {
      console.log(`     ${index + 1}. Item ${item.id}: ${item.data.type} for ${item.data.recipient}`);
    });

    // Check queue size after batch pop
    const afterBatch1 = await queueManager.getQueueStats(queueId);
    console.log(`\n📊 Queue size after batch pop: ${afterBatch1.itemCount} items`);

    // Pop remaining items in another batch
    console.log('\n3️⃣ Popping remaining items in batch:');
    const batch2 = await queueManager.popBatchFromQueue(queueId, 5); // Try to pop 5, but only 2 remain
    console.log(`   Popped ${batch2.length} items in batch:`);
    batch2.forEach((item, index) => {
      console.log(`     ${index + 1}. Item ${item.id}: ${item.data.type} for ${item.data.recipient}`);
    });

    // ===== EDGE CASES =====
    console.log('\n🔍 === EDGE CASES ===');
    
    // Try to pop from empty queue
    console.log('\n4️⃣ Attempting to pop from empty queue:');
    const emptyPop = await queueManager.popFromQueue(queueId);
    console.log(`   Result: ${emptyPop ? 'Got item' : 'No items available'}`);

    // Try to pop batch from empty queue
    console.log('\n5️⃣ Attempting batch pop from empty queue:');
    const emptyBatch = await queueManager.popBatchFromQueue(queueId, 3);
    console.log(`   Result: Got ${emptyBatch.length} items`);

    // ===== HOOKS DEMONSTRATION =====
    console.log('\n🔍 === HOOKS DEMONSTRATION ===');
    
    // Add some items back for hooks demo
    console.log('\n6️⃣ Adding items back for hooks demonstration:');
    const newTasks = [
      { id: 9, type: 'email', recipient: 'admin@example.com', subject: 'System alert' },
      { id: 10, type: 'sms', recipient: '+9998887776', message: 'Maintenance notice' }
    ];

    for (const task of newTasks) {
      await queueManager.addToQueue(queueId, task);
      console.log(`   Added item ${task.id}: ${task.type} for ${task.recipient}`);
    }

    // Pop with hooks
    console.log('\n7️⃣ Popping with before/after hooks:');
    const poppedWithHooks = await queueManager.popFromQueue(queueId, {
      actions: {
        beforeAction: async (queueId, data) => {
          console.log(`   🔧 Before hook: About to pop from queue ${queueId}`);
        },
        afterAction: async (queueId, data) => {
          console.log(`   🔧 After hook: Successfully popped from queue ${queueId}`);
        }
      }
    });
    
    if (poppedWithHooks) {
      console.log(`   Result: Popped item ${poppedWithHooks.id}: ${poppedWithHooks.data.type}`);
    }

    // Final queue statistics
    const finalStats = await queueManager.getQueueStats(queueId);
    console.log(`\n📊 Final Queue Stats: ${finalStats.itemCount} items total`);

    // Clean up
    await queueManager.deleteQueue(queueId);
    console.log('\n🧹 Cleaned up queue');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Graceful shutdown
    await queueManager.close();
    console.log('\n👋 Disconnected from Redis');
  }
}

// Run the example
if (require.main === module) {
  popOperationsExample().catch(console.error);
}

module.exports = popOperationsExample;

