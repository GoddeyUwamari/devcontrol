import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// Resolve org ID: use authenticated user's org or fall back to demo org
function getOrgId(req: Request): string | null {
  return (req as any).user?.organizationId ?? null;
}

// GET /api/tenants — list all tenants for the org
router.get('/', async (req: Request, res: Response) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { search } = req.query;
    const params: any[] = [organizationId];
    let whereClause = 'WHERE organization_id = $1';
    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    const result = await pool.query(
      `SELECT id, name, email, status, plan, aws_resource_count, monthly_cost, created_at, updated_at
       FROM tenants ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    const tenants = result.rows.map(r => ({
      id:                r.id,
      name:              r.name,
      email:             r.email,
      status:            r.status,
      plan:              r.plan,
      awsResourceCount:  r.aws_resource_count,
      monthlyCost:       parseFloat(r.monthly_cost) || 0,
      createdAt:         r.created_at,
      updatedAt:         r.updated_at,
    }));

    res.json({ success: true, data: tenants });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/tenants/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT
         COUNT(*)                                          AS total,
         COUNT(*) FILTER (WHERE status = 'active')        AS active,
         COUNT(*) FILTER (WHERE status = 'inactive')      AS inactive,
         COALESCE(SUM(monthly_cost), 0)                   AS monthly_cost_total
       FROM tenants
       WHERE organization_id = $1`,
      [organizationId]
    );

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        total:             parseInt(row.total),
        active:            parseInt(row.active),
        inactive:          parseInt(row.inactive),
        monthlyCostTotal:  parseFloat(row.monthly_cost_total),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/tenants — create a new tenant
router.post('/', async (req: Request, res: Response) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { name, email, plan = 'free' } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'name and email are required' });
    }

    const result = await pool.query(
      `INSERT INTO tenants (organization_id, name, email, plan)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, status, plan, aws_resource_count, monthly_cost, created_at, updated_at`,
      [organizationId, name.trim(), email.trim().toLowerCase(), plan]
    );

    const r = result.rows[0];
    res.status(201).json({
      success: true,
      data: {
        id:               r.id,
        name:             r.name,
        email:            r.email,
        status:           r.status,
        plan:             r.plan,
        awsResourceCount: r.aws_resource_count,
        monthlyCost:      parseFloat(r.monthly_cost) || 0,
        createdAt:        r.created_at,
        updatedAt:        r.updated_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/tenants/:id — update tenant
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { name, email, status, plan } = req.body;

    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (name   !== undefined) { fields.push(`name = $${i++}`);   params.push(name); }
    if (email  !== undefined) { fields.push(`email = $${i++}`);  params.push(email.toLowerCase()); }
    if (status !== undefined) { fields.push(`status = $${i++}`); params.push(status); }
    if (plan   !== undefined) { fields.push(`plan = $${i++}`);   params.push(plan); }
    if (fields.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

    fields.push(`updated_at = NOW()`);
    params.push(id, organizationId);

    const result = await pool.query(
      `UPDATE tenants SET ${fields.join(', ')}
       WHERE id = $${i++} AND organization_id = $${i}
       RETURNING id, name, email, status, plan, created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Tenant not found' });
    const r = result.rows[0];
    res.json({ success: true, data: { id: r.id, name: r.name, email: r.email, status: r.status, plan: r.plan, createdAt: r.created_at, updatedAt: r.updated_at } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/tenants/:id — delete tenant
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const organizationId = getOrgId(req);
    if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM tenants WHERE id = $1 AND organization_id = $2 RETURNING id',
      [id, organizationId]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Tenant not found' });
    res.json({ success: true, message: 'Tenant deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
