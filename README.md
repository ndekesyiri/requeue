# ReQueue - Redis-Powered Queue Management

A lightweight, high-performance Node.js queue management system built on Redis with advanced caching, event-driven architecture, and TypeScript support.

[Website](https://ndekesyiri.github.io/requeue/)

## Features

- **Redis-Powered**: Built on Redis for high performance and reliability
- **Advanced Caching**: LRU cache with write-through/write-back strategies
- **Event-Driven**: Comprehensive event system with hooks and listeners
- **TypeScript Support**: Full type definitions and IntelliSense support
- **Multi-Queue Management**: Create, manage, and monitor multiple queues
- **Batch Operations**: Efficient bulk operations for high throughput
- **Performance Monitoring**: Built-in metrics and health checks
- **Enterprise Ready**: Production-ready with error handling and logging
- **Real-time Dashboard**: Web interface for monitoring and management

## Installation

```bash
npm install re-queuejs
```

## Dashboard

For a real-time web interface to monitor and manage your queues, install the separate ReQueue Dashboard package:

```bash
# Install globally
npm install -g requeue-dashboard

# Create new dashboard project
requeue-dashboard create my-dashboard

# Start dashboard
cd my-dashboard
npm start
```

The dashboard provides:
- **Real-time Monitoring**: Live statistics and queue status
- **Web Interface**: Create, manage, and monitor queues
- **WebSocket Updates**: Instant notifications for all events
- **Progressive Web App**: Offline capability and mobile support
- **Security Features**: Authentication and rate limiting

[View Dashboard Documentation](https://github.com/ndekesyiri/requeue-dashboard) | [NPM Package](https://www.npmjs.com/package/requeue-dashboard)

## Quick Start

### Basic Usage

```javascript
const { createQueueManager } = require('re-queuejs');

async function main() {
  // Create queue manager
  const queueManager = await createQueueManager({
    redis: {
      host: 'localhost',
      port: 6379
    }
  });

  // Create a queue
  await queueManager.createQueue('Email Queue', 'email-queue');

  // Add items to queue
  await queueManager.addToQueue('email-queue', {
    to: 'user@example.com',
    subject: 'Welcome!',
    body: 'Welcome to our service'
  });

  // Process items
  const item = await queueManager.popFromQueue('email-queue');
  console.log('Processing:', item.data);

  // Mark as completed
  await queueManager.updateItemStatus('email-queue', item.id, 'completed');
}
```

### TypeScript Usage

```typescript
import { createQueueManager, QueueManagerInterface } from 're-queuejs';

interface EmailData {
  to: string;
  subject: string;
  body: string;
}

async function main(): Promise<void> {
  const queueManager: QueueManagerInterface = await createQueueManager({
    redis: {
      host: 'localhost',
      port: 6379
    }
  });

  // Type-safe operations
  await queueManager.createQueue('Email Queue', 'email-queue');
  
  const emailData: EmailData = {
    to: 'user@example.com',
    subject: 'Welcome!',
    body: 'Welcome to our service'
  };

  await queueManager.addToQueue('email-queue', emailData);
}
```

## Architecture

### Core Components

- **QueueManager**: Main orchestrator managing queues and operations
- **RedisManager**: Redis connection and command execution
- **CacheManager**: LRU cache with synchronization strategies
- **EventManager**: Event-driven architecture with hooks
- **Operations**: Modular operation handlers (CRUD, batch, monitoring)

### Caching Strategies

- **Write-Through**: Immediate Redis sync for consistency
- **Write-Back**: Batched sync for performance
- **LRU Eviction**: Automatic cache management
- **Cache Invalidation**: Smart invalidation strategies

## Performance

- **High Throughput**: Process thousands of items per second
- **Low Latency**: Sub-millisecond cache operations
- **Memory Efficient**: Smart caching with automatic eviction
- **Scalable**: Horizontal scaling with Redis clustering

## Configuration

```javascript
const queueManager = await createQueueManager({
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'your-password',
    db: 0
  },
  cache: {
    enabled: true,
    maxSize: 1000,
    strategy: 'write-back',
    syncInterval: 5000
  },
  events: {
    enabled: true,
    globalEvents: true
  }
});
```

## API Reference

### Queue Operations
- `createQueue(name, id, options)` - Create a new queue
- `getQueue(id)` - Get queue information
- `updateQueue(id, updates)` - Update queue settings
- `deleteQueue(id)` - Delete a queue

### Item Operations
- `addToQueue(queueId, data, options)` - Add item to queue
- `popFromQueue(queueId)` - Pop single item
- `popBatchFromQueue(queueId, count)` - Pop multiple items
- `updateItemStatus(queueId, itemId, status)` - Update item status

### Batch Operations
- `bulkAddItems(queueId, items)` - Add multiple items
- `bulkUpdateItemStatus(queueId, updates)` - Update multiple items
- `bulkDeleteItems(queueId, itemIds)` - Delete multiple items

### Monitoring
- `getQueueStats(queueId)` - Get queue statistics
- `getCacheStats()` - Get cache performance
- `healthCheck()` - System health check

## Events & Hooks

### Event Types
- `item:added` - Item added to queue
- `item:popped` - Item popped from queue
- `item:updated` - Item status updated
- `queue:created` - Queue created
- `queue:deleted` - Queue deleted

### Hook System
```javascript
// Before hooks
queueManager.on('before:addToQueue', (context) => {
  console.log('Adding item:', context.item);
});

// After hooks
queueManager.on('after:addToQueue', (context) => {
  console.log('Item added:', context.item.id);
});
```


## Examples

Check the `/usage` folder for comprehensive examples:

- **Basic Usage**: Simple queue operations
- **Advanced Features**: Events, hooks, batch operations
- **Production Usage**: Real-world worker implementation
- **TypeScript Examples**: Type-safe implementations

## Development

### Prerequisites
- Node.js 18+
- Redis 6+
- TypeScript (optional)

### Setup
```bash
git clone https://github.com/ndekesyiri/requeue.git
cd requeue
npm install
```

### Testing
```bash
npm test
```

### Building
```bash
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

- **Issues**: [GitHub Issues](https://github.com/ndekesyiri/requeue/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ndekesyiri/requeue/discussions)
- **Email**: ndekesyiri@outlook.com

## Show Your Support

Give a star if this project helped you!

---

**Built with ❤️ by [ndekesyiri](https://github.com/ndekesyiri)**