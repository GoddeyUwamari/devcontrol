import { Router } from 'express';
import { CostRecommendationsController } from '../controllers/cost-recommendations.controller';

const router = Router();
const controller = new CostRecommendationsController();

// Get all recommendations
router.get('/', (req, res) => controller.getAll(req, res));

// Get recommendation statistics
router.get('/stats', (req, res) => controller.getStats(req, res));

// Analyze AWS resources (create recommendations)
router.post('/analyze', (req, res) => controller.analyze(req, res));

// Get single recommendation by ID
router.get('/:id', (req, res) => controller.getById(req, res));

// Resolve recommendation
router.patch('/:id/resolve', (req, res) => controller.resolve(req, res));

// Dismiss recommendation
router.patch('/:id/dismiss', (req, res) => controller.dismiss(req, res));

// Delete recommendation
router.delete('/:id', (req, res) => controller.delete(req, res));

export default router;
