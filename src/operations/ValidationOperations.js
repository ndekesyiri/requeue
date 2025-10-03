/**
 * Data validation and schema operations
 */
const { v4: uuidv4 } = require('uuid');
const ValidationUtils = require('../utils/ValidationUtils');

const ValidationOperations = {
  /**
   * Configure schema validation for a queue
   * @param {string} queueId - Queue ID
   * @param {Object} schemaConfig - Schema configuration
   */
  async configureSchemaValidation(queueId, schemaConfig) {
    ValidationUtils.validateQueueId(queueId);

    const {
      schema = null,
      strictMode = false,
      validateOnAdd = true,
      validateOnUpdate = true,
      customValidators = [],
      errorHandling = 'reject', // 'reject', 'warn', 'ignore'
      enabled = true
    } = schemaConfig;

    try {
      // Execute before hooks
      if (schemaConfig.actions?.beforeAction) {
        await this._executeHooks(
          schemaConfig.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, schemaConfig },
          'configureSchemaValidation'
        );
      }

      // Verify queue exists
      await this._getQueueFromCacheOrRedis(queueId);

      // Validate schema if provided
      if (schema) {
        await this._validateSchemaDefinition(schema);
      }

      const config = {
        enabled,
        schema: schema ? JSON.stringify(schema) : null,
        strictMode,
        validateOnAdd,
        validateOnUpdate,
        customValidators: JSON.stringify(customValidators),
        errorHandling,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store schema configuration
      const schemaKey = `${this.QUEUE_PREFIX}schema:${queueId}`;
      await this.redis.hset(schemaKey, config);

      // Execute after hooks
      if (schemaConfig.actions?.afterAction) {
        await this._executeHooks(
          schemaConfig.actions.afterAction,
          'afterAction',
          queueId,
          config,
          'configureSchemaValidation'
        );
      }

      // Emit schema configuration event
      this._emitQueueEvent(queueId, 'schema:configured', {
        queueId,
        config: {
          ...config,
          schema: schema,
          customValidators: customValidators
        }
      });

      return {
        ...config,
        schema: schema,
        customValidators: customValidators
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'configureSchemaValidation', { queueId, schemaConfig });
    }
  },

  /**
   * Validate schema definition
   * @private
   */
  async _validateSchemaDefinition(schema) {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be a valid object');
    }

    // Basic schema validation
    if (schema.type && !['object', 'array', 'string', 'number', 'boolean'].includes(schema.type)) {
      throw new Error('Schema type must be one of: object, array, string, number, boolean');
    }

    // Validate required fields if present
    if (schema.required && !Array.isArray(schema.required)) {
      throw new Error('Schema required field must be an array');
    }

    // Validate properties if present
    if (schema.properties && typeof schema.properties !== 'object') {
      throw new Error('Schema properties must be an object');
    }

    // Additional validation can be added here for more complex schemas
  },

  /**
   * Validate job data against schema
   * @param {string} queueId - Queue ID
   * @param {Object} jobData - Job data to validate
   * @param {Object} options - Validation options
   */
  async validateJobData(queueId, jobData, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      operation = 'add', // 'add', 'update'
      strictMode = null,
      customValidators = null
    } = options;

    try {
      // Get schema configuration
      const schemaKey = `${this.QUEUE_PREFIX}schema:${queueId}`;
      const config = await this.redis.hgetall(schemaKey);

      if (Object.keys(config).length === 0 || config.enabled !== 'true') {
        return { valid: true, reason: 'No schema validation configured' };
      }

      const schema = config.schema ? JSON.parse(config.schema) : null;
      const useStrictMode = strictMode !== null ? strictMode : config.strictMode === 'true';
      const validators = customValidators || JSON.parse(config.customValidators || '[]');

      if (!schema) {
        return { valid: true, reason: 'No schema defined' };
      }

      // Perform schema validation
      const validationResult = await this._performSchemaValidation(jobData, schema, useStrictMode);

      // Perform custom validations
      const customValidationResult = await this._performCustomValidations(jobData, validators, queueId);

      // Combine results
      const isValid = validationResult.valid && customValidationResult.valid;
      const errors = [...validationResult.errors, ...customValidationResult.errors];

      return {
        valid: isValid,
        errors: errors,
        warnings: [...validationResult.warnings, ...customValidationResult.warnings],
        schema: schema,
        validatedAt: new Date().toISOString()
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'validateJobData', { queueId, jobData, options });
    }
  },

  /**
   * Perform schema validation
   * @private
   */
  async _performSchemaValidation(data, schema, strictMode) {
    const errors = [];
    const warnings = [];

    try {
      // Type validation
      if (schema.type) {
        const dataType = Array.isArray(data) ? 'array' : typeof data;
        if (dataType !== schema.type) {
          if (strictMode) {
            errors.push(`Expected type ${schema.type}, got ${dataType}`);
          } else {
            warnings.push(`Type mismatch: expected ${schema.type}, got ${dataType}`);
          }
        }
      }

      // Required fields validation
      if (schema.required && Array.isArray(schema.required)) {
        for (const field of schema.required) {
          if (!(field in data)) {
            errors.push(`Required field '${field}' is missing`);
          }
        }
      }

      // Properties validation
      if (schema.properties && typeof data === 'object' && !Array.isArray(data)) {
        for (const [field, fieldSchema] of Object.entries(schema.properties)) {
          if (field in data) {
            const fieldValidation = await this._validateField(data[field], fieldSchema, field);
            errors.push(...fieldValidation.errors);
            warnings.push(...fieldValidation.warnings);
          }
        }
      }

      // Additional properties validation
      if (schema.additionalProperties === false && typeof data === 'object') {
        const allowedFields = schema.required || [];
        const schemaFields = schema.properties ? Object.keys(schema.properties) : [];
        const allAllowedFields = [...allowedFields, ...schemaFields];
        
        for (const field of Object.keys(data)) {
          if (!allAllowedFields.includes(field)) {
            if (strictMode) {
              errors.push(`Additional property '${field}' is not allowed`);
            } else {
              warnings.push(`Additional property '${field}' is not in schema`);
            }
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings
      };

    } catch (error) {
      return {
        valid: false,
        errors: [`Schema validation error: ${error.message}`],
        warnings: []
      };
    }
  },

  /**
   * Validate a single field
   * @private
   */
  async _validateField(value, fieldSchema, fieldName) {
    const errors = [];
    const warnings = [];

    // Type validation
    if (fieldSchema.type) {
      const valueType = Array.isArray(value) ? 'array' : typeof value;
      if (valueType !== fieldSchema.type) {
        errors.push(`Field '${fieldName}' expected type ${fieldSchema.type}, got ${valueType}`);
      }
    }

    // String validations
    if (fieldSchema.type === 'string') {
      if (fieldSchema.minLength && value.length < fieldSchema.minLength) {
        errors.push(`Field '${fieldName}' must be at least ${fieldSchema.minLength} characters`);
      }
      if (fieldSchema.maxLength && value.length > fieldSchema.maxLength) {
        errors.push(`Field '${fieldName}' must be at most ${fieldSchema.maxLength} characters`);
      }
      if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
        errors.push(`Field '${fieldName}' does not match required pattern`);
      }
    }

    // Number validations
    if (fieldSchema.type === 'number') {
      if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
        errors.push(`Field '${fieldName}' must be at least ${fieldSchema.minimum}`);
      }
      if (fieldSchema.maximum !== undefined && value > fieldSchema.maximum) {
        errors.push(`Field '${fieldName}' must be at most ${fieldSchema.maximum}`);
      }
    }

    // Array validations
    if (fieldSchema.type === 'array') {
      if (fieldSchema.minItems && value.length < fieldSchema.minItems) {
        errors.push(`Field '${fieldName}' must have at least ${fieldSchema.minItems} items`);
      }
      if (fieldSchema.maxItems && value.length > fieldSchema.maxItems) {
        errors.push(`Field '${fieldName}' must have at most ${fieldSchema.maxItems} items`);
      }
    }

    return { errors, warnings };
  },

  /**
   * Perform custom validations
   * @private
   */
  async _performCustomValidations(data, validators, queueId) {
    const errors = [];
    const warnings = [];

    for (const validator of validators) {
      try {
        if (typeof validator.validate === 'function') {
          const result = await validator.validate(data, { queueId });
          
          if (!result.valid) {
            if (validator.severity === 'error') {
              errors.push(...result.errors);
            } else {
              warnings.push(...result.errors);
            }
          }
        }
      } catch (error) {
        errors.push(`Custom validator error: ${error.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  },

  /**
   * Add job with validation
   * @param {string} queueId - Queue ID
   * @param {Object} jobData - Job data
   * @param {Object} options - Job options
   */
  async addJobWithValidation(queueId, jobData, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (jobData === undefined || jobData === null) {
      throw new Error('Job data cannot be null or undefined');
    }

    try {
      // Validate job data
      const validationResult = await this.validateJobData(queueId, jobData, {
        operation: 'add',
        ...options
      });

      // Handle validation result based on error handling mode
      const schemaKey = `${this.QUEUE_PREFIX}schema:${queueId}`;
      const config = await this.redis.hgetall(schemaKey);
      const errorHandling = config.errorHandling || 'reject';

      if (!validationResult.valid) {
        switch (errorHandling) {
          case 'reject':
            throw new Error(`Job data validation failed: ${validationResult.errors.join(', ')}`);
          case 'warn':
            console.warn(`QueueManager: Job data validation warnings for queue ${queueId}:`, validationResult.errors);
            break;
          case 'ignore':
            // Continue with validation errors
            break;
        }
      }

      // Add job using standard method
      const result = await this.addToQueue(queueId, jobData, options);

      // Add validation metadata
      if (validationResult.valid || errorHandling !== 'reject') {
        await this.updateItem(queueId, result.id, {
          validationResult: {
            valid: validationResult.valid,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
            validatedAt: validationResult.validatedAt
          }
        });
      }

      return {
        ...result,
        validation: validationResult
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'addJobWithValidation', { queueId, jobData, options });
    }
  },

  /**
   * Update job with validation
   * @param {string} queueId - Queue ID
   * @param {string} itemId - Item ID
   * @param {Object} updates - Updates to apply
   * @param {Object} options - Update options
   */
  async updateJobWithValidation(queueId, itemId, updates, options = {}) {
    ValidationUtils.validateQueueId(queueId);
    
    if (!itemId || typeof itemId !== 'string') {
      throw new Error('Item ID must be a non-empty string');
    }

    try {
      // Get current job data
      const currentJob = await this.getItem(queueId, itemId);
      const updatedData = { ...currentJob.data, ...updates };

      // Validate updated data
      const validationResult = await this.validateJobData(queueId, updatedData, {
        operation: 'update',
        ...options
      });

      // Handle validation result
      const schemaKey = `${this.QUEUE_PREFIX}schema:${queueId}`;
      const config = await this.redis.hgetall(schemaKey);
      const errorHandling = config.errorHandling || 'reject';

      if (!validationResult.valid && errorHandling === 'reject') {
        throw new Error(`Job data validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Update job using standard method
      const result = await this.updateItem(queueId, itemId, updates, options);

      // Add validation metadata
      await this.updateItem(queueId, itemId, {
        validationResult: {
          valid: validationResult.valid,
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          validatedAt: validationResult.validatedAt
        }
      });

      return {
        ...result,
        validation: validationResult
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'updateJobWithValidation', { queueId, itemId, updates, options });
    }
  },

  /**
   * Get schema configuration
   * @param {string} queueId - Queue ID
   */
  async getSchemaConfiguration(queueId) {
    ValidationUtils.validateQueueId(queueId);

    try {
      const schemaKey = `${this.QUEUE_PREFIX}schema:${queueId}`;
      const config = await this.redis.hgetall(schemaKey);

      if (Object.keys(config).length === 0) {
        return null;
      }

      return {
        ...config,
        schema: config.schema ? JSON.parse(config.schema) : null,
        customValidators: JSON.parse(config.customValidators || '[]'),
        enabled: config.enabled === 'true',
        strictMode: config.strictMode === 'true',
        validateOnAdd: config.validateOnAdd === 'true',
        validateOnUpdate: config.validateOnUpdate === 'true'
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getSchemaConfiguration', { queueId });
    }
  },

  /**
   * Get validation statistics
   * @param {string} queueId - Queue ID
   * @param {Object} options - Query options
   */
  async getValidationStats(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    const {
      fromTime = null,
      toTime = null,
      limit = 1000
    } = options;

    try {
      // Get all items
      const items = await this._getQueueItemsFromCacheOrRedis(queueId);
      
      // Filter by time range if specified
      let filteredItems = items;
      if (fromTime || toTime) {
        filteredItems = items.filter(item => {
          const itemTime = new Date(item.addedAt).getTime();
          if (fromTime && itemTime < fromTime.getTime()) return false;
          if (toTime && itemTime > toTime.getTime()) return false;
          return true;
        });
      }

      // Apply limit
      filteredItems = filteredItems.slice(0, limit);

      // Calculate validation statistics
      const totalItems = filteredItems.length;
      const validatedItems = filteredItems.filter(item => item.validationResult);
      const validItems = validatedItems.filter(item => item.validationResult.valid);
      const invalidItems = validatedItems.filter(item => !item.validationResult.valid);

      // Error analysis
      const errorCounts = {};
      const warningCounts = {};
      
      validatedItems.forEach(item => {
        if (item.validationResult.errors) {
          item.validationResult.errors.forEach(error => {
            const errorType = error.split(':')[0] || 'Unknown';
            errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
          });
        }
        
        if (item.validationResult.warnings) {
          item.validationResult.warnings.forEach(warning => {
            const warningType = warning.split(':')[0] || 'Unknown';
            warningCounts[warningType] = (warningCounts[warningType] || 0) + 1;
          });
        }
      });

      return {
        totalItems,
        validatedItems: validatedItems.length,
        validItems: validItems.length,
        invalidItems: invalidItems.length,
        validationRate: totalItems > 0 ? (validatedItems.length / totalItems) * 100 : 0,
        successRate: validatedItems.length > 0 ? (validItems.length / validatedItems.length) * 100 : 0,
        errorCounts,
        warningCounts,
        timeRange: {
          from: fromTime?.toISOString(),
          to: toTime?.toISOString()
        }
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'getValidationStats', { queueId, options });
    }
  },

  /**
   * Disable schema validation
   * @param {string} queueId - Queue ID
   * @param {Object} options - Disable options
   */
  async disableSchemaValidation(queueId, options = {}) {
    ValidationUtils.validateQueueId(queueId);

    try {
      // Execute before hooks
      if (options.actions?.beforeAction) {
        await this._executeHooks(
          options.actions.beforeAction,
          'beforeAction',
          queueId,
          { queueId, options },
          'disableSchemaValidation'
        );
      }

      const schemaKey = `${this.QUEUE_PREFIX}schema:${queueId}`;
      
      // Update configuration
      await this.redis.hset(schemaKey, {
        enabled: 'false',
        disabledAt: new Date().toISOString(),
        disabledBy: options.disabledBy || 'system',
        reason: options.reason || 'Manual disable'
      });

      // Execute after hooks
      if (options.actions?.afterAction) {
        await this._executeHooks(
          options.actions.afterAction,
          'afterAction',
          queueId,
          { disabledAt: new Date().toISOString() },
          'disableSchemaValidation'
        );
      }

      // Emit disable event
      this._emitQueueEvent(queueId, 'schema:disabled', {
        queueId,
        disabledAt: new Date().toISOString(),
        reason: options.reason
      });

      return {
        disabled: true,
        disabledAt: new Date().toISOString(),
        reason: options.reason
      };

    } catch (error) {
      throw this.errorHandlers.handleError(error, 'disableSchemaValidation', { queueId, options });
    }
  }
};

module.exports = ValidationOperations;

