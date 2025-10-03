/**
 * Advanced QueueManager Features Example
 * Demonstrates all the new advanced features implemented
 */

const createQueueManager = require('../src/index');

async function demonstrateAdvancedFeatures() {
  console.log(' Advanced QueueManager Features Demo\n');

  // Initialize QueueManager with advanced configuration
  const qm = await createQueueManager({
    redis: {
      host: 'localhost',
      port: 6379,
      db: 0
    },
    cache: {
      enabled: true,
      strategy: 'write-through',
      maxSize: 1000,
      ttl: 300000 // 5 minutes
    },
    events: {
      maxListeners: 100
    }
  });

  try {
    // 1. DELAYED JOBS & SCHEDULING
    console.log('📅 1. Delayed Jobs & Scheduling');
    console.log('================================');
    
    const queueId = 'advanced-demo-queue';
    await qm.createQueue('AdvancedDemoQueue', queueId, {
      description: 'Queue for demonstrating advanced features',
      maxSize: 10000
    });

    // Schedule a job to run in 5 seconds
    const scheduledJob = await qm.scheduleJob(queueId, {
      task: 'send-email',
      recipient: 'user@example.com',
      subject: 'Welcome!'
    }, new Date(Date.now() + 5000), {
      priority: 5,
      retryPolicy: {
        maxRetries: 3,
        retryDelay: 1000,
        backoffMultiplier: 2
      }
    });

    console.log(` Scheduled job: ${scheduledJob.id}`);
    console.log(`   Execution time: ${new Date(scheduledJob.scheduledFor).toISOString()}`);

    // Get scheduled jobs
    const scheduledJobs = await qm.getScheduledJobs(queueId);
    console.log(` Found ${scheduledJobs.jobs.length} scheduled jobs\n`);

    // 2. RETRY POLICY & FAILURE HANDLING
    console.log('🔄 2. Retry Policy & Failure Handling');
    console.log('=====================================');

    // Configure retry policy
    const retryPolicy = {
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
      maxRetryDelay: 10000,
      retryOn: ['Error', 'TimeoutError'],
      onRetry: (error, attempt, delay) => {
        console.log(`   🔄 Retry attempt ${attempt} after ${delay}ms: ${error.message}`);
      },
      onMaxRetries: (error, retryTracking) => {
        console.log(`    Max retries reached: ${error.message}`);
      }
    };

    // Simulate a job that might fail
    const failingJobProcessor = async (data) => {
      if (Math.random() < 0.7) { // 70% chance of failure
        throw new Error('Simulated processing error');
      }
      return { success: true, processed: data };
    };

    try {
      const retryResult = await qm.executeWithRetry(
        queueId,
        { task: 'process-payment', amount: 100 },
        retryPolicy,
        failingJobProcessor
      );
      console.log(` Job completed successfully:`, retryResult.result);
    } catch (error) {
      console.log(` Job failed after retries: ${error.message}`);
    }

    // Get retry statistics
    const retryStats = await qm.getRetryStats(queueId);
    console.log(` Retry stats: ${retryStats.successfulJobs}/${retryStats.totalJobs} successful\n`);

    // 3. DEAD LETTER QUEUES
    console.log('💀 3. Dead Letter Queues');
    console.log('========================');

    // Create dead letter queue
    const dlq = await qm.createDeadLetterQueue(queueId, {
      maxSize: 1000,
      retentionDays: 30,
      autoCleanup: true
    });
    console.log(` Created DLQ: ${dlq.id}`);

    // Simulate routing a failed job to DLQ
    const failedJob = {
      id: 'failed-job-123',
      data: { task: 'failed-operation' }
    };

    await qm.routeToDeadLetterQueue(queueId, failedJob, {
      message: 'Max retries exceeded',
      type: 'RetryError'
    }, {
      reason: 'max_retries_exceeded'
    });

    // Get DLQ items
    const dlqItems = await qm.getDeadLetterItems(dlq.id);
    console.log(` DLQ contains ${dlqItems.items.length} failed jobs\n`);

    // 4. PRIORITY QUEUES
    console.log(' 4. Priority Queues');
    console.log('====================');

    // Add jobs with different priorities
    const highPriorityJob = await qm.addToQueueWithPriority(queueId, {
      task: 'urgent-notification',
      message: 'System maintenance in 5 minutes'
    }, 10, { // High priority
      priorityWeight: 2
    });

    const lowPriorityJob = await qm.addToQueueWithPriority(queueId, {
      task: 'cleanup-logs',
      path: '/var/logs'
    }, 1, { // Low priority
      priorityWeight: 1
    });

    const mediumPriorityJob = await qm.addToQueueWithPriority(queueId, {
      task: 'send-report',
      recipient: 'manager@company.com'
    }, 5, { // Medium priority
      priorityWeight: 1
    });

    console.log(` Added jobs with priorities: 10, 1, 5`);

    // Get jobs sorted by priority
    const priorityJobs = await qm.getQueueItemsByPriority(queueId, {
      sortOrder: 'desc',
      limit: 10
    });

    console.log(` Jobs by priority:`);
    priorityJobs.items.forEach((job, index) => {
      console.log(`   ${index + 1}. Priority ${job.priority}: ${job.data.task}`);
    });

    // Get priority statistics
    const priorityStats = await qm.getPriorityStats(queueId);
    console.log(` Priority distribution:`, priorityStats.priorityDistribution);
    console.log('');

    // 5. JOB DEPENDENCIES & CHAINING
    console.log('🔗 5. Job Dependencies & Chaining');
    console.log('===================================');

    // Create a workflow with dependencies
    const workflowJobs = [
      { id: 'job-1', data: { task: 'validate-input' } },
      { id: 'job-2', data: { task: 'process-data' } },
      { id: 'job-3', data: { task: 'send-notification' } }
    ];

    // Add jobs with dependencies
    const job1 = await qm.addJobWithDependencies(queueId, workflowJobs[0].data, [], {
      jobId: workflowJobs[0].id
    });

    const job2 = await qm.addJobWithDependencies(queueId, workflowJobs[1].data, [workflowJobs[0].id], {
      jobId: workflowJobs[1].id
    });

    const job3 = await qm.addJobWithDependencies(queueId, workflowJobs[2].data, [workflowJobs[1].id], {
      jobId: workflowJobs[2].id
    });

    console.log(` Created workflow: ${job1.id} → ${job2.id} → ${job3.id}`);

    // Mark first job as completed
    await qm.markJobCompleted(queueId, job1.id, {
      result: { validated: true, records: 100 }
    });

    // Get dependency graph
    const dependencyGraph = await qm.getDependencyGraph(queueId);
    console.log(` Dependency graph: ${dependencyGraph.nodes.length} nodes, ${dependencyGraph.edges.length} edges`);
    console.log('');

    // 6. QUEUE CONTROL (PAUSE/RESUME)
    console.log('⏸️ 6. Queue Control');
    console.log('===================');

    // Pause the queue
    await qm.pauseQueue(queueId, {
      reason: 'Maintenance window',
      pauseScheduledJobs: true
    });
    console.log(`⏸️ Queue paused`);

    // Try to add a job (should still work, but processing is paused)
    await qm.addToQueue(queueId, { task: 'paused-job' });
    console.log(`📝 Added job to paused queue`);

    // Resume the queue
    await qm.resumeQueue(queueId);
    console.log(`▶️ Queue resumed`);

    // Get queue control status
    const controlStatus = await qm.getQueueControlStatus(queueId);
    console.log(` Queue status: ${controlStatus.paused ? 'Paused' : 'Active'}`);
    console.log('');

    // 7. JOB TIMEOUTS
    console.log('⏰ 7. Job Timeouts');
    console.log('==================');

    // Add job with timeout
    const timeoutJob = await qm.addJobWithTimeout(queueId, {
      task: 'long-running-operation',
      duration: 30000
    }, 5000, { // 5 second timeout
      priority: 8
    });

    console.log(` Added job with 5s timeout: ${timeoutJob.id}`);

    // Simulate job execution with timeout
    const timeoutProcessor = async (data) => {
      console.log(`   🔄 Processing job: ${data.task}`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second operation
      return { success: true };
    };

    try {
      await qm.executeJobWithTimeout(queueId, timeoutJob.id, timeoutProcessor);
    } catch (error) {
      console.log(`⏰ Job timed out: ${error.message}`);
    }

    // Check for timed out jobs
    const timedOutJobs = await qm.checkTimedOutJobs(queueId);
    console.log(` Found ${timedOutJobs.timedOut.length} timed out jobs`);
    console.log('');

    // 8. RATE LIMITING
    console.log('🚦 8. Rate Limiting');
    console.log('===================');

    // Configure rate limiting
    await qm.configureRateLimit(queueId, {
      maxJobsPerSecond: 5,
      maxJobsPerMinute: 100,
      maxConcurrentJobs: 10,
      enabled: true
    });

    console.log(` Configured rate limiting: 5/sec, 100/min, 10 concurrent`);

    // Simulate rapid job additions
    const rapidJobs = [];
    for (let i = 0; i < 20; i++) {
      try {
        const rateLimitCheck = await qm.checkRateLimit(queueId);
        if (rateLimitCheck.allowed) {
          const job = await qm.addToQueue(queueId, { task: `rapid-job-${i}` });
          await qm.recordJobExecution(queueId, job.id);
          rapidJobs.push(job.id);
        } else {
          console.log(`🚦 Rate limit hit: ${rateLimitCheck.reason}`);
          break;
        }
      } catch (error) {
        console.log(` Rate limit exceeded: ${error.message}`);
        break;
      }
    }

    console.log(` Added ${rapidJobs.length} jobs before hitting rate limit`);

    // Get rate limit statistics
    const rateLimitStats = await qm.getRateLimitStats(queueId);
    console.log(` Rate limit stats:`, {
      currentRate: rateLimitStats.current.currentRate,
      concurrentJobs: rateLimitStats.current.concurrentJobs,
      utilizationRate: rateLimitStats.current.utilizationRate
    });
    console.log('');

    // 9. DATA VALIDATION
    console.log(' 9. Data Validation');
    console.log('======================');

    // Configure schema validation
    const schema = {
      type: 'object',
      required: ['task', 'priority'],
      properties: {
        task: { type: 'string', minLength: 1 },
        priority: { type: 'number', minimum: 1, maximum: 10 },
        data: { type: 'object' }
      },
      additionalProperties: false
    };

    await qm.configureSchemaValidation(queueId, {
      schema,
      strictMode: true,
      validateOnAdd: true,
      errorHandling: 'reject'
    });

    console.log(` Configured schema validation`);

    // Try to add valid job
    try {
      const validJob = await qm.addJobWithValidation(queueId, {
        task: 'valid-task',
        priority: 5,
        data: { userId: 123 }
      });
      console.log(` Valid job added: ${validJob.id}`);
    } catch (error) {
      console.log(` Validation failed: ${error.message}`);
    }

    // Try to add invalid job
    try {
      const invalidJob = await qm.addJobWithValidation(queueId, {
        task: '', // Invalid: empty string
        priority: 15, // Invalid: exceeds maximum
        extraField: 'not-allowed' // Invalid: additional property
      });
    } catch (error) {
      console.log(` Invalid job rejected: ${error.message}`);
    }

    // Get validation statistics
    const validationStats = await qm.getValidationStats(queueId);
    console.log(` Validation stats: ${validationStats.successRate}% success rate`);
    console.log('');

    // 10. AUDIT TRAIL
    console.log('📝 10. Audit Trail');
    console.log('==================');

    // Configure audit trail
    await qm.configureAuditTrail(queueId, {
      enabled: true,
      logLevel: 'info',
      retentionDays: 7,
      logEvents: [
        'job:added',
        'job:completed',
        'job:failed',
        'queue:paused',
        'queue:resumed'
      ],
      includeData: true,
      includeMetadata: true
    });

    console.log(` Configured audit trail`);

    // Perform some operations to generate audit logs
    await qm.addToQueue(queueId, { task: 'audit-test' });
    await qm.pauseQueue(queueId, { reason: 'Audit test' });
    await qm.resumeQueue(queueId);

    // Get audit logs
    const auditLogs = await qm.getAuditLogs(queueId, { limit: 10 });
    console.log(` Found ${auditLogs.logs.length} audit log entries`);

    // Get audit statistics
    const auditStats = await qm.getAuditStats(queueId);
    console.log(` Audit stats:`, {
      totalLogs: auditStats.totalLogs,
      eventTypes: Object.keys(auditStats.eventTypeDistribution).length,
      timeDistribution: Object.keys(auditStats.timeDistribution).length
    });

    // Export audit logs
    const auditExport = await qm.exportAuditLogs(queueId, {
      format: 'json',
      includeData: true
    });
    console.log(`📤 Exported ${auditExport.data.length} audit log entries`);
    console.log('');

    // 11. COMPREHENSIVE STATISTICS
    console.log(' 11. Comprehensive Statistics');
    console.log('===============================');

    // Get system-wide statistics
    const systemStats = await qm.getSystemStats();
    console.log(`🏥 System health:`, {
      redis: systemStats.redis.status,
      cache: systemStats.cache.hits,
      performance: systemStats.performance.totalOperations,
      uptime: Math.round(systemStats.system.uptime)
    });

    // Get queue statistics
    const queueStats = await qm.getQueueStats(queueId);
    console.log(` Queue stats:`, {
      itemCount: queueStats.itemCount,
      ageInHours: queueStats.ageInHours,
      recentActivity: queueStats.recentActivity.itemsAddedLastHour
    });

    // Get all advanced statistics
    const allStats = {
      retry: await qm.getRetryStats(queueId),
      priority: await qm.getPriorityStats(queueId),
      rateLimit: await qm.getRateLimitStats(queueId),
      validation: await qm.getValidationStats(queueId),
      audit: await qm.getAuditStats(queueId)
    };

    console.log(` Advanced features summary:`);
    console.log(`   - Retry success rate: ${allStats.retry.successRate}%`);
    console.log(`   - Priority levels: ${allStats.priority.priorityLevels.length}`);
    console.log(`   - Rate limit utilization: ${allStats.rateLimit.current.utilizationRate}%`);
    console.log(`   - Validation success rate: ${allStats.validation.successRate}%`);
    console.log(`   - Audit log entries: ${allStats.audit.totalLogs}`);

    console.log('\n Advanced features demonstration completed!');

  } catch (error) {
    console.error(' Error during demonstration:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await qm.clearQueue(queueId);
    await qm.deleteQueue(queueId);
    await qm.close();
    console.log(' Cleanup completed');
  }
}

// Run the demonstration
if (require.main === module) {
  demonstrateAdvancedFeatures()
    .then(() => {
      console.log('\n✨ Demo completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n Demo failed:', error.message);
      process.exit(1);
    });
}

module.exports = demonstrateAdvancedFeatures;

