import { Router } from 'express';
import { Pool } from 'pg';
import { AnomalyController } from '../controllers/anomaly.controller';
import { AnomalyDetectionJob } from '../jobs/anomaly-detection.job';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePro } from '../middleware/subscription.middleware';

export const createAnomalyRoutes = (
  pool: Pool,
  detectionJob: AnomalyDetectionJob
): Router => {
  const router = Router();
  const controller = new AnomalyController(pool, detectionJob);

  // All routes require Pro tier or higher
  router.use(authenticateToken);
  router.use(requirePro);

  /**
   * GET /api/anomalies
   * Get active anomalies
   */
  router.get('/', controller.getAnomalies);

  /**
   * POST /api/anomalies/scan
   * Trigger manual scan
   */
  router.post('/scan', controller.triggerScan);

  /**
   * GET /api/anomalies/stats
   * Get statistics
   */
  router.get('/stats', controller.getStats);

  /**
   * GET /api/anomalies/last-scan
   * Get timestamp of most recent scan
   */
  router.get('/last-scan', controller.getLastScan);

  /**
   * PATCH /api/anomalies/:id/acknowledge
   * Acknowledge anomaly
   */
  router.patch('/:id/acknowledge', controller.acknowledge);

  /**
   * PATCH /api/anomalies/:id/resolve
   * Resolve anomaly
   */
  router.patch('/:id/resolve', controller.resolve);

  /**
   * PATCH /api/anomalies/:id/false-positive
   * Mark as false positive
   */
  router.patch('/:id/false-positive', controller.markFalsePositive);

  return router;
};
