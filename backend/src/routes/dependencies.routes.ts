import { Router } from 'express';
import { DependenciesController } from '../controllers/dependencies.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';

const router = Router();
const controller = new DependenciesController();

// All routes require authentication
router.use(authenticate);

// =====================================================
// READ ENDPOINTS (All authenticated users)
// =====================================================

// Get all dependencies with filters
router.get('/', controller.getAll.bind(controller));

// Get dependency graph (React Flow format)
router.get('/graph', controller.getGraph.bind(controller));

// Detect circular dependencies
router.get('/cycles', controller.detectCycles.bind(controller));

// Get impact analysis for a service
router.get('/impact/:serviceId', controller.getImpactAnalysis.bind(controller));

// Get dependency by ID
router.get('/:id', controller.getById.bind(controller));

// =====================================================
// WRITE ENDPOINTS (Admin+ only)
// =====================================================

// Create dependency
router.post('/', requireAdmin, controller.create.bind(controller));

// Update dependency
router.put('/:id', requireAdmin, controller.update.bind(controller));

// Delete dependency
router.delete('/:id', requireAdmin, controller.delete.bind(controller));

export default router;
