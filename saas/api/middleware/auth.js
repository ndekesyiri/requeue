/**
 * Authentication Middleware
 * Handles JWT token validation and API key authentication
 */

const jwt = require('jsonwebtoken');
const { Tenant } = require('../models/Tenant');
const { User } = require('../models/User');
const { logger } = require('./logger');

/**
 * Authenticate JWT token
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user details
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token - user not found'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Account is deactivated'
      });
    }

    req.user = user;
    req.tenantId = user.tenantId;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token'
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};

/**
 * Authenticate API key
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required'
      });
    }

    // Find tenant by API key
    const tenant = await Tenant.findOne({ 
      apiKey: apiKey,
      isActive: true 
    });

    if (!tenant) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
    }

    // Check if tenant is within limits
    if (tenant.isSuspended) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Tenant account suspended'
      });
    }

    req.tenant = tenant;
    req.tenantId = tenant._id;
    next();
  } catch (error) {
    logger.error('API key authentication error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};

/**
 * Check user permissions
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!req.user.permissions || !req.user.permissions.includes(permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Permission '${permission}' required`
      });
    }

    next();
  };
};

/**
 * Check tenant permissions
 */
const requireTenantPermission = (permission) => {
  return (req, res, next) => {
    if (!req.tenant) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant authentication required'
      });
    }

    if (!req.tenant.permissions || !req.tenant.permissions.includes(permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Tenant permission '${permission}' required`
      });
    }

    next();
  };
};

/**
 * Optional authentication - doesn't fail if no auth provided
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (user && user.isActive) {
        req.user = user;
        req.tenantId = user.tenantId;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  authenticateToken,
  authenticateApiKey,
  requirePermission,
  requireTenantPermission,
  optionalAuth
};
