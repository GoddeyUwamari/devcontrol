import { Router, Request, Response, NextFunction } from 'express'
import { randomBytes } from 'crypto'
import awsCostService from '../services/aws-cost.service'
import { pool } from '../config/database'
import { authenticate } from '../middleware/auth.middleware'
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery'
import { trackFunnelEvent, trackFunnelEventOnce } from '../services/analyticsEvents'
import { OrganizationAccessError, requireCurrentRole } from '../services/organization-authorization'
import { auditEvents, auditRequestContext } from '../services/auditEvents.service'
import { checkNewConnectionRoleArn, DEVCONTROL_ROLE_NAME_PREFIX } from '../utils/devcontrolRoleArn'
import { parseAwsAccountId } from '../utils/awsAccountId'
import { assumeRoleAsPlatform, isPlatformAwsCredentialsUnavailable, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../services/platform-sts'

const router = Router()
const discoveryService = new AWSResourceDiscoveryService(pool)

// All /api/aws/* routes require authentication
router.use(authenticate)

/**
 * Binding the organization's AWS account decides which account every later
 * discovery, cost, and remediation call targets, and there is no disconnect
 * route to undo it -- so it is owner-only, checked against the caller's
 * CURRENT membership (not their JWT role claim).
 */
async function requireCurrentOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' })
      return
    }
    await requireCurrentRole(pool, req.user.organizationId, req.user.userId, ['owner'])
    next()
  } catch (err: unknown) {
    if (err instanceof OrganizationAccessError && err.statusCode === 403) {
      res.status(403).json({ success: false, message: 'Only an organization owner can connect an AWS account' })
      return
    }
    console.error('[aws] owner check error:', err)
    res.status(500).json({ success: false, message: 'Failed to verify permissions' })
  }
}

/**
 * The platform's AWS account ID: the principal in the trust policy every
 * organization creates for DevControl. Required configuration with no
 * default (validateEnv requires it in production) -- a fallback would hand
 * customers a policy trusting whatever account it named. Read per request;
 * null unless it is a 12-digit AWS account ID.
 */
function platformAwsAccountId(): string | null {
  return parseAwsAccountId(process.env.AWS_ACCOUNT_ID)
}

function buildTrustPolicy(externalId: string, platformAccountId: string): object {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${platformAccountId}:root` },
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
    const orgId = req.user!.organizationId
    const costs = await awsCostService.fetchMonthlyCosts(orgId)
    res.json(costs)
  } catch (error) {
    // The real error stays in the server log: AWS messages can name ARNs and
    // account IDs, so the response carries only a fixed message.
    console.error('Error fetching monthly costs:', error)
    res.status(500).json({
      error: 'Failed to fetch monthly costs',
      message: 'Monthly cost data is unavailable right now. Please try again later.',
    })
  }
})

// GET /api/aws/resources and POST /api/aws/sync were removed here: both
// predated the per-org STS architecture below (POST /accounts,
// AWSResourceDiscoveryService.discoverAllResources) and used platform-level
// static credentials with no org scoping at all — GET /resources returned
// the same platform-wide resource list to any authenticated user regardless
// of org, and POST /sync's INSERT referenced columns
// (service/resource_id/resource_name/region/tags) that don't exist on
// infrastructure_resources (it's service_id/aws_id/aws_region/metadata),
// so it has never successfully run. No frontend caller referenced either
// route. Real, per-org-scoped discovery already exists via
// AWSResourceDiscoveryService (wired through POST /accounts and
// POST /api/services/discover).

// GET /api/aws/accounts/connect-init
// Generates and stores a per-org external_id for the connect flow.
// Must be registered before GET /accounts to avoid shadowing.
router.get('/accounts/connect-init', requireCurrentOwner, async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId

  // Without the platform account there is no trust policy to show: fail
  // before creating a session or recording the funnel event.
  const platformAccountId = platformAwsAccountId()
  if (!platformAccountId) {
    console.error('[connect-init] AWS_ACCOUNT_ID is missing or not a 12-digit AWS account ID; cannot build the trust policy')
    return res.status(500).json({ success: false, message: 'Failed to initialise connect session.' })
  }

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

    // Funnel: the org has entered the AWS connection flow -- not that it
    // succeeded (that's aws_connection_completed, on POST /accounts).
    // Deliberately unconditional on whether this call created a new session
    // row or reused an existing valid one: "started" is about the org's
    // first-ever entry into this flow, not about aws_connect_sessions'
    // upsert/attempt semantics, which are left entirely unchanged.
    // trackFunnelEventOnce's own per-org dedup is what makes every
    // subsequent visit -- including a full retry after expiry -- a no-op.
    await trackFunnelEventOnce({
      organizationId: orgId,
      userId: req.user!.userId,
      eventName: 'aws_connection_started',
    })

    return res.json({
      success: true,
      data: {
        externalId,
        platformAccountId,
        trustPolicy: buildTrustPolicy(externalId, platformAccountId),
      },
    })
  } catch (err: any) {
    console.error('[connect-init]', err)
    return res.status(500).json({ success: false, message: 'Failed to initialise connect session.' })
  }
})

// POST /api/aws/accounts
// Validates the role via STS (with ExternalId) then writes a row scoped to this org.
router.post('/accounts', requireCurrentOwner, async (req: Request, res: Response) => {
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
  const arnCheck = checkNewConnectionRoleArn(decodedRoleArn)
  if (!arnCheck.ok && arnCheck.reason === 'malformed') {
    return res.status(400).json({ success: false, message: 'Invalid Role ARN format. Expected: arn:aws:iam::123456789012:role/DevControlRole' })
  }
  if (!arnCheck.ok) {
    return res.status(422).json({
      success: false,
      message: `The IAM role name must start with "${DEVCONTROL_ROLE_NAME_PREFIX}" (for example ${DEVCONTROL_ROLE_NAME_PREFIX} or ${DEVCONTROL_ROLE_NAME_PREFIX}-Prod) and the role must not use an IAM path. Create or rename the role, then paste its ARN again.`,
    })
  }
  const accountId = arnCheck.accountId

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

  // Validate via STS AssumeRole as the platform's own identity (the SDK's
  // default credential chain)
  try {
    await assumeRoleAsPlatform(process.env.AWS_REGION ?? 'us-east-1', {
      RoleArn: decodedRoleArn,
      RoleSessionName: 'devcontrol-validation',
      ExternalId: externalId,
      DurationSeconds: 900,
    }, `Connect AWS org ${orgId}`)
  } catch (stsError: any) {
    // The platform's own identity is unavailable: the role was never tested,
    // so the owner is not told to fix it. Nothing is saved and the connect
    // session stays for a retry.
    if (isPlatformAwsCredentialsUnavailable(stsError)) {
      return res.status(503).json({ success: false, message: PLATFORM_AWS_UNAVAILABLE_MESSAGE })
    }
    console.error('[Connect AWS] STS validation failed:', {
      name: stsError?.name,
      code: stsError?.Code,
      httpStatusCode: stsError?.$metadata?.httpStatusCode,
      requestId: stsError?.$metadata?.requestId,
      message: stsError?.message,
    })
    // No raw AWS message in the response: it names the platform's own
    // principal. The full message is in the server log above.
    return res.status(422).json({
      success: false,
      message: mapStsError(stsError),
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

    // Funnel: this INSERT's own ON CONFLICT (org_id) DO NOTHING + non-empty
    // RETURNING already guarantees this branch executes exactly once per
    // org (a second attempt hits the 409 above instead), so no additional
    // dedupe guard is needed. This replaces onboardingEvents.ts's
    // 'aws:connected' emitter for funnel purposes -- that one is only ever
    // fired from the legacy access-key endpoint (organization.controller.ts),
    // never from this, the actual connection flow in use today.
    await trackFunnelEvent({
      organizationId: orgId,
      userId: req.user!.userId,
      eventName: 'aws_connection_completed',
      properties: { accountId },
    })

    // resource_id stays null: it is a UUID column and aws_accounts ids are not
    // guaranteed to be UUIDs. Never the ExternalId or any credential.
    await auditEvents.record({
      organizationId: orgId,
      actorId: req.user!.userId,
      action: 'aws_account.connected',
      resourceType: 'aws_account',
      resourceId: null,
      metadata: { awsAccountId: accountId },
      request: auditRequestContext(req),
    })

    // Clean up the session this connect consumed. Matched on its external_id
    // so a session created or rotated for this org after the read above is
    // left alone, and awaited so the delete cannot land after the response.
    // A failure only leaves a session that expires on its own -- log it
    // (org id and message only, never the ExternalId) and keep the 201.
    try {
      await pool.query(
        `DELETE FROM aws_connect_sessions WHERE org_id = $1 AND external_id = $2`,
        [orgId, externalId]
      )
    } catch (sessionError: unknown) {
      console.error(
        `[Connect AWS] Failed to clear connect session for org ${orgId}:`,
        sessionError instanceof Error ? sessionError.message : String(sessionError)
      )
    }

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