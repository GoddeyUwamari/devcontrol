/**
 * The live /api/anomalies router, mounted by server.ts.
 *
 * Not to be confused with anomaly.routes.ts, which is not mounted anywhere.
 */
import { Router } from 'express';
import { Pool } from 'pg';
import { AnomalyRepository } from '../repositories/anomaly.repository';
import { AnomalyDetectionService } from '../services/anomaly-detection.service';
import { AnomalyAIService } from '../services/anomaly-ai.service';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';

export const createAnomaliesRoutes = (pool: Pool): Router => {
  const router = Router();
  const anomalyRepository = new AnomalyRepository(pool);
  const anomalyDetectionService = new AnomalyDetectionService(pool);
  const anomalyAIService = new AnomalyAIService();

  router.use(authenticateToken);

  router.get('/', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      const { status } = req.query;
      if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

      const anomalies = status === 'all'
        ? await anomalyRepository.getAllAnomalies(organizationId)
        : await anomalyRepository.getActiveAnomalies(organizationId);
      const stats = await anomalyRepository.getStats(organizationId);

      res.json({ success: true, anomalies, stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Owner/admin only: a scan calls the AI explainer and writes anomaly rows.
  router.post('/scan', requireAdmin, async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

      let anomalies = await anomalyDetectionService.scanForAnomalies(organizationId);
      if (anomalies.length > 0) {
        anomalies = await anomalyAIService.explainAnomalies(anomalies);
        await anomalyRepository.saveAnomalies(anomalies);
      }

      res.json({
        success: true,
        anomalies,
        count: anomalies.length,
        message: anomalies.length > 0
          ? `Found ${anomalies.length} anomalies`
          // Not "healthy": no measured-data anomaly detectors run (see
          // AnomalyDetectionService), so an empty scan is not evidence of health.
          : 'No anomalies recorded. Anomaly detection on measured data is not currently active.',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
      const stats = await anomalyRepository.getStats(organizationId);
      res.json({ success: true, stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/:id/acknowledge', async (req, res) => {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;
      // JWTPayload's field is `userId`, not `id` — req.user.id doesn't exist.
      const userId = (req as any).user?.userId;
      if (!organizationId || !userId) return res.status(401).json({ error: 'Unauthorized' });
      const updated = await anomalyRepository.acknowledge(id, organizationId, userId);
      if (!updated) return res.status(404).json({ error: 'Anomaly not found' });
      res.json({ success: true, message: 'Anomaly acknowledged' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/:id/resolve', async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
      const updated = await anomalyRepository.resolve(id, organizationId, notes);
      if (!updated) return res.status(404).json({ error: 'Anomaly not found' });
      res.json({ success: true, message: 'Anomaly resolved' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/:id/false-positive', async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
      const updated = await anomalyRepository.markFalsePositive(id, organizationId, notes);
      if (!updated) return res.status(404).json({ error: 'Anomaly not found' });
      res.json({ success: true, message: 'Anomaly marked as false positive' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
