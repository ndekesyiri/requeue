/**
 * TypeScript declarations for QueueManager
 */

import { 
  QueueManagerInterface, 
  QueueManagerConfig, 
  CreateQueueManagerFunction, 
  CreateQueueManagerSyncFunction,
  CreateQueueManagerSyncResult
} from './types';

/**
 * Create a fully initialized QueueManager instance (async)
 * This is the recommended way to create a QueueManager
 */
export declare function createQueueManager(config?: QueueManagerConfig): Promise<QueueManagerInterface>;

/**
 * Create a QueueManager instance without waiting for initialization
 * Use this if you want to handle initialization manually
 */
export declare function createQueueManagerSync(config?: QueueManagerConfig): CreateQueueManagerSyncResult;

/**
 * Main QueueManager class
 */
export declare class QueueManager implements QueueManagerInterface {
  constructor(config?: QueueManagerConfig);
  static create(config?: QueueManagerConfig): Promise<QueueManagerInterface>;
}

/**
 * Export all types
 */
export * from './types';

/**
 * Export utilities and managers for advanced usage
 */
export declare const ValidationUtils: any;
export declare const QueueManager: typeof QueueManager;
