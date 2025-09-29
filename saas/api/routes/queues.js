/**
 * Queue Routes
 * Multi-tenant queue management endpoints
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { QueueService } = require('../../services/queue/QueueService');
const { logger } = require('../middleware/logger');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Queue:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         tenantId:
 *           type: string
 *         settings:
 *           type: object
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/v1/queues:
 *   get:
 *     summary: Get all queues for tenant
 *     tags: [Queues]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term
 *     responses:
 *       200:
 *         description: List of queues
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queues:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Queue'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 */
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().trim().escape()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { page = 1, limit = 20, search } = req.query;
    const queueService = new QueueService(req.tenantId);

    const result = await queueService.getQueues({
      page: parseInt(page),
      limit: parseInt(limit),
      search
    });

    res.json({
      queues: result.queues,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.total,
        pages: Math.ceil(result.total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Error getting queues:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve queues'
    });
  }
});

/**
 * @swagger
 * /api/v1/queues:
 *   post:
 *     summary: Create a new queue
 *     tags: [Queues]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Queue name
 *               description:
 *                 type: string
 *                 description: Queue description
 *               settings:
 *                 type: object
 *                 description: Queue settings
 *     responses:
 *       201:
 *         description: Queue created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Queue'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Resource limit exceeded
 */
router.post('/', [
  body('name').notEmpty().trim().isLength({ min: 1, max: 100 }).withMessage('Name is required and must be 1-100 characters'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('settings').optional().isObject().withMessage('Settings must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { name, description, settings = {} } = req.body;
    const queueService = new QueueService(req.tenantId);

    const queue = await queueService.createQueue({
      name,
      description,
      settings
    });

    res.status(201).json(queue);
  } catch (error) {
    logger.error('Error creating queue:', error);
    
    if (error.message.includes('limit')) {
      return res.status(403).json({
        error: 'Resource Limit Exceeded',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create queue'
    });
  }
});

/**
 * @swagger
 * /api/v1/queues/{id}:
 *   get:
 *     summary: Get queue by ID
 *     tags: [Queues]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Queue ID
 *     responses:
 *       200:
 *         description: Queue details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Queue'
 *       404:
 *         description: Queue not found
 */
router.get('/:id', [
  param('id').isMongoId().withMessage('Invalid queue ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const queueService = new QueueService(req.tenantId);

    const queue = await queueService.getQueue(id);
    if (!queue) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Queue not found'
      });
    }

    res.json(queue);
  } catch (error) {
    logger.error('Error getting queue:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve queue'
    });
  }
});

/**
 * @swagger
 * /api/v1/queues/{id}:
 *   put:
 *     summary: Update queue
 *     tags: [Queues]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Queue ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: Queue updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Queue'
 *       404:
 *         description: Queue not found
 */
router.put('/:id', [
  param('id').isMongoId().withMessage('Invalid queue ID'),
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('settings').optional().isObject().withMessage('Settings must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const { name, description, settings } = req.body;
    const queueService = new QueueService(req.tenantId);

    const queue = await queueService.updateQueue(id, {
      name,
      description,
      settings
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Queue not found'
      });
    }

    res.json(queue);
  } catch (error) {
    logger.error('Error updating queue:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update queue'
    });
  }
});

/**
 * @swagger
 * /api/v1/queues/{id}:
 *   delete:
 *     summary: Delete queue
 *     tags: [Queues]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Queue ID
 *     responses:
 *       204:
 *         description: Queue deleted successfully
 *       404:
 *         description: Queue not found
 */
router.delete('/:id', [
  param('id').isMongoId().withMessage('Invalid queue ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const queueService = new QueueService(req.tenantId);

    const deleted = await queueService.deleteQueue(id);
    if (!deleted) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Queue not found'
      });
    }

    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting queue:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete queue'
    });
  }
});

/**
 * @swagger
 * /api/v1/queues/{id}/stats:
 *   get:
 *     summary: Get queue statistics
 *     tags: [Queues]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Queue ID
 *     responses:
 *       200:
 *         description: Queue statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queueId:
 *                   type: string
 *                 items:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     pending:
 *                       type: integer
 *                     processing:
 *                       type: integer
 *                     completed:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *                 performance:
 *                   type: object
 *                   properties:
 *                     avgProcessingTime:
 *                       type: number
 *                     throughput:
 *                       type: number
 *       404:
 *         description: Queue not found
 */
router.get('/:id/stats', [
  param('id').isMongoId().withMessage('Invalid queue ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const queueService = new QueueService(req.tenantId);

    const stats = await queueService.getQueueStats(id);
    if (!stats) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Queue not found'
      });
    }

    res.json(stats);
  } catch (error) {
    logger.error('Error getting queue stats:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve queue statistics'
    });
  }
});

module.exports = router;
