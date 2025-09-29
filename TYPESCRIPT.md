# TypeScript Support

QueueManager now has full TypeScript support while maintaining complete JavaScript compatibility. You can use the project in both JavaScript and TypeScript environments seamlessly.

## Features

- ✅ **Full Type Safety**: Complete type definitions for all classes, interfaces, and methods
- ✅ **IntelliSense Support**: Full autocomplete and IntelliSense in TypeScript editors
- ✅ **Runtime Compatibility**: Works with existing JavaScript code without changes
- ✅ **Flexible Configuration**: Type-safe configuration objects
- ✅ **Event System**: Typed event listeners and emitters
- ✅ **Error Handling**: Typed error classes and error handling

## Installation

The TypeScript types are included automatically when you install the package:

```bash
npm install re-queuejs
```

For development, you may want to install TypeScript and related tools:

```bash
npm install --save-dev typescript @types/node @types/ioredis ts-node
```

## Basic Usage

### TypeScript

```typescript
import { createQueueManager, QueueManagerInterface, QueueItem } from 're-queuejs';

interface TaskData {
  name: string;
  priority: number;
  category: string;
}

interface TaskItem extends QueueItem {
  data: TaskData;
}

async function example(): Promise<void> {
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

  // All methods are fully typed
  await queueManager.createQueue('My Queue', 'my-queue');
  
  const item = await queueManager.addToQueue('my-queue', {
    name: 'Task 1',
    priority: 10,
    category: 'urgent'
  });

  // Type-safe item access
  console.log(item.data.name); // TypeScript knows this is a string
  console.log(item.data.priority); // TypeScript knows this is a number
}
```

### JavaScript (Still Works!)

```javascript
const { createQueueManager } = require('re-queuejs');

async function example() {
  const queueManager = await createQueueManager({
    redis: { host: 'localhost', port: 6379 }
  });

  await queueManager.createQueue('My Queue', 'my-queue');
  const item = await queueManager.addToQueue('my-queue', { name: 'Task 1' });
  
  console.log(item.data.name); // Works exactly the same
}
```

## Type Definitions

### Core Types

```typescript
import type {
  QueueManagerInterface,
  QueueManagerConfig,
  QueueItem,
  QueueStats,
  HealthCheck,
  CacheStats,
  BatchOperationResult,
  RequeueOptions,
  MoveItemResult
} from 're-queuejs';
```

### Configuration Types

```typescript
interface QueueManagerConfig {
  redis?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    // ... more options
  };
  cache?: {
    enabled?: boolean;
    strategy?: 'write-through' | 'write-back';
    maxSize?: number;
    ttl?: number;
  };
  events?: {
    maxListeners?: number;
    enableAuditLog?: boolean;
    // ... more options
  };
}
```

### Item Types

```typescript
interface QueueItem {
  id: string;
  data: any;
  createdAt: string;
  updatedAt?: string;
  status?: string;
  priority?: number;
  retryCount?: number;
  // ... more properties
}
```

## Advanced Usage

### Custom Item Types

```typescript
interface EmailTask {
  to: string;
  subject: string;
  body: string;
  priority: number;
}

interface EmailQueueItem extends QueueItem {
  data: EmailTask;
}

// Use with type safety
const emailItem = await queueManager.addToQueue('emails', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Welcome to our service',
  priority: 5
}) as EmailQueueItem;
```

### Event Handling

```typescript
// Queue-specific events
const queueListener = queueManager.listen('my-queue');
if (queueListener) {
  queueListener.on('change', (event) => {
    // event is fully typed
    console.log(`Event: ${event.eventType} - ${event.queueId}`);
  });
}

// Global events
queueManager.eventEmitter.on('queueChange', (event) => {
  if (event.eventType.includes('error')) {
    console.log(`Error: ${event.error}`);
  }
});
```

### Batch Operations

```typescript
// Type-safe batch operations
const result: BatchOperationResult = await queueManager.bulkUpdateItemStatus(
  'my-queue',
  ['item1', 'item2', 'item3'],
  'processing'
);

console.log(`Updated ${result.successful} items`);
console.log(`Failed ${result.failed} items`);
```

## Examples

Check out the TypeScript examples in the `examples/` directory:

- `examples/basic-usage.ts` - Basic queue operations with TypeScript
- `examples/advanced-usage.ts` - Advanced features with hooks and events
- `examples/production-usage.ts` - Production worker implementation

## Development

### Building TypeScript

```bash
# Type check
npm run type-check

# Build TypeScript
npm run build

# Watch mode
npm run build:watch
```

### Running TypeScript Examples

```bash
# Run TypeScript examples
npx ts-node --transpile-only examples/basic-usage.ts
npx ts-node --transpile-only examples/advanced-usage.ts
```

## Migration from JavaScript

If you're migrating from JavaScript to TypeScript:

1. **No Code Changes Required**: Your existing JavaScript code will continue to work
2. **Add Type Annotations**: Gradually add type annotations for better type safety
3. **Use Interfaces**: Define interfaces for your data structures
4. **Enable Strict Mode**: Use TypeScript's strict mode for maximum type safety

### Before (JavaScript)

```javascript
const queueManager = await createQueueManager(config);
const item = await queueManager.addToQueue('queue', data);
console.log(item.data.name);
```

### After (TypeScript)

```typescript
const queueManager: QueueManagerInterface = await createQueueManager(config);
const item: QueueItem = await queueManager.addToQueue('queue', data);
console.log(item.data.name); // Fully typed!
```

## Type Safety Benefits

- **Compile-time Error Detection**: Catch errors before runtime
- **IntelliSense Support**: Better IDE experience with autocomplete
- **Refactoring Safety**: Safe renaming and refactoring across your codebase
- **Documentation**: Types serve as living documentation
- **Team Collaboration**: Better code understanding for team members

## Compatibility

- ✅ **Node.js**: 14+ (with TypeScript 4.5+)
- ✅ **JavaScript**: Full backward compatibility
- ✅ **TypeScript**: 4.5+ recommended
- ✅ **IDEs**: VS Code, WebStorm, etc.
- ✅ **Build Tools**: Webpack, Rollup, etc.

## Troubleshooting

### Common Issues

1. **Import Errors**: Make sure you're importing from the correct path
2. **Type Errors**: Check that your interfaces match the expected types
3. **Runtime Errors**: TypeScript types don't affect runtime behavior

### Getting Help

- Check the examples in the `examples/` directory
- Review the type definitions in `src/types/index.ts`
- Ensure your TypeScript configuration is correct

## Contributing

When contributing to the project:

1. **Maintain Type Safety**: Keep all type definitions up to date
2. **Test Both**: Test both JavaScript and TypeScript usage
3. **Document Types**: Add JSDoc comments for better IntelliSense
4. **Update Examples**: Keep TypeScript examples current

---

**QueueManager** - Now with full TypeScript support! 🚀
