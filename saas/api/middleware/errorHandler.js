/**
 * Error Handler Middleware
 * Centralized error handling for SaaS platform
 */

const { logger } = require('./logger');

/**
 * Global error handler
 */
const errorHandler = (error, req, res, next) => {
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.url,
    tenantId: req.tenantId,
    userId: req.user?.id
  });

  // Default error response
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details = null;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    details = error.details || error.message;
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (error.name === 'MongoError' && error.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
    details = 'Resource already exists';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Forbidden';
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Not Found';
  } else if (error.name === 'RateLimitError') {
    statusCode = 429;
    message = 'Rate limit exceeded';
  } else if (error.name === 'ResourceLimitError') {
    statusCode = 403;
    message = 'Resource limit exceeded';
  } else if (error.name === 'BillingError') {
    statusCode = 402;
    message = 'Payment required';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal Server Error';
    details = null;
  }

  const errorResponse = {
    error: message,
    timestamp: new Date().toISOString(),
    path: req.url,
    method: req.method
  };

  if (details) {
    errorResponse.details = details;
  }

  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * 404 handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Custom error classes
 */
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

class ResourceLimitError extends Error {
  constructor(message = 'Resource limit exceeded') {
    super(message);
    this.name = 'ResourceLimitError';
  }
}

class BillingError extends Error {
  constructor(message = 'Payment required') {
    super(message);
    this.name = 'BillingError';
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ResourceLimitError,
  BillingError
};
