import { Router } from 'express'
import { pool } from '../config/database'
import crypto from 'crypto'

const router = Router()

// GET /api/webhooks — list all webhook endpoints
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, url, events, status, created_at, last_triggered_at
       FROM webhook_endpoints
       ORDER BY created_at DESC`
    )
    return res.json({ success: true, data: result.rows })
  } catch (err: any) {
    console.error('[webhooks GET]', err)
    return res.status(500).json({ success: false, message: 'Failed to retrieve webhooks' })
  }
})

// POST /api/webhooks — register a new endpoint
router.post('/', async (req, res) => {
  const { url, events } = req.body
  if (!url?.trim() || !url.startsWith('https://')) {
    return res.status(400).json({ success: false, message: 'A valid HTTPS URL is required' })
  }

  const secret = 'whsec_' + crypto.randomBytes(24).toString('hex')
  const endpointEvents = events ?? ['alert.triggered']

  try {
    const result = await pool.query(
      `INSERT INTO webhook_endpoints (url, events, status, secret)
       VALUES ($1, $2, 'active', $3)
       RETURNING id, url, events, status, created_at, last_triggered_at`,
      [url.trim(), endpointEvents, secret]
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

// DELETE /api/webhooks/:id — delete an endpoint
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  try {
    const result = await pool.query(
      `DELETE FROM webhook_endpoints WHERE id = $1 RETURNING id`,
      [id]
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
