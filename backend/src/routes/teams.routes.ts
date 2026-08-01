import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { TeamsController } from '../controllers/teams.controller';

const router = Router();
const controller = new TeamsController();

router.use(authenticateToken);

router.get('/', (req, res) => controller.getAll(req, res));
router.get('/:id', (req, res) => controller.getById(req, res));
router.get('/:id/services', (req, res) => controller.getTeamServices(req, res));
router.post('/', (req, res) => controller.create(req, res));
router.delete('/:id', (req, res) => controller.delete(req, res));

export default router;
