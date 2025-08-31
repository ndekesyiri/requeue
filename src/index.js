const QueueManager = require('./core/QueueManager');
const ValidationUtils = require('./utils/ValidationUtils');

/**
 * Create a fully initialized QueueManager instance (async)
 * This is the recommended way to create a QueueManager
 */
async function createQueueManager(config = {}) {
  // Validate configuration
  if (config.cache && config.cache.strategy) {
    ValidationUtils.validateCacheStrategy(config.cache.strategy);
  }
  
  if (config.redis) {
    ValidationUtils.validateRedisConfig(config.redis);
  }
  
  // Create and wait for initialization
  return await QueueManager.create(config);
}

/**
 * Create a QueueManager instance without waiting for initialization
 * Use this if you want to handle initialization manually
 */
function createQueueManagerSync(config = {}) {
  // Validate configuration
  if (config.cache && config.cache.strategy) {
    ValidationUtils.validateCacheStrategy(config.cache.strategy);
  }
  
  if (config.redis) {
    ValidationUtils.validateRedisConfig(config.redis);
  }
  
  const queueManager = new QueueManager(config);
  
  return {
    instance: queueManager,
    waitForReady: () => queueManager.waitForInitialization()
  };
}

module.exports = createQueueManager;

// Also export utilities and managers for advanced usage
module.exports.QueueManager = QueueManager;
module.exports.ValidationUtils = ValidationUtils;
module.exports.createQueueManagerSync = createQueueManagerSync;