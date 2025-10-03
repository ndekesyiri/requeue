# Advanced QueueManager Features

This document describes the advanced features that have been added to the QueueManager system, transforming it from a basic queue management tool into a comprehensive job processing platform.

## 🚀 New Features Overview

### 1. Delayed Jobs & Scheduling
**Purpose**: Schedule jobs to run at specific times in the future.

**Key Features**:
- Schedule jobs with precise timing using Redis sorted sets
- Support for one-time and recurring schedules
- Automatic job execution when due time is reached
- Job rescheduling and cancellation capabilities

**Usage**:
```javascript
// Schedule a job to run in 1 hour
const scheduledJob = await qm.scheduleJob('my-queue', {
  task: 'send-reminder',
  userId: 123
}, new Date(Date.now() + 3600000), {
  priority: 5,
  retryPolicy: { maxRetries: 3 }
});

// Get scheduled jobs
const scheduledJobs = await qm.getScheduledJobs('my-queue');

// Cancel a scheduled job
await qm.cancelScheduledJob('my-queue', scheduledJob.id);
```

### 2. Retry Policy & Failure Handling
**Purpose**: Automatically retry failed jobs with configurable policies.

**Key Features**:
- Exponential backoff with configurable parameters
- Custom retry conditions and error handling
- Retry history tracking and statistics
- Integration with dead letter queues

**Usage**:
```javascript
const retryPolicy = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
  maxRetryDelay: 30000,
  retryOn: ['Error', 'TimeoutError'],
  onRetry: (error, attempt, delay) => console.log(`Retry ${attempt}: ${error.message}`)
};

const result = await qm.executeWithRetry('my-queue', jobData, retryPolicy, jobProcessor);
```

### 3. Dead Letter Queues (DLQ)
**Purpose**: Handle jobs that repeatedly fail or cannot be processed.

**Key Features**:
- Automatic routing of failed jobs to DLQ
- DLQ management and monitoring
- Job replay capabilities
- Configurable retention policies

**Usage**:
```javascript
// Create a dead letter queue
const dlq = await qm.createDeadLetterQueue('my-queue', {
  maxSize: 10000,
  retentionDays: 30
});

// Route failed job to DLQ
await qm.routeToDeadLetterQueue('my-queue', failedJob, errorInfo);

// Get DLQ items
const dlqItems = await qm.getDeadLetterItems(dlq.id);

// Replay a DLQ item
await qm.replayDeadLetterItem(dlq.id, itemId, {
  targetQueueId: 'my-queue',
  modifyData: { retryCount: 0 }
});
```

### 4. Priority-Based Queueing
**Purpose**: Process jobs based on priority levels for better resource allocation.

**Key Features**:
- Multiple priority levels (1-10 scale)
- Weighted priority processing
- Dynamic priority updates
- Priority-based statistics

**Usage**:
```javascript
// Add job with high priority
await qm.addToQueueWithPriority('my-queue', jobData, 10, {
  priorityWeight: 2
});

// Pop highest priority job
const highPriorityJob = await qm.popFromQueueByPriority('my-queue');

// Update job priority
await qm.updateItemPriority('my-queue', jobId, 8);

// Get priority statistics
const priorityStats = await qm.getPriorityStats('my-queue');
```

### 5. Job Dependencies & Chaining
**Purpose**: Create workflows where jobs depend on the completion of other jobs.

**Key Features**:
- Job dependency tracking
- Automatic workflow progression
- Dependency failure handling
- Workflow visualization

**Usage**:
```javascript
// Create job with dependencies
const job1 = await qm.addJobWithDependencies('my-queue', jobData1, []);
const job2 = await qm.addJobWithDependencies('my-queue', jobData2, [job1.id]);
const job3 = await qm.addJobWithDependencies('my-queue', jobData3, [job2.id]);

// Mark job as completed (triggers dependent jobs)
await qm.markJobCompleted('my-queue', job1.id, { result: 'success' });

// Get dependency graph
const graph = await qm.getDependencyGraph('my-queue');
```

### 6. Queue Control Operations
**Purpose**: Manage queue lifecycle with pause, resume, and batch operations.

**Key Features**:
- Queue pausing and resuming
- Batch job cancellation
- Emergency stop capabilities
- Queue control status monitoring

**Usage**:
```javascript
// Pause queue
await qm.pauseQueue('my-queue', {
  reason: 'Maintenance window',
  pauseScheduledJobs: true
});

// Resume queue
await qm.resumeQueue('my-queue');

// Cancel multiple jobs
await qm.cancelJobs('my-queue', [jobId1, jobId2, jobId3]);

// Emergency stop all queues
await qm.emergencyStop({ reason: 'System overload' });
```

### 7. Job Timeout Handling
**Purpose**: Automatically handle jobs that take too long to complete.

**Key Features**:
- Per-job timeout configuration
- Automatic timeout detection
- Timeout statistics and monitoring
- Timeout extension capabilities

**Usage**:
```javascript
// Add job with timeout
const timeoutJob = await qm.addJobWithTimeout('my-queue', jobData, 30000); // 30 seconds

// Execute job with timeout monitoring
await qm.executeJobWithTimeout('my-queue', jobId, jobProcessor);

// Check for timed out jobs
const timedOutJobs = await qm.checkTimedOutJobs('my-queue');

// Extend job timeout
await qm.extendJobTimeout('my-queue', jobId, 10000); // Add 10 seconds
```

### 8. Rate Limiting & Concurrency Control
**Purpose**: Control job processing rates to prevent system overload.

**Key Features**:
- Multiple rate limit types (per second, minute, hour, day)
- Concurrent job limits
- Burst handling
- Rate limit statistics

**Usage**:
```javascript
// Configure rate limiting
await qm.configureRateLimit('my-queue', {
  maxJobsPerSecond: 10,
  maxJobsPerMinute: 500,
  maxConcurrentJobs: 5,
  enabled: true
});

// Check rate limit before processing
const canProcess = await qm.checkRateLimit('my-queue');

// Record job execution
await qm.recordJobExecution('my-queue', jobId);
await qm.recordJobCompletion('my-queue', jobId);
```

### 9. Data Validation & Schema Support
**Purpose**: Ensure job data conforms to expected formats and business rules.

**Key Features**:
- JSON Schema validation
- Custom validators
- Validation error handling
- Validation statistics

**Usage**:
```javascript
// Configure schema validation
const schema = {
  type: 'object',
  required: ['task', 'priority'],
  properties: {
    task: { type: 'string', minLength: 1 },
    priority: { type: 'number', minimum: 1, maximum: 10 }
  }
};

await qm.configureSchemaValidation('my-queue', {
  schema,
  strictMode: true,
  errorHandling: 'reject'
});

// Add job with validation
const validatedJob = await qm.addJobWithValidation('my-queue', jobData);
```

### 10. Audit Trail & History
**Purpose**: Track all queue operations for debugging and compliance.

**Key Features**:
- Comprehensive event logging
- Configurable log levels and retention
- Search and export capabilities
- Audit statistics

**Usage**:
```javascript
// Configure audit trail
await qm.configureAuditTrail('my-queue', {
  enabled: true,
  logLevel: 'info',
  retentionDays: 30,
  logEvents: ['job:added', 'job:completed', 'job:failed']
});

// Get audit logs
const auditLogs = await qm.getAuditLogs('my-queue', {
  fromTime: new Date('2024-01-01'),
  toTime: new Date('2024-01-31')
});

// Export audit logs
const exportData = await qm.exportAuditLogs('my-queue', {
  format: 'json',
  includeData: true
});
```

## 🔧 Configuration Examples

### Complete Advanced Configuration
```javascript
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
    ttl: 300000
  },
  events: {
    maxListeners: 100
  }
});

// Configure all advanced features
await qm.configureRateLimit('my-queue', {
  maxJobsPerSecond: 10,
  maxJobsPerMinute: 500,
  maxConcurrentJobs: 5
});

await qm.configureSchemaValidation('my-queue', {
  schema: mySchema,
  strictMode: true
});

await qm.configureAuditTrail('my-queue', {
  enabled: true,
  logLevel: 'info',
  retentionDays: 30
});
```

## 📊 Monitoring & Statistics

### System Health Monitoring
```javascript
// Get comprehensive system statistics
const systemStats = await qm.getSystemStats();
console.log('System Health:', {
  redis: systemStats.redis.status,
  cache: systemStats.cache.hits,
  performance: systemStats.performance.totalOperations
});

// Get queue-specific statistics
const queueStats = await qm.getQueueStats('my-queue');
const retryStats = await qm.getRetryStats('my-queue');
const priorityStats = await qm.getPriorityStats('my-queue');
const rateLimitStats = await qm.getRateLimitStats('my-queue');
const auditStats = await qm.getAuditStats('my-queue');
```

## 🚀 Performance Considerations

### Best Practices
1. **Use appropriate cache strategies** for your workload
2. **Configure rate limits** to prevent system overload
3. **Set up monitoring** with audit trails and statistics
4. **Use priority queues** for better resource allocation
5. **Implement proper error handling** with retry policies and DLQs

### Performance Tuning
```javascript
// Optimize for high-throughput scenarios
const qm = await createQueueManager({
  cache: {
    enabled: true,
    strategy: 'write-back', // Better for high write loads
    maxSize: 10000,
    ttl: 60000
  },
  redis: {
    host: 'localhost',
    port: 6379,
    db: 0,
    lazyConnect: true,
    maxRetriesPerRequest: 3
  }
});
```

## 🔍 Troubleshooting

### Common Issues
1. **Memory usage**: Monitor cache size and Redis memory
2. **Rate limiting**: Adjust limits based on system capacity
3. **Timeout issues**: Configure appropriate timeouts for your jobs
4. **Dead letter queues**: Monitor DLQ size and replay failed jobs

### Debugging Tools
```javascript
// Get detailed statistics
const stats = await qm.getSystemStats();
const queueStats = await qm.getQueueStats('my-queue');
const auditLogs = await qm.getAuditLogs('my-queue', { limit: 100 });

// Check for issues
const timedOutJobs = await qm.checkTimedOutJobs('my-queue');
const dlqItems = await qm.getDeadLetterItems('my-queue-dlq');
```

## 📚 Examples

See the `examples/advanced-features-example.js` file for a comprehensive demonstration of all advanced features working together.

## 🔄 Migration Guide

### From Basic to Advanced
1. **Start with scheduling**: Add delayed job capabilities
2. **Implement retry policies**: Handle failures gracefully
3. **Add priority support**: Optimize job processing order
4. **Configure monitoring**: Set up audit trails and statistics
5. **Implement validation**: Ensure data quality

### Gradual Feature Adoption
```javascript
// Phase 1: Basic advanced features
await qm.configureRateLimit('my-queue', { maxJobsPerSecond: 10 });
await qm.configureAuditTrail('my-queue', { enabled: true });

// Phase 2: Advanced workflow features
await qm.configureSchemaValidation('my-queue', { schema: mySchema });
await qm.createDeadLetterQueue('my-queue', { maxSize: 1000 });

// Phase 3: Full feature set
// All advanced features enabled and configured
```

This advanced feature set transforms the QueueManager into a production-ready job processing platform suitable for enterprise applications with complex workflow requirements.

