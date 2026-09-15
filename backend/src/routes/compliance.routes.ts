import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { standardRateLimiter } from '../middleware/rateLimiter';
import { ComplianceEngineService } from '../services/compliance-engine.service';
import { ControlFramework } from '../data/compliance-controls';

function isValidFramework(f: string): f is ControlFramework {
  return f === 'soc2' || f === 'hipaa';
}

export function createComplianceRoutes(pool: Pool): Router {
  const router = Router();
  const engine = new ComplianceEngineService(pool);

  // All routes require authentication
  router.use(authenticateToken);

  /**
   * GET /api/compliance/results
   * Get latest scan results for all frameworks (no new scan)
   */
  router.get('/results', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const results = await engine.getAllLatestResults(organizationId);
      res.json({ success: true, results });
    } catch (error: any) {
      console.error('[Compliance] Error fetching results:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/compliance/results/:framework
   * Get latest scan results for a specific framework
   */
  router.get('/results/:framework', async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework. Use "soc2" or "hipaa".' });
        return;
      }

      const result = await engine.getLatestResult(organizationId, framework);
      res.json({ success: true, result });
    } catch (error: any) {
      console.error('[Compliance] Error fetching result:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/compliance/history/:framework
   * Get historical scan scores for trend chart
   */
  router.get('/history/:framework', async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework.' });
        return;
      }

      const days = Math.min(parseInt(req.query.days as string) || 90, 365);
      const history = await engine.getScanHistory(organizationId, framework, days);
      res.json({ success: true, history });
    } catch (error: any) {
      console.error('[Compliance] Error fetching history:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/compliance/scan
   * Run a compliance scan for all frameworks — Enterprise only
   */
  router.post('/scan', requireEnterprise, standardRateLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      console.log(`[Compliance] Running full scan for org ${organizationId}`);
      const results = await engine.runAllScans(organizationId);

      res.json({
        success: true,
        message: 'Compliance scan completed',
        results,
      });
    } catch (error: any) {
      console.error('[Compliance] Error running scan:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/compliance/scan/:framework
   * Run a compliance scan for a specific framework — Enterprise only
   */
  router.post('/scan/:framework', requireEnterprise, standardRateLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework. Use "soc2" or "hipaa".' });
        return;
      }

      console.log(`[Compliance] Running ${framework} scan for org ${organizationId}`);
      const result = await engine.runScan(organizationId, framework);

      res.json({
        success: true,
        message: `${framework.toUpperCase()} compliance scan completed`,
        result,
      });
    } catch (error: any) {
      console.error('[Compliance] Error running scan:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/compliance/report/:framework
   * Retired: this previously generated a downloadable PDF branded "CONFIDENTIAL — FOR
   * AUDIT USE ONLY" / "SOC 2 Type II Compliance Audit Report" from ComplianceEngineService's
   * heuristic scan results — an artifact a customer could reasonably mistake for an
   * independent SOC 2 audit report, which DevControl does not perform. Retired as part of
   * the product-truthfulness remediation (see app/(app)/compliance/page.tsx, now a redirect
   * to /compliance/frameworks). Never re-add PDF generation to this endpoint without first
   * resolving that underlying truthfulness gap.
   */
  router.get('/report/:framework', requireEnterprise, async (req: Request, res: Response): Promise<void> => {
    const { framework } = req.params;
    if (!isValidFramework(framework)) {
      res.status(400).json({ success: false, error: 'Invalid framework.' });
      return;
    }
    res.status(410).json({
      success: false,
      error: 'This report has been retired. DevControl does not generate SOC 2 or HIPAA audit reports. See /compliance/frameworks for current, Security Hub-backed compliance readiness.',
    });
  });

  return router;
}
