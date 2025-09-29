/**
 * TypeScript type definitions for QueueManager
 */

import { EventEmitter } from 'events';
import { Redis } from 'ioredis';

// ============================================================================
// Core Configuration Types
// ============================================================================

export interface RedisConfig {
  host?: string;
  port?: number;
  password?: string | undefined;
  db?: number;
  retryDelayOnFailover?: number;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
  [key: string]: any;
}

export interface CacheConfig {
  enabled?: boolean;
  strategy?: 'write-through' | 'write-back';
  maxSize?: number;
  ttl?: number;
  syncInterval?: number;
}

export interface EventConfig {
  maxListeners?: number;
  enableAuditLog?: boolean;
  enableMetrics?: boolean;
  enableRateLimiting?: boolean;
  rateLimit?: {
    maxEventsPerSecond?: number;
    windowSizeMs?: number;
  };
}

export interface QueueManagerConfig {
  redis?: RedisConfig;
  cache?: CacheConfig;
  events?: EventConfig;
  [key: string]: any;
}

// ============================================================================
// Queue and Item Types
// ============================================================================

export interface QueueMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  version: string;
  description?: string;
  priority?: string;
  [key: string]: any;
}

export interface QueueItem {
  id: string;
  data: any;
  createdAt: string;
  updatedAt?: string;
  status?: string;
  priority?: number;
  retryCount?: number;
  worker?: string;
  processedAt?: string;
  completedAt?: string;
  failedAt?: string;
  lastError?: string;
  finalError?: string;
  nextRetryAt?: string;
  [key: string]: any;
}

export interface QueueStats {
  queue: {
    id: string;
    name: string;
    createdAt: string;
    itemCount: number;
    version: string;
  };
  items: {
    total: number;
    statusBreakdown: Record<string, number>;
    priorityBreakdown: Record<string, number>;
    ageDistribution: Record<string, number>;
  };
  performance: {
    cacheEnabled: boolean;
    cacheHitRate: number;
    lastUpdated: string;
  };
}

export interface CacheStats {
  enabled: boolean;
  strategy: string;
  stats: {
    queueCacheSize: number;
    itemsCacheSize: number;
    hitRate: number;
    pendingWrites: number;
  };
  performance: {
    totalOperations: number;
    errorRate: number;
    syncOperations: number;
  };
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  timestamp: string;
  redis?: {
    status: string;
    responseTime: number;
  };
  cache?: {
    status: string;
    hitRate: number;
  };
  memory?: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  error?: string;
}

// ============================================================================
// Operation Types
// ============================================================================

export interface AddToQueueOptions {
  actions?: {
    beforeAction?: HookFunction[];
    afterAction?: HookFunction[];
  };
  priority?: number;
  delay?: number;
  [key: string]: any;
}

export interface PopFromQueueOptions {
  timeout?: number;
  [key: string]: any;
}

export interface BatchOperationResult {
  successful: number;
  failed: number;
  errors: Array<{
    itemId?: string;
    item?: any;
    error: string;
  }>;
  addedItems?: QueueItem[];
}

export interface RequeueOptions {
  position?: 'head' | 'tail' | number;
  priority?: number;
  delay?: number;
  updateStatus?: boolean;
  newStatus?: string;
  retryCount?: boolean;
}

export interface MoveItemResult {
  success: boolean;
  originalItem?: QueueItem;
  newItem?: QueueItem;
  error?: string;
}

// ============================================================================
// Hook and Event Types
// ============================================================================

export interface HookContext {
  operation: string;
  queueId: string;
  timestamp: string;
  [key: string]: any;
}

export type HookFunction = (
  item: QueueItem | any,
  queueId: string,
  context: HookContext
) => Promise<void> | void;

export interface QueueEvent {
  eventType: string;
  queueId: string;
  item?: QueueItem;
  timestamp: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface QueueEventListener extends EventEmitter {
  on(event: 'change', listener: (event: QueueEvent) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

// ============================================================================
// Manager Interface Types
// ============================================================================

export interface RedisManagerInterface {
  connect(): Promise<void>;
  disconnect(timeout?: number): Promise<void>;
  healthCheck(): Promise<{ status: string; responseTime: number }>;
  multi(): Promise<any>;
  executePipeline(commands: Array<{ command: string; args: any[] }>): Promise<any[]>;
  exists(key: string): Promise<boolean>;
  hset(key: string, data: any): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<number>;
  lpop(key: string): Promise<string | null>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  client: Redis;
}

export interface CacheManagerInterface {
  config: CacheConfig;
  get(type: string, key: string): any;
  set(type: string, key: string, value: any): void;
  has(type: string, key: string): boolean;
  delete(type: string, key: string): boolean;
  getStats(): CacheStats;
  healthCheck(): { status: string; hitRate: number };
  forceSync(): Promise<void>;
  destroy(): Promise<void>;
}

export interface EventManagerInterface extends EventEmitter {
  getQueueEmitter(queueId: string): QueueEventListener;
  getGlobalEmitter(): EventEmitter;
  emit(event: string, data: any): boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
}

// ============================================================================
// Main QueueManager Interface
// ============================================================================

export interface QueueManagerInterface {
  // Configuration
  config: QueueManagerConfig;
  redis: RedisManagerInterface;
  cache: CacheManagerInterface;
  events: EventManagerInterface;
  redisClient: Redis;
  
  // Core methods
  waitForInitialization(): Promise<void>;
  close(options?: { timeout?: number; forceSyncCache?: boolean }): Promise<void>;
  
  // Queue operations
  createQueue(name: string, queueId: string, config?: Record<string, any>, options?: any): Promise<QueueMetadata>;
  getQueue(queueId: string): Promise<QueueMetadata>;
  getAllQueues(): Promise<QueueMetadata[]>;
  updateQueue(queueId: string, updates: Partial<QueueMetadata>): Promise<QueueMetadata>;
  deleteQueue(queueId: string): Promise<void>;
  queueExists(queueId: string): Promise<boolean>;
  getQueueNames(): Promise<string[]>;
  renameQueue(queueId: string, newName: string): Promise<void>;
  
  // Item operations
  addToQueue(queueId: string, item: any, options?: AddToQueueOptions): Promise<QueueItem>;
  updateItem(queueId: string, itemId: string, updates: Partial<QueueItem>): Promise<QueueItem>;
  deleteItemFromQueue(queueId: string, itemId: string): Promise<void>;
  getItem(queueId: string, itemId: string): Promise<QueueItem>;
  getQueueItems(queueId: string, options?: { filter?: (item: QueueItem) => boolean; sortBy?: string; sortOrder?: 'asc' | 'desc' }): Promise<QueueItem[]>;
  
  // Pop operations
  popFromQueue(queueId: string, options?: PopFromQueueOptions): Promise<QueueItem | null>;
  popBatchFromQueue(queueId: string, count?: number, options?: PopFromQueueOptions): Promise<QueueItem[]>;
  peekQueue(queueId: string, options?: any): Promise<QueueItem | null>;
  
  // Search operations
  findItem(queueId: string, predicate: (item: QueueItem) => boolean): Promise<QueueItem | null>;
  filterItems(queueId: string, predicate: (item: QueueItem) => boolean): Promise<QueueItem[]>;
  
  // Move operations
  requeueItem(queueId: string, itemId: string, options?: RequeueOptions): Promise<void>;
  moveItemBetweenQueues(sourceQueueId: string, targetQueueId: string, itemId: string): Promise<MoveItemResult>;
  
  // Batch operations
  bulkUpdateItemStatus(queueId: string, itemIds: string[], newStatus: string, options?: { batchSize?: number }): Promise<BatchOperationResult>;
  bulkDeleteItems(queueId: string, itemIds: string[], options?: { batchSize?: number }): Promise<BatchOperationResult>;
  bulkAddItems(queueId: string, items: any[], options?: any): Promise<BatchOperationResult>;
  
  // Statistics and monitoring
  getQueueStats(queueId: string): Promise<QueueStats>;
  getCacheStats(): CacheStats;
  healthCheck(): Promise<HealthCheck>;
  
  // Event operations
  listen(queueId: string): QueueEventListener | null;
  get eventEmitter(): EventEmitter;
  emit(eventName: string, data: any): void;
  on(eventName: string, callback: (...args: any[]) => void): void;
  off(eventName: string, callback: (...args: any[]) => void): void;
  removeAllListeners(eventName?: string): void;
}

// ============================================================================
// Factory Function Types
// ============================================================================

export type CreateQueueManagerFunction = (config?: QueueManagerConfig) => Promise<QueueManagerInterface>;

export interface CreateQueueManagerSyncResult {
  instance: QueueManagerInterface;
  waitForReady: () => Promise<void>;
}

export type CreateQueueManagerSyncFunction = (config?: QueueManagerConfig) => CreateQueueManagerSyncResult;

// ============================================================================
// Error Types
// ============================================================================

export class QueueManagerError extends Error {
  public code: string;
  public context: Record<string, any>;
  public timestamp: string;
  
  constructor(message: string, code: string = 'UNKNOWN_ERROR', context: Record<string, any> = {}) {
    super(message);
    this.name = 'QueueManagerError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

export class NotFoundError extends QueueManagerError {
  constructor(resource: string, id: string) {
    super(`${resource} with ID ${id} not found`, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends QueueManagerError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', { field });
    this.name = 'ValidationError';
  }
}

// ============================================================================
// Export all types
// ============================================================================

export * from './index';
