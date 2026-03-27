/**
 * Cost Optimization AI Routes
 * AI-powered cost optimization recommendations backed by cost_optimization_results/scans tables.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { CostOptimizationAIService } from '../services/cost-optimization-ai.service';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const service = new CostOptimizationAIService(pool);

router.use(authenticateToken);

/**
 * POST /api/cost-optimization/scan
 * Start a new AI-powered cost optimization scan.
 * Returns scanId immediately; scan runs in background.
 */
router.post('/scan', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    const scanId = await service.startScan(orgId);
    res.json({ success: true, scanId });
  } catch (err: any) {
    console.error('[CostOptAI Routes] scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cost-optimization/status/:scanId
 * Poll the status of a scan.
 */
router.get('/status/:scanId', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    const scan = await service.getScanStatus(req.params.scanId, orgId);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    res.json({ success: true, scan });
  } catch (err: any) {
    console.error('[CostOptAI Routes] status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cost-optimization/results
 * Get cost optimization results for the org.
 * Query params: status = pending | applied | ignored
 */
router.get('/results', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    const status = req.query.status as string | undefined;
    const results = await service.getResults(orgId, status);
    res.json({ success: true, results });
  } catch (err: any) {
    console.error('[CostOptAI Routes] results error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cost-optimization/apply/:id
 * Mark a recommendation as applied.
 */
router.post('/apply/:id', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    await service.applyRecommendation(req.params.id, orgId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[CostOptAI Routes] apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cost-optimization/ignore/:id
 * Mark a recommendation as ignored.
 */
router.post('/ignore/:id', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    await service.ignoreRecommendation(req.params.id, orgId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[CostOptAI Routes] ignore error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
