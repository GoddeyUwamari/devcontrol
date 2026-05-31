import { Router, Request, Response } from 'express'
import { randomBytes } from 'crypto'
import awsCostService from '../services/aws-cost.service'
import { pool } from '../config/database'
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'
import { authenticate } from '../middleware/auth.middleware'
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery'

const router = Router()
const discoveryService = new AWSResourceDiscoveryService(pool)

// All /api/aws/* routes require authentication
router.use(authenticate)

const PLATFORM_AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID ?? '815931739526'

function buildTrustPolicy(externalId: string): object {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${PLATFORM_AWS_ACCOUNT_ID}:root` },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: { 'sts:ExternalId': externalId },
        },
      },
    ],
  }
}

function mapStsError(err: any): string {
  const code = err?.name ?? err?.Code ?? ''
  if (code === 'AccessDenied') {
    return 'Access denied — ensure the trust policy allows our account and the ExternalId matches exactly.'
  }
  if (code === 'NoSuchEntity') {
    return 'Role ARN not found — verify the ARN is correct and the role exists in your account.'
  }
  return 'Could not assume this role. Check the trust policy and Role ARN, then try again.'
}

// GET /api/aws/costs/monthly
router.get('/costs/monthly', async (req: Request, res: Response) => {
  try {
    const costs = await awsCostService.fetchMonthlyCosts()
    res.json(costs)
  } catch (error) {
    console.error('Error fetching monthly costs:', error)
    res.status(500).json({
      error: 'Failed to fetch monthly costs',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// GET /api/aws/resources
router.get('/resources', async (req: Request, res: Response) => {
  try {
    const resources = await awsCostService.fetchAllResources()
    res.json({ total: resources.length, resources })
  } catch (error) {
    console.error('Error fetching AWS resources:', error)
    res.status(500).json({
      error: 'Failed to fetch AWS resources',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/aws/sync
router.post('/sync', async (req: Request, res: Response) => {
  try {
    await awsCostService.syncResourcesToDatabase()
    res.json({ success: true, message: 'AWS resources synced to database successfully' })
  } catch (error) {
    console.error('Error syncing AWS resources:', error)
    res.status(500).json({
      error: 'Failed to sync AWS resources',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// GET /api/aws/accounts/connect-init
// Generates and stores a per-org external_id for the connect flow.
// Must be registered before GET /accounts to avoid shadowing.
router.get('/accounts/connect-init', async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId

  try {
    // Reuse existing session if valid — don't generate a new ExternalId on every page load,
    // which would force the user to update their AWS trust policy each time.
    const existing = await pool.query(
      `SELECT external_id FROM aws_connect_sessions
       WHERE org_id = $1 AND expires_at > NOW()`,
      [orgId]
    )

    const externalId = existing.rows.length > 0
      ? existing.rows[0].external_id
      : randomBytes(24).toString('base64url')

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO aws_connect_sessions (org_id, external_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')
         ON CONFLICT (org_id) DO UPDATE
           SET external_id = EXCLUDED.external_id,
               created_at  = NOW(),
               expires_at  = NOW() + INTERVAL '1 hour'`,
        [orgId, externalId]
      )
    }

    return res.json({
      success: true,
      data: {
        externalId,
        platformAccountId: PLATFORM_AWS_ACCOUNT_ID,
        trustPolicy: buildTrustPolicy(externalId),
      },
    })
  } catch (err: any) {
    console.error('[connect-init]', err)
    return res.status(500).json({ success: false, message: 'Failed to initialise connect session.' })
  }
})

// POST /api/aws/accounts
// Validates the role via STS (with ExternalId) then writes a row scoped to this org.
router.post('/accounts', async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId
  const { roleArn, nickname } = req.body

  const decodedRoleArn = roleArn
    ?.replace(/&#x2F;/g, '/')
    ?.replace(/&amp;/g, '&')
    ?.replace(/&lt;/g, '<')
    ?.replace(/&gt;/g, '>')

  if (!decodedRoleArn) {
    return res.status(400).json({ success: false, message: 'roleArn is required' })
  }
  const arnMatch = decodedRoleArn.match(/arn:aws:iam::(\d+):role\//)
  if (!arnMatch) {
    return res.status(400).json({ success: false, message: 'Invalid Role ARN format. Expected: arn:aws:iam::123456789012:role/RoleName' })
  }
  const accountId = arnMatch[1]

  // Retrieve the pending external_id for this org
  const sessionResult = await pool.query(
    `SELECT external_id FROM aws_connect_sessions
     WHERE org_id = $1 AND expires_at > NOW()`,
    [orgId]
  )
  if (sessionResult.rows.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Connect session not found or expired. Please go back and start again.',
    })
  }
  const externalId = sessionResult.rows[0].external_id

  // Validate via STS AssumeRole using the platform's own credentials
  const sts = new STSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
     
     
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  })
  try {
    await sts.send(new AssumeRoleCommand({
      RoleArn: decodedRoleArn,
      RoleSessionName: 'devcontrol-validation',
      ExternalId: externalId,
      DurationSeconds: 900,
    }))
  } catch (stsError: any) {
    console.error('[Connect AWS] STS validation failed:', {
      name: stsError?.name,
      code: stsError?.Code,
      httpStatusCode: stsError?.$metadata?.httpStatusCode,
      requestId: stsError?.$metadata?.requestId,
      message: stsError?.message,
    })
    return res.status(422).json({
      success: false,
      message: mapStsError(stsError),
      detail: stsError?.message ?? null,
    })
  }
  // Persist with org_id.
  // ON CONFLICT (org_id) DO NOTHING + check rowCount → 409 if already connected.
  try {
    const result = await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, nickname, external_id, region, connected_at, status)
       VALUES ($1, $2, $3, $4, $5, 'us-east-1', NOW(), 'active')
       ON CONFLICT (org_id) DO NOTHING
       RETURNING id, org_id, account_id, role_arn, nickname, external_id, region, connected_at, status`,
      [orgId, decodedRoleArn, accountId, nickname ?? null, externalId]
    )

    if (result.rows.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'This organisation already has a connected AWS account. Disconnect it first.',
      })
    }

    // Clean up session
    pool.query(`DELETE FROM aws_connect_sessions WHERE org_id = $1`, [orgId]).catch(() => {})

    // Kick off initial resource discovery in the background.
    // Fire-and-forget so we don't block the 201 response (a full scan can take 30-120s).
    discoveryService.discoverAllResources(orgId).catch(err => {
      console.error(`[Connect AWS] Initial discovery failed for org ${orgId}:`, err)
    })

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'AWS account connected successfully',
    })
  } catch (dbError: any) {
    console.error('[aws/accounts POST]', dbError)
    return res.status(500).json({
      success: false,
      message: 'Account validated but could not be saved. Please try again.',
    })
  }
})

// GET /api/aws/accounts
// Returns only the accounts belonging to the calling org.
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, org_id, account_id, role_arn, nickname, external_id, region, connected_at, status
       FROM aws_accounts
       WHERE org_id = $1
       ORDER BY connected_at DESC`,
      [req.user!.organizationId]
    )
    return res.json({ success: true, data: result.rows })
  } catch (err: any) {
    console.error('[aws/accounts GET]', err)
    return res.status(500).json({ success: false, message: 'Failed to retrieve AWS accounts.' })
  }
})

export default router