# ReQueue - Redis Queue Manager for nodejs

This repo contains a lightweight nodejs-based Queue manager.
Trust me on this, its just a single file. ReQueue is a high-performance, Redis-backed queue management system with intelligent caching, hooks, and real-time events. Built for workloads of any kind, seriously.

## Features

- **High Performance**: Multi-layer LRU caching with configurable strategies
- **Multiple Cache Strategies**: Write-through, write-back, and read-through caching
- **Advanced Hooks**: Before/after hooks for all operations with error handling
- **Real-time Events**: Queue change notifications and performance monitoring
- **Production Ready**: Graceful shutdown, health checks, and comprehensive error handling
- **Performance Monitoring**: Detailed metrics and statistics tracking
- **Batch Operations**: Efficient bulk operations for high-throughput scenarios
- **FIFO Queue Operations**: Peek, pop, and priority-based requeuing
- **Advanced Filtering**: Search and filter items with custom predicates
- **Zero Dependencies**: Only requires ioredis, uuid, and lru-cache

## 📦 Installation

```bash
npm install re-queue
```

## 🚀 Quick Start

```javascript
const QueueManager = require('re-queue');

// Initialize with configuration
const queueManager = QueueManager({
  redis: {
    host: 'localhost',
    port: 6379
  },
  cache: {
    enabled: true,
    strategy: 'write-through',
    maxSize: 10000
  }
});

// Create a queue
await queueManager.createQueue('task-queue', 'tasks', {
  description: 'Main task processing queue'
});

// Add items to queue, with configurations
const item = await queueManager.addToQueue('tasks', {
  type: 'email',
  recipient: 'user@example.com',
  subject: 'Welcome!'
});

// Process items
const nextItem = await queueManager.popFromQueue('tasks');
if (nextItem) {
  console.log('Processing:', nextItem.data);
  await queueManager.markItemStatus('tasks', nextItem.id, 'completed');
}

// Get queue statistics
const stats = await queueManager.getQueueStats('tasks');
console.log('Queue stats:', stats);
```

## 📚 Configuration

### Redis Configuration

```javascript
const queueManager = QueueManager({
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'your-password',
    db: 0,
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true
  }
});
```

### Cache Configuration

```javascript
const queueManager = QueueManager({
  cache: {
    enabled: true,
    strategy: 'write-through', // 'write-through' | 'write-back' | 'read-through'
    maxSize: 10000,             // Maximum number of items in cache
    ttl: 3600000,              // TTL in milliseconds (1 hour)
    syncInterval: 2000,        // Background sync interval for write-back
    batchSize: 100            // Batch size for operations
  }
});
```

## 🎯 Core Operations

### Queue Management

```javascript
// Create a queue
const queue = await queueManager.createQueue('processing', 'proc-001', {
  description: 'Data processing queue',
  priority: 'high'
});

// Get queue details
const queueInfo = await queueManager.getQueue('proc-001');

// Update queue
await queueManager.updateQueue('proc-001', {
  description: 'Updated description'
});

// Delete queue
await queueManager.deleteQueue('proc-001');

// Get all queues
const allQueues = await queueManager.getAllQueues();
```

### Item Operations

```javascript
// Add item with hooks
const item = await queueManager.addToQueue('proc-001', {
  task: 'process-data',
  priority: 1
}, {
  actions: {
    beforeAction: [(item) => console.log('Adding:', item.id)],
    afterAction: [(item) => console.log('Added:', item.id)]
  }
});

// Get specific item
const item = await queueManager.getItem('proc-001', 'item-id');

// Update item
await queueManager.updateItem('proc-001', 'item-id', {
  status: 'processing',
  progress: 50
});

// Delete item
await queueManager.deleteItemFromQueue('proc-001', 'item-id');

// Get queue items (with pagination)
const items = await queueManager.getQueueItems('proc-001', 0, 10);
```

### Queue Navigation

```javascript
// Peek at next items without removing
const nextItem = await queueManager.peekQueue('proc-001');
const next5Items = await queueManager.peekQueue('proc-001', 5);

// Pop items (FIFO)
const item = await queueManager.popFromQueue('proc-001');

// Flush all items
await queueManager.flushQueue('proc-001');
```

### Advanced Operations

```javascript
// Search items
const foundItem = await queueManager.findItem('proc-001', 
  item => item.data.priority > 5
);

// Filter items
const highPriorityItems = await queueManager.filterItems('proc-001',
  item => item.data.priority === 'high'
);

// Count items by status
const statusCounts = await queueManager.countItemsByStatus('proc-001');

// Requeue with priority
await queueManager.requeueItem('proc-001', 'item-id', {
  position: 'head',
  priority: 10,
  updateStatus: true,
  newStatus: 'pending'
});

// Move item between queues
await queueManager.moveItemBetweenQueues('source-queue', 'target-queue', 'item-id');

// Bulk status update
await queueManager.bulkUpdateItemStatus('proc-001', ['id1', 'id2'], 'completed');
```

## 🎣 Hooks System

Run, Execute custom logic before/after operations:

```javascript
const hooks = {
  beforeAction: [
    async (item, queueId, context) => {
      console.log(`Before ${context.operation}:`, item.id);
      // Validation, logging, of as simple as sending and email etc.
    }
  ],
  afterAction: [
    async (item, queueId, context) => {
      console.log(`After ${context.operation}:`, item.id);
      // Notifications, cleanup, you get the point.
    }
  ]
};

await queueManager.addToQueue('proc-001', data, { actions: hooks });
```

## 📊 Events & Monitoring

### Real-time Events

```javascript
// Listen to global events
queueManager.eventEmitter.on('queueChange', (event) => {
  console.log('Queue change:', event);
});

// Listen to specific queue
const queueListener = queueManager.listen('proc-001');
queueListener.on('change', (event) => {
  switch(event.eventType) {
    case 'item:added':
      console.log('Item added:', event.item);
      break;
    case 'item:completed':
      console.log('Item completed:', event.item);
      break;
  }
});
```

### Performance Monitoring

```javascript
// Get cache statistics
const cacheStats = queueManager.getCacheStats();
console.log('Cache hit rate:', cacheStats.stats.hitRate);

// Get detailed queue statistics
const queueStats = await queueManager.getQueueStats('proc-001');
console.log('Average processing time:', queueStats.items.avgProcessingTime);

// Health check
const health = await queueManager.healthCheck();
console.log('System health:', health.status);
```

## 🔄 Batch Operations

Process multiple operations at a go, efficiently:

```javascript
const operations = [
  { type: 'addToQueue', queueId: 'proc-001', item: { task: 'task1' } },
  { type: 'updateItem', queueId: 'proc-001', itemId: 'id1', updates: { status: 'done' } },
  { type: 'deleteItem', queueId: 'proc-001', itemId: 'id2' }
];

const result = await queueManager.batchOperations(operations, {
  batchSize: 50
});

console.log(`${result.successful} operations completed, ${result.failed} failed`);
```

## 🛡️ Production Considerations

### Graceful Shutdown

```javascript
// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await queueManager.close({
    timeout: 30000,
    forceSyncCache: true
  });
  process.exit(0);
});
```

### Error Handling

```javascript
try {
  await queueManager.addToQueue('proc-001', data);
} catch (error) {
  console.error('Operation failed:', error.message);
  // Handle error appropriately
}
```

### Health Monitoring

```javascript
// Periodic health checks
setInterval(async () => {
  const health = await queueManager.healthCheck();
  if (health.status !== 'healthy') {
    console.error('Queue manager unhealthy:', health);
    // Alert monitoring system
  }
}, 30000);
```

## ⚡ Performance Tips

1. **Cache Strategy**: Use the `write-through` for consistency, `write-back` for performance, your choice, depending on the project
2. **Batch Size**: Tune `batchSize` based on your Redis latency and through-put needs
3. **Cache Size**: Set `maxSize` based on available memory and working set size within your process scope
4. **Connection Pooling**: Enable `enableAutoPipelining` for better Redis performance
5. **Monitoring**: Regularly check cache hit rates and adjust configuration just to keep up to speed with the flow


## What you need

- Node.js >= 14.0.0
- Redis >= 6.0.0

## Somebody with thee time:

- Carry out a benchmark test for the thrill of it 

## 🔗 Related Projects

- [ioredis](https://github.com/luin/ioredis) - Redis client
- [lru-cache](https://github.com/isaacs/node-lru-cache) - LRU cache implementation

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [ioredis](https://github.com/luin/ioredis) for Redis connectivity
- Uses [lru-cache](https://github.com/isaacs/node-lru-cache) for intelligent caching

---

**Made during vac 🥸**