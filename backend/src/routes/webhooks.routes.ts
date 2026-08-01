import { Router } from 'express'
import { pool } from '../config/database'
import crypto from 'crypto'
import { authenticateToken } from '../middleware/auth.middleware'

const router = Router()

router.use(authenticateToken)

// GET /api/webhooks — list the caller's org's webhook endpoints
router.get('/', async (req, res) => {
  const organizationId = (req as any).user?.organizationId
  try {
    const result = await pool.query(
      `SELECT id, url, events, status, created_at, last_triggered_at
       FROM webhook_endpoints
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    )
    return res.json({ success: true, data: result.rows })
  } catch (err: any) {
    console.error('[webhooks GET]', err)
    return res.status(500).json({ success: false, message: 'Failed to retrieve webhooks' })
  }
})

// POST /api/webhooks — register a new endpoint scoped to the caller's org
router.post('/', async (req, res) => {
  const organizationId = (req as any).user?.organizationId
  const { url, events } = req.body
  if (!url?.trim() || !url.startsWith('https://')) {
    return res.status(400).json({ success: false, message: 'A valid HTTPS URL is required' })
  }

  const secret = 'whsec_' + crypto.randomBytes(24).toString('hex')
  const endpointEvents = events ?? ['alert.triggered']

  try {
    const result = await pool.query(
      `INSERT INTO webhook_endpoints (url, events, status, secret, organization_id)
       VALUES ($1, $2, 'active', $3, $4)
       RETURNING id, url, events, status, created_at, last_triggered_at`,
      [url.trim(), endpointEvents, secret, organizationId]
    )
    return res.status(201).json({
      success: true,
      data: { ...result.rows[0], secret },
      message: 'Webhook endpoint registered. Save the secret — it will not be shown again.',
    })
  } catch (err: any) {
    console.error('[webhooks POST]', err)
    return res.status(500).json({ success: false, message: 'Failed to register webhook' })
  }
})

// DELETE /api/webhooks/:id — delete an endpoint belonging to the caller's org
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const organizationId = (req as any).user?.organizationId
  try {
    const result = await pool.query(
      `DELETE FROM webhook_endpoints WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [id, organizationId]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Webhook endpoint not found' })
    }
    return res.json({ success: true, message: 'Webhook endpoint deleted' })
  } catch (err: any) {
    console.error('[webhooks DELETE]', err)
    return res.status(500).json({ success: false, message: 'Failed to delete webhook' })
  }
})

export default router
