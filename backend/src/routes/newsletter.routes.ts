import { Router } from 'express';
import { subscribe } from '../controllers/newsletter.controller';

const router = Router();

// Public endpoint — no authenticateToken
router.post('/subscribe', subscribe);

export default router;
