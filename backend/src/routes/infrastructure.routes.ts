import { Router } from 'express';
import { InfrastructureController } from '../controllers/infrastructure.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { checkDiscoveryLimit } from '../middleware/subscription.middleware';

const router = Router();
const controller = new InfrastructureController();

router.get('/', authenticateToken, checkDiscoveryLimit, (req, res) => controller.getAll(req, res));
router.get('/costs', (req, res) => controller.getCosts(req, res));
router.post('/sync-aws', (req, res) => controller.syncAWS(req, res));
router.get('/:id', (req, res) => controller.getById(req, res));
router.post('/', (req, res) => controller.create(req, res));
router.delete('/:id', (req, res) => controller.delete(req, res));

export default router;
