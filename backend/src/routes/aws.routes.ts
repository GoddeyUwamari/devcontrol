import { Router, Request, Response } from 'express'
import awsCostService from '../services/aws-cost.service'
import { pool } from '../config/database'
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'

const router = Router()

/**
 * GET /api/aws/costs/monthly
 * Fetch current month costs from AWS Cost Explorer
 */
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

/**
 * GET /api/aws/resources
 * Fetch all AWS resources (EC2, RDS, S3)
 */
router.get('/resources', async (req: Request, res: Response) => {
  try {
    const resources = await awsCostService.fetchAllResources()
    res.json({
      total: resources.length,
      resources,
    })
  } catch (error) {
    console.error('Error fetching AWS resources:', error)
    res.status(500).json({
      error: 'Failed to fetch AWS resources',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * POST /api/aws/sync
 * Sync AWS resources to database
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    await awsCostService.syncResourcesToDatabase()
    res.json({
      success: true,
      message: 'AWS resources synced to database successfully',
    })
  } catch (error) {
    console.error('Error syncing AWS resources:', error)
    res.status(500).json({
      error: 'Failed to sync AWS resources',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/aws/accounts — validate IAM role via STS then persist
router.post('/accounts', async (req, res) => {
  const { roleArn, nickname } = req.body

  const decodedRoleArn = roleArn
    ?.replace(/&#x2F;/g, '/')
    ?.replace(/&amp;/g, '&')
    ?.replace(/&lt;/g, '<')
    ?.replace(/&gt;/g, '>')

  if (!decodedRoleArn) {
    return res.status(400).json({
      success: false,
      message: 'roleArn is required',
    })
  }
  const arnMatch = decodedRoleArn.match(/arn:aws:iam::(\d+):role\//)
  if (!arnMatch) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Role ARN format',
    })
  }
  const accountId = arnMatch[1]

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
      DurationSeconds: 900,
    }))
  } catch (stsError: any) {
    return res.status(422).json({
      success: false,
      message: 'AWS could not assume this role. Verify the trust policy and Role ARN are correct.',
      detail: stsError?.message ?? null,
    })
  }

  try {
    const result = await pool.query(
      `INSERT INTO aws_accounts (role_arn, account_id, nickname, connected_at, status)
       VALUES ($1, $2, $3, NOW(), 'active')
       ON CONFLICT (account_id) DO UPDATE
         SET role_arn     = EXCLUDED.role_arn,
             nickname     = EXCLUDED.nickname,
             connected_at = NOW(),
             status       = 'active'
       RETURNING id, account_id, nickname, connected_at, status`,
      [decodedRoleArn, accountId, nickname ?? null]
    )
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

// GET /api/aws/accounts — list connected accounts
router.get('/accounts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, account_id, nickname, connected_at, status
       FROM aws_accounts
       ORDER BY connected_at DESC`
    )
    return res.json({
      success: true,
      data: result.rows,
    })
  } catch (err: any) {
    console.error('[aws/accounts GET]', err)
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve AWS accounts',
    })
  }
})

export default router
