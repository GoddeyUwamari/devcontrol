import { Router } from 'express';
import { CostRecommendationsController } from '../controllers/cost-recommendations.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new CostRecommendationsController();

// Get all recommendations
router.get('/', authenticateToken, (req, res) => controller.getAll(req, res));

// Get recommendation statistics
router.get('/stats', authenticateToken, (req, res) => controller.getStats(req, res));

// Analyze AWS resources (create recommendations)
router.post('/analyze', authenticateToken, (req, res) => controller.analyze(req, res));

// Get single recommendation by ID
router.get('/:id', authenticateToken, (req, res) => controller.getById(req, res));

// Resolve recommendation
router.patch('/:id/resolve', authenticateToken, (req, res) => controller.resolve(req, res));

// Dismiss recommendation
router.patch('/:id/dismiss', authenticateToken, (req, res) => controller.dismiss(req, res));

// Delete recommendation
router.delete('/:id', authenticateToken, (req, res) => controller.delete(req, res));

export default router;
