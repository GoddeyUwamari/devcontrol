import { Request, Response } from 'express';
import { Pool } from 'pg';
import { AnomalyRepository } from '../repositories/anomaly.repository';
import { AnomalyDetectionJob } from '../jobs/anomaly-detection.job';

export class AnomalyController {
  private repository: AnomalyRepository;
  private detectionJob: AnomalyDetectionJob;

  constructor(pool: Pool, detectionJob: AnomalyDetectionJob) {
    this.repository = new AnomalyRepository(pool);
    this.detectionJob = detectionJob;
  }

  /**
   * GET /api/anomalies
   * Get active anomalies for organization
   */
  getAnomalies = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      const { status } = req.query;

      if (!organizationId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const anomalies = status === 'all'
        ? await this.repository.getAllAnomalies(organizationId)
        : await this.repository.getActiveAnomalies(organizationId);

      const stats = await this.repository.getStats(organizationId);

      res.json({
        success: true,
        anomalies,
        stats,
      });
    } catch (error: any) {
      console.error('[Anomaly Controller] Get anomalies error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * POST /api/anomalies/scan
   * Trigger manual detection scan
   */
  triggerScan = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      console.log(`[Anomaly Controller] Manual scan triggered for org ${organizationId}`);

      const anomalies = await this.detectionJob.triggerManual(organizationId);

      res.json({
        success: true,
        anomalies,
        count: anomalies.length,
        message: anomalies.length > 0
          ? `Found ${anomalies.length} anomalies`
          : 'No anomalies detected - infrastructure is healthy',
      });
    } catch (error: any) {
      console.error('[Anomaly Controller] Scan error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * PATCH /api/anomalies/:id/acknowledge
   * Acknowledge an anomaly
   */
  acknowledge = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await this.repository.acknowledge(id, userId);
      console.log(`[Anomaly Controller] Anomaly ${id} acknowledged by user ${userId}`);

      res.json({ success: true, message: 'Anomaly acknowledged' });
    } catch (error: any) {
      console.error('[Anomaly Controller] Acknowledge error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * PATCH /api/anomalies/:id/resolve
   * Resolve an anomaly
   */
  resolve = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      await this.repository.resolve(id, notes);
      console.log(`[Anomaly Controller] Anomaly ${id} resolved`);

      res.json({ success: true, message: 'Anomaly resolved' });
    } catch (error: any) {
      console.error('[Anomaly Controller] Resolve error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * PATCH /api/anomalies/:id/false-positive
   * Mark anomaly as false positive
   */
  markFalsePositive = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      await this.repository.markFalsePositive(id, notes);
      console.log(`[Anomaly Controller] Anomaly ${id} marked as false positive`);

      res.json({ success: true, message: 'Anomaly marked as false positive' });
    } catch (error: any) {
      console.error('[Anomaly Controller] False positive error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * GET /api/anomalies/stats
   * Get anomaly statistics
   */
  getStats = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const stats = await this.repository.getStats(organizationId);

      res.json({
        success: true,
        stats,
      });
    } catch (error: any) {
      console.error('[Anomaly Controller] Get stats error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}
