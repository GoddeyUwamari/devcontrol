import { Router } from 'express';
import { InfrastructureController } from '../controllers/infrastructure.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { costSyncRateLimiter } from '../middleware/rateLimiter';
import { checkDiscoveryLimit } from '../middleware/subscription.middleware';

const router = Router();
const controller = new InfrastructureController();

router.use(authenticateToken);

router.get('/', checkDiscoveryLimit, (req, res) => controller.getAll(req, res));
router.get('/costs', (req, res) => controller.getCosts(req, res));
router.post('/sync-aws', requireMember, costSyncRateLimiter, (req, res) => controller.syncAWS(req, res));
router.get('/:id', (req, res) => controller.getById(req, res));
router.post('/', requireMember, (req, res) => controller.create(req, res));
router.delete('/:id', requireMember, (req, res) => controller.delete(req, res));

export default router;
