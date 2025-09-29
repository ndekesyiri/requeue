/**
 * ReQueue SaaS - Production API Server
 * Multi-tenant, scalable queue management platform
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('express-async-errors');
require('dotenv').config();

const { logger } = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');
const { rateLimitMiddleware } = require('./middleware/rateLimit');
const { metricsMiddleware } = require('./middleware/metrics');

// Route imports
const authRoutes = require('./routes/auth');
const queueRoutes = require('./routes/queues');
const itemRoutes = require('./routes/items');
const tenantRoutes = require('./routes/tenants');
const billingRoutes = require('./routes/billing');
const monitoringRoutes = require('./routes/monitoring');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-API-Key']
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(logger);

// Metrics collection
app.use(metricsMiddleware);

// Global rate limiting
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalRateLimit);

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API documentation
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ReQueue SaaS API',
      version: '1.0.0',
      description: 'Production-ready queue management platform',
      contact: {
        name: 'ReQueue Support',
        email: 'support@requeue.com',
        url: 'https://requeue.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: 'ReQueue SaaS API Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        }
      }
    }
  },
  apis: ['./api/routes/*.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/queues', authMiddleware, tenantMiddleware, rateLimitMiddleware, queueRoutes);
app.use('/api/v1/items', authMiddleware, tenantMiddleware, rateLimitMiddleware, itemRoutes);
app.use('/api/v1/tenants', authMiddleware, tenantRoutes);
app.use('/api/v1/billing', authMiddleware, billingRoutes);
app.use('/api/v1/monitoring', authMiddleware, monitoringRoutes);
app.use('/api/v1/webhooks', authMiddleware, webhookRoutes);

// Dashboard routes (if serving from same server)
if (process.env.SERVE_DASHBOARD === 'true') {
  app.use('/dashboard', express.static('dashboard/frontend/dist'));
  app.get('/dashboard/*', (req, res) => {
    res.sendFile('dashboard/frontend/dist/index.html', { root: '.' });
  });
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info(`ReQueue SaaS API Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`API Documentation: http://localhost:${PORT}/api-docs`);
});

module.exports = app;
