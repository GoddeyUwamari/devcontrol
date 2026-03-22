import { Router } from 'express';
import { Pool } from 'pg';
import { CustomAnomalyRulesService } from '../services/custom-anomaly-rules.service';

export const createCustomRulesRoutes = (pool: Pool): Router => {
  const router = Router();
  const service = new CustomAnomalyRulesService(pool);

  // GET /api/anomaly-rules — list all rules for org
  router.get('/', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const rules = await service.getRules(organizationId);
      return res.json({ success: true, data: rules });
    } catch (err: any) {
      console.error('[Custom Rules GET]', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve rules' });
    }
  });

  // POST /api/anomaly-rules — create a new rule
  router.post('/', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const { name, description, metric, condition, threshold, timeWindow, severity } = req.body;

      if (!name?.trim())  return res.status(400).json({ success: false, message: 'Rule name is required' });
      if (!metric?.trim()) return res.status(400).json({ success: false, message: 'Metric is required' });
      if (!condition)     return res.status(400).json({ success: false, message: 'Condition is required' });
      if (threshold === undefined || threshold === null) return res.status(400).json({ success: false, message: 'Threshold is required' });

      const rule = await service.createRule(organizationId, {
        name, description, metric, condition, threshold: parseFloat(threshold), timeWindow, severity,
      });

      return res.status(201).json({ success: true, data: rule, message: 'Rule created successfully' });
    } catch (err: any) {
      console.error('[Custom Rules POST]', err);
      return res.status(500).json({ success: false, message: 'Failed to create rule' });
    }
  });

  // PATCH /api/anomaly-rules/:id — update a rule
  router.patch('/:id', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const rule = await service.updateRule(req.params.id, organizationId, req.body);
      return res.json({ success: true, data: rule });
    } catch (err: any) {
      console.error('[Custom Rules PATCH]', err);
      const status = err.message === 'Rule not found' ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  });

  // PATCH /api/anomaly-rules/:id/toggle — enable or disable
  router.patch('/:id/toggle', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled must be boolean' });

      const rule = await service.toggleRule(req.params.id, organizationId, enabled);
      return res.json({ success: true, data: rule });
    } catch (err: any) {
      console.error('[Custom Rules TOGGLE]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // DELETE /api/anomaly-rules/:id — delete a rule
  router.delete('/:id', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      await service.deleteRule(req.params.id, organizationId);
      return res.json({ success: true, message: 'Rule deleted' });
    } catch (err: any) {
      console.error('[Custom Rules DELETE]', err);
      const status = err.message === 'Rule not found' ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  });

  return router;
};
