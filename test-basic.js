/**
 * Basic test of QueueManager advanced features
 */

const createQueueManager = require('./src/index');

async function testBasicFeatures() {
  console.log('🧪 Testing Basic QueueManager Features\n');

  try {
    // Initialize QueueManager
    const qm = await createQueueManager({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 0
      },
      cache: {
        enabled: true,
        strategy: 'write-through'
      }
    });

    console.log('✅ QueueManager initialized successfully');

    // Test 1: Create a queue
    console.log('\n📋 Test 1: Creating a queue...');
    const queueId = 'test-queue';
    await qm.createQueue('TestQueue', queueId, {
      description: 'Test queue for advanced features',
      maxSize: 1000
    });
    console.log('✅ Queue created successfully');

    // Test 2: Add a job
    console.log('\n⚡ Test 2: Adding a job...');
    const job = await qm.addToQueue(queueId, {
      task: 'test-task',
      data: 'Hello World'
    });
    console.log('✅ Job added successfully:', job.id);

    // Test 3: Get queue stats
    console.log('\n📊 Test 3: Getting queue statistics...');
    const stats = await qm.getQueueStats(queueId);
    console.log('✅ Queue stats:', {
      itemCount: stats.itemCount,
      ageInHours: stats.ageInHours
    });

    // Test 4: Pop a job
    console.log('\n🔄 Test 4: Popping a job...');
    const poppedJob = await qm.popFromQueue(queueId);
    console.log('✅ Job popped successfully:', poppedJob.id);

    // Test 5: System health
    console.log('\n🏥 Test 5: Checking system health...');
    const health = await qm.healthCheck();
    console.log('✅ System health:', health.status);

    // Test 6: System stats
    console.log('\n📈 Test 6: Getting system statistics...');
    const systemStats = await qm.getSystemStats();
    console.log('✅ System stats retrieved');

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await qm.deleteQueue(queueId);
    await qm.close();
    console.log('✅ Cleanup completed');

    console.log('\n🎉 All basic tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testBasicFeatures()
    .then(() => {
      console.log('\n✨ Basic test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Basic test failed:', error.message);
      process.exit(1);
    });
}

module.exports = testBasicFeatures;
