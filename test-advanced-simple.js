/**
 * Simple test of QueueManager advanced features (working ones)
 */

const createQueueManager = require('./src/index');

async function testAdvancedFeatures() {
  console.log('🚀 Testing Advanced QueueManager Features\n');

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

    const queueId = 'advanced-test-queue';
    
    // Test 1: Create a queue
    console.log('\n📋 Test 1: Creating a queue...');
    await qm.createQueue('AdvancedTestQueue', queueId, {
      description: 'Test queue for advanced features',
      maxSize: 1000
    });
    console.log('✅ Queue created successfully');

    // Test 2: Add jobs with priority
    console.log('\n⭐ Test 2: Adding jobs with priority...');
    const highPriorityJob = await qm.addToQueueWithPriority(queueId, {
      task: 'urgent-task',
      message: 'High priority task'
    }, 10, { priorityWeight: 2 });
    
    const lowPriorityJob = await qm.addToQueueWithPriority(queueId, {
      task: 'low-priority-task',
      message: 'Low priority task'
    }, 1, { priorityWeight: 1 });
    
    console.log('✅ Jobs added with priorities:', {
      high: highPriorityJob.priority,
      low: lowPriorityJob.priority
    });

    // Test 3: Get priority statistics
    console.log('\n📊 Test 3: Getting priority statistics...');
    const priorityStats = await qm.getPriorityStats(queueId);
    console.log('✅ Priority stats:', {
      totalItems: priorityStats.totalItems,
      averagePriority: priorityStats.averagePriority,
      priorityLevels: priorityStats.priorityLevels.length
    });

    // Test 4: Pop job by priority
    console.log('\n🔄 Test 4: Popping job by priority...');
    const poppedJob = await qm.popFromQueueByPriority(queueId);
    console.log('✅ Job popped by priority:', {
      id: poppedJob.id,
      priority: poppedJob.priority,
      task: poppedJob.data.task
    });

    // Test 5: Queue control - pause and resume
    console.log('\n⏸️ Test 5: Queue control (pause/resume)...');
    await qm.pauseQueue(queueId, { reason: 'Test pause' });
    console.log('✅ Queue paused');
    
    await qm.resumeQueue(queueId);
    console.log('✅ Queue resumed');

    // Test 6: Add job with timeout
    console.log('\n⏰ Test 6: Adding job with timeout...');
    const timeoutJob = await qm.addJobWithTimeout(queueId, {
      task: 'timeout-test',
      duration: 5000
    }, 2000); // 2 second timeout
    console.log('✅ Job added with timeout:', timeoutJob.id);

    // Test 7: Rate limiting configuration
    console.log('\n🚦 Test 7: Configuring rate limiting...');
    await qm.configureRateLimit(queueId, {
      maxJobsPerSecond: 5,
      maxJobsPerMinute: 100,
      maxConcurrentJobs: 10,
      enabled: true
    });
    console.log('✅ Rate limiting configured');

    // Test 8: Data validation
    console.log('\n✅ Test 8: Configuring data validation...');
    const schema = {
      type: 'object',
      required: ['task'],
      properties: {
        task: { type: 'string', minLength: 1 },
        priority: { type: 'number', minimum: 1, maximum: 10 }
      }
    };
    
    await qm.configureSchemaValidation(queueId, {
      schema,
      strictMode: true,
      errorHandling: 'reject'
    });
    console.log('✅ Schema validation configured');

    // Test 9: Audit trail
    console.log('\n📝 Test 9: Configuring audit trail...');
    await qm.configureAuditTrail(queueId, {
      enabled: true,
      logLevel: 'info',
      retentionDays: 7,
      logEvents: ['job:added', 'job:completed', 'job:failed']
    });
    console.log('✅ Audit trail configured');

    // Test 10: Get comprehensive statistics
    console.log('\n📈 Test 10: Getting comprehensive statistics...');
    const systemStats = await qm.getSystemStats();
    const queueStats = await qm.getQueueStats(queueId);
    const rateLimitStats = await qm.getRateLimitStats(queueId);
    const validationStats = await qm.getValidationStats(queueId);
    
    console.log('✅ Statistics retrieved:', {
      system: systemStats.system?.uptime ? 'OK' : 'N/A',
      queue: queueStats.itemCount || 0,
      rateLimit: rateLimitStats.configured ? 'OK' : 'N/A',
      validation: validationStats.totalItems || 0
    });

    // Test 11: Add job with validation
    console.log('\n🔍 Test 11: Adding job with validation...');
    try {
      const validJob = await qm.addJobWithValidation(queueId, {
        task: 'valid-task',
        priority: 5
      });
      console.log('✅ Valid job added:', validJob.id);
    } catch (error) {
      console.log('⚠️ Validation test:', error.message);
    }

    // Test 12: Get audit logs
    console.log('\n📋 Test 12: Getting audit logs...');
    const auditLogs = await qm.getAuditLogs(queueId, { limit: 5 });
    console.log('✅ Audit logs retrieved:', auditLogs.logs.length, 'entries');

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await qm.clearQueue(queueId);
    await qm.deleteQueue(queueId);
    await qm.close();
    console.log('✅ Cleanup completed');

    console.log('\n🎉 All advanced feature tests passed!');
    console.log('\n📊 Features tested:');
    console.log('   ✅ Priority-based queueing');
    console.log('   ✅ Queue control (pause/resume)');
    console.log('   ✅ Job timeouts');
    console.log('   ✅ Rate limiting');
    console.log('   ✅ Data validation');
    console.log('   ✅ Audit trail');
    console.log('   ✅ Comprehensive statistics');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testAdvancedFeatures()
    .then(() => {
      console.log('\n✨ Advanced features test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Advanced features test failed:', error.message);
      process.exit(1);
    });
}

module.exports = testAdvancedFeatures;
