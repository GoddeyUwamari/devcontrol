import { Router } from 'express'
import { pool } from '../config/database'
import crypto from 'crypto'

const router = Router()

// GET /api/keys — list all active keys (never return the hash)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, prefix, scopes, status, created_at, last_used_at
       FROM api_keys
       WHERE status = 'active'
       ORDER BY created_at DESC`
    )
    return res.json({ success: true, data: result.rows })
  } catch (err: any) {
    console.error('[api-keys GET]', err)
    return res.status(500).json({ success: false, message: 'Failed to retrieve API keys' })
  }
})

// POST /api/keys — generate a new key
router.post('/', async (req, res) => {
  const { name, scopes } = req.body
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Key name is required' })
  }

  // Generate key: dc_live_ + 32 random hex chars
  const rawKey = 'dc_live_' + crypto.randomBytes(16).toString('hex')
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const prefix = rawKey.substring(0, 12)
  const keyScopes = scopes ?? ['read:metrics', 'read:costs']

  try {
    const result = await pool.query(
      `INSERT INTO api_keys (name, key_hash, prefix, scopes, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, name, prefix, scopes, status, created_at, last_used_at`,
      [name.trim(), keyHash, prefix, keyScopes]
    )
    // Return the raw key ONCE — it will never be shown again
    return res.status(201).json({
      success: true,
      data: { ...result.rows[0], raw_key: rawKey },
      message: 'API key generated. Copy it now — it will not be shown again.',
    })
  } catch (err: any) {
    console.error('[api-keys POST]', err)
    return res.status(500).json({ success: false, message: 'Failed to generate API key' })
  }
})

// DELETE /api/keys/:id — revoke a key
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  try {
    const result = await pool.query(
      `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND status = 'active' RETURNING id`,
      [id]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Key not found or already revoked' })
    }
    return res.json({ success: true, message: 'API key revoked' })
  } catch (err: any) {
    console.error('[api-keys DELETE]', err)
    return res.status(500).json({ success: false, message: 'Failed to revoke API key' })
  }
})

export default router
