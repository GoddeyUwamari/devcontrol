import { Router, Request, Response, NextFunction } from 'express'
import awsCostService from '../services/aws-cost.service'
import { pool } from '../config/database'
import { withConnectionChange } from '../services/aws-connection-fence'
import {
  AWS_ACCOUNT_AMBIGUOUS_MESSAGE,
  awsConnectionIdentity,
  findEligibleAwsAccount,
  isAwsAccountAmbiguous,
  type AwsAccountRow,
} from '../repositories/aws-accounts.repository'
import {
  CHECK_AGAIN_COOLDOWN_MS,
  applyAssumeOutcome,
  claimCheckAgain,
  connectionChecksView,
  isChecksTableMissing,
  logChecksWriteFailure,
  readConnectionChecksOrNull,
  saveCheckResults,
} from '../repositories/aws-connection-checks.repository'
import { isConnectionChanged } from '../services/aws-connection-fence'
import { AWS_NOT_CONNECTED_CODE, AWS_NOT_CONNECTED_MESSAGE } from '../services/aws-connection-messages'
import type { AssumeResult } from '../services/connection-health'
import { compareRolePolicies, type IamSender, type PolicyCompareResult } from '../services/connect-policy-compare'
import { IAMClient } from '@aws-sdk/client-iam'
import { authenticate } from '../middleware/auth.middleware'
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery'
import { isScanAlreadyRunning } from '../services/scan-session'
import { trackFunnelEvent, trackFunnelEventOnce } from '../services/analyticsEvents'
import { OrganizationAccessError, requireCurrentRole } from '../services/organization-authorization'
import { auditEvents, auditRequestContext } from '../services/auditEvents.service'
import { checkNewConnectionRoleArn, DEVCONTROL_ROLE_NAME_PREFIX } from '../utils/devcontrolRoleArn'
import { parseAwsAccountId } from '../utils/awsAccountId'
import { PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../services/platform-sts'
import { checkConnectRole, type RoleCheckFailure, type RoleCheckPolicy } from '../services/connect-role-check'
import { runPermissionCheck, type ProbeClients } from '../services/connect-permission-check'
import { resolveOrganizationExternalId } from '../repositories/aws-external-id.repository'
import { ConnectCheckSlots, type ConnectSlotRefusal } from '../services/connect-check-slots'
import { releaseRequestConnection } from '../middleware/request-lifecycle'

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
function requireCurrentOwnerWith(forbiddenMessage: string) {
  return async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Authentication required' })
        return
      }
      await requireCurrentRole(pool, req.user.organizationId, req.user.userId, ['owner'])
      next()
    } catch (err: unknown) {
      if (err instanceof OrganizationAccessError && err.statusCode === 403) {
        res.status(403).json({ success: false, message: forbiddenMessage })
        return
      }
      console.error('[aws] owner check error:', err)
      res.status(500).json({ success: false, message: 'Failed to verify permissions' })
    }
  }
}

const requireCurrentOwner = requireCurrentOwnerWith('Only an organization owner can connect an AWS account')

/** Check again is owner-only too (B4, approved copy). */
export const CHECK_AGAIN_FORBIDDEN_MESSAGE = 'Only an organization owner can check the AWS connection again.'
const requireCurrentOwnerForCheck = requireCurrentOwnerWith(CHECK_AGAIN_FORBIDDEN_MESSAGE)

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

/**
 * What the owner is told when the role check fails (connect-role-check.ts): an
 * HTTP status, a stable code and a fixed message. Never AWS's own text, which
 * names the platform's principal, and never the ExternalId.
 */
export const ROLE_CHECK_RESPONSES: Record<RoleCheckFailure, { status: number; code: string; message: string }> = {
  platform_unavailable: { status: 503, code: 'PLATFORM_AWS_UNAVAILABLE', message: PLATFORM_AWS_UNAVAILABLE_MESSAGE },
  role_not_assumable: {
    status: 422,
    code: 'ROLE_NOT_ASSUMABLE',
    message: "DevControl couldn't assume this role. If you just created it, AWS can take a minute to make it usable: wait a moment, then try again. If it still fails, check that the role's trust policy allows DevControl's AWS account with the External ID shown on this page, and that the Role ARN is from the AWS account you want to connect.",
  },
  aws_unavailable: {
    status: 503,
    code: 'AWS_UNAVAILABLE',
    message: "AWS didn't respond while we checked your role. Nothing was saved. Please try again in a minute.",
  },
  role_not_found: {
    status: 422,
    code: 'ROLE_NOT_FOUND',
    message: 'Role ARN not found — verify the ARN is correct and the role exists in your account.',
  },
  role_check_failed: {
    status: 422,
    code: 'ROLE_CHECK_FAILED',
    message: 'Could not assume this role. Check the trust policy and Role ARN, then try again.',
  },
  cancelled: {
    status: 503,
    code: 'CONNECT_CANCELLED',
    message: 'The connection check was cancelled. Nothing was saved.',
  },
}

/**
 * Admission for connect checks: one per organization, and a cap per PROCESS
 * (connect-check-slots.ts; not a platform-wide limit).
 */
const connectCheckSlots = new ConnectCheckSlots()

/** What the owner is told when a connect check is not admitted. */
export const CONNECT_SLOT_RESPONSES: Record<ConnectSlotRefusal, { status: number; code: string; message: string }> = {
  org_busy: {
    status: 409,
    code: 'CONNECT_CHECK_IN_PROGRESS',
    message: 'A connection check is already running for this workspace. Try again in a minute.',
  },
  at_capacity: {
    status: 503,
    code: 'CONNECT_CHECK_BUSY',
    message: 'DevControl is busy checking other connections. Nothing was saved. Try again in a minute.',
  },
}

/** A database failure before anything was saved: fixed text, the cause stays in the server log. */
export const CONNECT_STATE_UNAVAILABLE_MESSAGE = "We couldn't start the connection check. Nothing was saved. Please try again."

/**
 * Test seams for the connect flow's AWS calls. Production uses the defaults;
 * a suite sets them and restores them with resetConnectTestHooks().
 */
export const connectTestHooks: { roleCheckPolicy?: RoleCheckPolicy; probeClients?: ProbeClients; slots?: ConnectCheckSlots; iam?: IamSender } = {}
export function resetConnectTestHooks(): void {
  delete connectTestHooks.roleCheckPolicy
  delete connectTestHooks.probeClients
  delete connectTestHooks.slots
  delete connectTestHooks.iam
}

/** What the owner is told when the organization already has a connection (B1, approved copy). */
export const ALREADY_CONNECTED_MESSAGE = 'This organization already has a connected AWS account. To disconnect or change accounts, contact us.'

/** Check again (AWS connect PR D1), approved copy B5-B8. */
export const CHECK_AGAIN_MESSAGES = {
  cooldown: (time: string) => `DevControl checked this connection a few minutes ago. Try again after ${time}.`,
  connectionChanged: 'Your AWS connection changed while DevControl was checking it. Nothing was saved. Refresh the page.',
  roleRefused: "DevControl couldn't assume your role. Its health on this page now shows the failure.",
  awsUnavailable: "AWS didn't respond while we checked your role. Nothing was changed. Please try again in a minute.",
} as const

/** The IAM client the policy compare uses on a check's temporary credentials (IAM is global). */
function iamClientFor(credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string } | null): IamSender | null {
  if (connectTestHooks.iam) return connectTestHooks.iam
  if (!credentials) return null
  return new IAMClient({ region: 'us-east-1', credentials, maxAttempts: 1 })
}

/** The policy compare with a check's credentials; `unreadable` without them. Never throws. */
async function comparePoliciesWith(
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string } | null,
  account: { role_arn: string; account_id: string | null },
  context: string
): Promise<PolicyCompareResult> {
  const iam = iamClientFor(credentials)
  if (!iam) return { unreadable: true, contractVersion: 1 }
  return compareRolePolicies({ iam, roleArn: account.role_arn, accountId: account.account_id ?? '', context })
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
// Returns the organization's one stable External ID (aws-external-id.repository.ts),
// recorded on first use and never changed, and the trust policy built from it.
// Must be registered before GET /accounts to avoid shadowing.
router.get('/accounts/connect-init', requireCurrentOwner, async (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, no-store')
  const orgId = req.user!.organizationId

  // Without the platform account there is no trust policy to show: fail
  // before creating a session or recording the funnel event.
  const platformAccountId = platformAwsAccountId()
  if (!platformAccountId) {
    console.error('[connect-init] AWS_ACCOUNT_ID is missing or not a 12-digit AWS account ID; cannot build the trust policy')
    return res.status(500).json({ success: false, message: 'Failed to initialise connect session.' })
  }

  try {
    // The same value on every visit, so a role or stack built with it keeps
    // matching: it never expires and is never regenerated.
    const externalId = await resolveOrganizationExternalId(pool, orgId)

    // Funnel: the org has entered the AWS connection flow -- not that it
    // succeeded (that's aws_connection_completed, on POST /accounts).
    // trackFunnelEventOnce's own per-org dedup makes every later visit a no-op.
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
// Checks the role via STS with the organization's External ID, writes a row
// scoped to this org, then runs the permission check (a warning, never a block).
router.post('/accounts', requireCurrentOwner, async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId
  const { roleArn, nickname } = req.body

  const decodedRoleArn = roleArn
    ?.replace(/&#x2F;/g, '/')
    ?.replace(/&amp;/g, '&')
    ?.replace(/&lt;/g, '<')
    ?.replace(/&gt;/g, '>')

  if (!decodedRoleArn) {
    return res.status(400).json({ success: false, code: 'ROLE_ARN_REQUIRED', message: 'roleArn is required' })
  }
  const arnCheck = checkNewConnectionRoleArn(decodedRoleArn)
  if (!arnCheck.ok && arnCheck.reason === 'malformed') {
    return res.status(400).json({ success: false, code: 'ROLE_ARN_MALFORMED', message: 'Invalid Role ARN format. Expected: arn:aws:iam::123456789012:role/DevControlRole' })
  }
  if (!arnCheck.ok) {
    return res.status(422).json({
      success: false,
      code: 'ROLE_NAME_PREFIX',
      message: `The IAM role name must start with "${DEVCONTROL_ROLE_NAME_PREFIX}" (for example ${DEVCONTROL_ROLE_NAME_PREFIX} or ${DEVCONTROL_ROLE_NAME_PREFIX}-Prod) and the role must not use an IAM path. IAM roles can't be renamed, so create a new role with a matching name, then paste its ARN.`,
    })
  }
  const accountId = arnCheck.accountId

  // Admission before any AWS call: one check per organization -- the
  // authenticated one, from the verified token -- and a process-wide cap.
  // Released in finally on every outcome: success, error, timeout, disconnect.
  const admission = (connectTestHooks.slots ?? connectCheckSlots).tryAcquire(orgId)
  if (!admission.ok) {
    const response = CONNECT_SLOT_RESPONSES[admission.reason]
    return res.status(response.status).json({ success: false, code: response.code, message: response.message })
  }
  try {
    return await connectAdmitted(req, res, orgId, decodedRoleArn, accountId, nickname)
  } finally {
    admission.slot.release()
  }
})

/**
 * The connect flow once admitted. The request's pooled connection is given back
 * before the first AWS call and never held while waiting on AWS; each database
 * statement after that borrows a fresh connection tagged for this organization
 * and returns it at once (releaseRequestConnection, request-lifecycle.ts).
 */
async function connectAdmitted(req: Request, res: Response, orgId: string, decodedRoleArn: string, accountId: string, nickname: unknown) {
  // Already connected: refused before any AWS call (AWS connect PR D1, D1-D14).
  // "Any row" mirrors what the INSERT below conflicts on, the full UNIQUE(org_id)
  // (backend/migrations/020_add_org_id_and_connect_sessions.sql); C-2 must change
  // the two together. The INSERT's ON CONFLICT stays as the race backstop.
  try {
    const existing = await pool.query(`SELECT 1 FROM aws_accounts WHERE org_id = $1 LIMIT 1`, [orgId])
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, code: 'ALREADY_CONNECTED', message: ALREADY_CONNECTED_MESSAGE })
    }
  } catch (dbError: unknown) {
    console.error(`[Connect AWS] Could not read the connection state for org ${orgId}:`, dbError instanceof Error ? dbError.message : String(dbError))
    return res.status(500).json({ success: false, code: 'CONNECT_STATE_UNAVAILABLE', message: CONNECT_STATE_UNAVAILABLE_MESSAGE })
  }

  // The organization's one External ID: what connect-init showed and what the
  // role's trust policy must name. A database failure here is answered, never
  // left as an unhandled rejection.
  let externalId: string
  try {
    externalId = await resolveOrganizationExternalId(pool, orgId)
  } catch (dbError: unknown) {
    console.error(`[Connect AWS] Could not read the External ID for org ${orgId}:`, dbError instanceof Error ? dbError.message : String(dbError))
    return res.status(500).json({ success: false, code: 'CONNECT_STATE_UNAVAILABLE', message: CONNECT_STATE_UNAVAILABLE_MESSAGE })
  }

  // No pooled connection is held while AWS is called (up to ~25 s for the role
  // check, then the permission probes).
  releaseRequestConnection(res)

  // Stop retrying once the owner's browser has gone away.
  const cancel = new AbortController()
  const onClose = () => { if (!res.writableEnded) cancel.abort() }
  res.on('close', onClose)

  let roleCheck: Awaited<ReturnType<typeof checkConnectRole>>
  const roleCheckStartedAt = new Date()
  try {
    roleCheck = await checkConnectRole({
      region: process.env.AWS_REGION ?? 'us-east-1',
      roleArn: decodedRoleArn,
      externalId,
      context: `Connect AWS org ${orgId}`,
      signal: cancel.signal,
      policy: connectTestHooks.roleCheckPolicy,
    })
  } finally {
    res.off('close', onClose)
  }
  if (!roleCheck.ok) {
    const response = ROLE_CHECK_RESPONSES[roleCheck.failure]
    return res.status(response.status).json({ success: false, code: response.code, message: response.message })
  }

  // Persist with org_id.
  // ON CONFLICT (org_id) DO NOTHING + check rowCount → 409 if already connected.
  // A change of the active connection (AWS connect PR B): the INSERT runs under the
  // organization's connection lock taken EXCLUSIVE (aws-connection-fence.ts), so it
  // waits for every in-flight fenced write and every write fenced after it sees the
  // new connection. A lock wait past its limit fails like any save error (500,
  // SAVE_FAILED) and saves nothing.
  try {
    const result = await withConnectionChange(pool, orgId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO aws_accounts (org_id, role_arn, account_id, nickname, external_id, region, connected_at, status)
         VALUES ($1, $2, $3, $4, $5, 'us-east-1', NOW(), 'active')
         ON CONFLICT (org_id) DO NOTHING
         RETURNING id, org_id, account_id, role_arn, nickname, external_id, region, connected_at, status`,
        [orgId, decodedRoleArn, accountId, nickname ?? null, externalId]
      )
      // The connection's first health (ok) and its role ID baseline, in the same
      // transaction (AWS connect PR D1). Behind a savepoint: if it cannot be written
      // (the table not there yet, D1-D13), the connection is still saved.
      if (inserted.rows.length > 0) {
        await client.query('SAVEPOINT connection_checks')
        try {
          await applyAssumeOutcome(client, orgId, inserted.rows[0].id, {
            attempt: { at: roleCheckStartedAt, result: 'ok' },
            roleUniqueId: roleCheck.ok ? roleCheck.roleUniqueId : null,
            source: 'connect',
          })
          await client.query('RELEASE SAVEPOINT connection_checks')
        } catch (checksError: unknown) {
          await client.query('ROLLBACK TO SAVEPOINT connection_checks')
          logChecksWriteFailure('connect health', orgId, checksError)
        }
      }
      return inserted
    })

    if (result.rows.length === 0) {
      return res.status(409).json({ success: false, code: 'ALREADY_CONNECTED', message: ALREADY_CONNECTED_MESSAGE })
    }

    // Funnel: this INSERT's own ON CONFLICT (org_id) DO NOTHING + non-empty
    // RETURNING already guarantees this branch executes exactly once per
    // org (a second attempt hits the 409 above instead), so no additional
    // dedupe guard is needed.
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

    // Clean up a legacy connect session (aws_connect_sessions, written by the
    // release before the stable External ID) holding this value. A failure only
    // leaves a row nothing reads once the stable value exists -- log it (org id
    // and message only, never the ExternalId) and keep the 201.
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
    // A scan for this account already running (multi-region plan M4b, §4.6) is skipped.
    discoveryService.discoverAllResources(orgId).catch(err => {
      if (isScanAlreadyRunning(err)) {
        console.log(`[Connect AWS] Initial discovery skipped for org ${orgId}: a scan for this account is already running`)
        return
      }
      console.error(`[Connect AWS] Initial discovery failed for org ${orgId}:`, err)
    })

    // A warning for the owner, never a block: the connection is already saved.
    // The six probes and the policy compare run on the connect check's own
    // credentials, then are saved for the connection (CP-D3, CP-D4), fail-soft.
    const connected = result.rows[0]
    const checkedAt = new Date()
    const [permissionCheck, policyResult] = await Promise.all([
      runPermissionCheck({
        credentials: roleCheck.credentials,
        region: connected.region ?? 'us-east-1',
        context: `Connect AWS org ${orgId}`,
        clients: connectTestHooks.probeClients,
      }),
      comparePoliciesWith(roleCheck.credentials, connected, `Connect AWS org ${orgId}`),
    ])
    let checks = null
    try {
      await saveCheckResults(orgId, awsConnectionIdentity(connected), connected.id, {
        permission: { checks: permissionCheck.checks, at: checkedAt, trigger: 'connect' },
        policy: { result: policyResult, at: checkedAt, trigger: 'connect' },
      })
      checks = connectionChecksView(await readConnectionChecksOrNull(pool, orgId, connected.id), new Date())
    } catch (checksError: unknown) {
      logChecksWriteFailure('connect checks', orgId, checksError)
    }

    return res.status(201).json({
      success: true,
      data: connected,
      permissionCheck,
      checks,
      message: 'AWS account connected successfully',
    })
  } catch (dbError: any) {
    console.error('[aws/accounts POST]', dbError)
    return res.status(500).json({
      success: false,
      code: 'SAVE_FAILED',
      message: 'Account validated but could not be saved. Please try again.',
    })
  }
}

/**
 * Whether the caller is the organization's owner, by the same current-membership
 * check requireCurrentOwner applies. Only a 403 means "not the owner"; any other
 * failure is rethrown.
 */
async function isCurrentOwner(req: Request): Promise<boolean> {
  try {
    await requireCurrentRole(pool, req.user!.organizationId, req.user!.userId, ['owner'])
    return true
  } catch (err: unknown) {
    if (err instanceof OrganizationAccessError && err.statusCode === 403) return false
    throw err
  }
}

/**
 * Whether the organization has an active AWS connection, as the server decides it
 * for every scan, fence and cache (AWS connect PR B): its eligible aws_accounts
 * rows (findEligibleAwsAccount, status 'active').
 *
 *   connected      exactly one eligible row
 *   not_connected  none (no row, or only rows that are not eligible)
 *   ambiguous      more than one eligible row: nothing scans it (AWS_ACCOUNT_AMBIGUOUS)
 *
 * The state only: never a credential, External ID, role ARN or row id. Derived from
 * server state alone, never from the rows' count or from any AWS-derived data.
 */
export type AwsConnectionState = 'connected' | 'not_connected' | 'ambiguous'

async function readConnectionState(organizationId: string): Promise<{ state: AwsConnectionState; account: AwsAccountRow | null }> {
  try {
    const account = await findEligibleAwsAccount(pool, organizationId)
    return { state: account ? 'connected' : 'not_connected', account }
  } catch (err: unknown) {
    if (isAwsAccountAmbiguous(err)) return { state: 'ambiguous', account: null }
    throw err
  }
}

/**
 * The connected account's health summary for GET /accounts (`connection.health`):
 * the display state and the date it is "since" (failing/lost: failing since; ok and
 * stale: last checked). Absent when it cannot be read; it never fails the request.
 */
async function readHealthSummary(organizationId: string, account: AwsAccountRow): Promise<{ state: string; since: string | null } | undefined> {
  try {
    const health = connectionChecksView(await readConnectionChecksOrNull(pool, organizationId, account.id), new Date()).health
    const since = health.state === 'failing' || health.state === 'lost' ? health.failingSince : health.checkedAt
    return { state: health.state, since }
  } catch (err: unknown) {
    console.error('[aws/accounts GET] health not read:', err instanceof Error ? err.name : 'unknown error')
    return undefined
  }
}

/**
 * The organization's one eligible connection, or the response that ends the
 * request: 409 NOT_CONNECTED (none) or 409 AWS_ACCOUNT_AMBIGUOUS (more than one).
 */
async function eligibleAccountOrRespond(res: Response, organizationId: string): Promise<AwsAccountRow | null> {
  try {
    const account = await findEligibleAwsAccount(pool, organizationId)
    if (!account) {
      res.status(409).json({ success: false, code: AWS_NOT_CONNECTED_CODE, message: AWS_NOT_CONNECTED_MESSAGE })
      return null
    }
    return account
  } catch (err: unknown) {
    if (isAwsAccountAmbiguous(err)) {
      res.status(409).json({ success: false, code: 'AWS_ACCOUNT_AMBIGUOUS', message: AWS_ACCOUNT_AMBIGUOUS_MESSAGE })
      return null
    }
    throw err
  }
}

/** When the owner may start Check again next; null when now. */
function checkAgainAvailableAt(startedAt: Date | string | null | undefined, now: Date): string | null {
  if (!startedAt) return null
  const at = new Date(new Date(startedAt).getTime() + CHECK_AGAIN_COOLDOWN_MS)
  return at.getTime() > now.getTime() ? at.toISOString() : null
}

// GET /api/aws/accounts/checks (AWS connect PR D1)
// The connection's health, saved permission probes, policy compare, refused scan
// sources and role-replaced date, for any member. Fixed verdicts and dates only:
// never the role ID, a policy document, inline policy names or customer-managed
// ARNs. The owner also gets when Check again is next available.
router.get('/accounts/checks', async (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, no-store')
  const orgId = req.user!.organizationId
  try {
    const account = await eligibleAccountOrRespond(res, orgId)
    if (!account) return
    const row = await readConnectionChecksOrNull(pool, orgId, account.id)
    const now = new Date()
    const view = connectionChecksView(row, now)
    const owner = await isCurrentOwner(req)
    return res.json({
      success: true,
      data: owner ? { ...view, checkAgain: { availableAt: checkAgainAvailableAt(row?.check_again_started_at, now) } } : view,
    })
  } catch (err: unknown) {
    console.error('[aws/accounts/checks GET]', err instanceof Error ? err.name : 'unknown error')
    return res.status(500).json({ success: false, message: 'Failed to retrieve the AWS connection checks.' })
  }
})

/** The recorded result of a Check again AssumeRole that failed; null when nothing is recorded (platform, cancelled). */
const CHECK_AGAIN_RESULT: Record<RoleCheckFailure, AssumeResult | null> = {
  role_not_assumable: 'role_refused',
  role_not_found: 'role_not_found',
  role_check_failed: 'role_error',
  aws_unavailable: 'aws_unavailable',
  platform_unavailable: null,
  cancelled: null,
}

// POST /api/aws/accounts/check-again (AWS connect PR D1)
// Owner only. Re-runs, for the stored connection, the AssumeRole (recorded as
// health), the six probes (one is a Cost Explorer call AWS bills to the
// customer, USD 0.01) and the policy compare, then saves them in one fenced
// transaction. At most one start per connection every 5 minutes across every
// process (claimed in the database before any AWS call), and one check per
// organization at a time in this process (shared with connect).
router.post('/accounts/check-again', requireCurrentOwnerForCheck, async (req: Request, res: Response) => {
  const orgId = req.user!.organizationId
  const admission = (connectTestHooks.slots ?? connectCheckSlots).tryAcquire(orgId)
  if (!admission.ok) {
    const response = CONNECT_SLOT_RESPONSES[admission.reason]
    return res.status(response.status).json({ success: false, code: response.code, message: response.message })
  }
  try {
    return await checkAgainAdmitted(req, res, orgId)
  } finally {
    admission.slot.release()
  }
})

async function checkAgainAdmitted(req: Request, res: Response, orgId: string) {
  let account: AwsAccountRow | null
  let identity: string
  try {
    account = await eligibleAccountOrRespond(res, orgId)
    if (!account) return
    identity = awsConnectionIdentity(account)
    const claim = await claimCheckAgain(orgId, identity, account.id)
    if (!claim.ok) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((claim.availableAt.getTime() - Date.now()) / 1000))))
      return res.status(429).json({
        success: false,
        code: 'CHECK_COOLDOWN',
        message: CHECK_AGAIN_MESSAGES.cooldown(claim.availableAt.toISOString().slice(11, 16) + ' UTC'),
        availableAt: claim.availableAt.toISOString(),
      })
    }
  } catch (err: unknown) {
    if (isConnectionChanged(err)) {
      return res.status(409).json({ success: false, code: 'CONNECTION_CHANGED', message: CHECK_AGAIN_MESSAGES.connectionChanged })
    }
    console.error(`[Check again] Could not start for org ${orgId}:`, isChecksTableMissing(err) ? 'table_missing' : err instanceof Error ? err.name : 'unknown error')
    return res.status(500).json({ success: false, code: 'CONNECT_STATE_UNAVAILABLE', message: CONNECT_STATE_UNAVAILABLE_MESSAGE })
  }
  if (!account.external_id) {
    return res.status(409).json({ success: false, code: AWS_NOT_CONNECTED_CODE, message: AWS_NOT_CONNECTED_MESSAGE })
  }

  // No pooled connection is held while AWS is called.
  releaseRequestConnection(res)
  const cancel = new AbortController()
  const onClose = () => { if (!res.writableEnded) cancel.abort() }
  res.on('close', onClose)

  const startedAt = new Date()
  let roleCheck: Awaited<ReturnType<typeof checkConnectRole>>
  try {
    roleCheck = await checkConnectRole({
      region: process.env.AWS_REGION ?? 'us-east-1',
      roleArn: account.role_arn,
      externalId: account.external_id,
      context: `Check again org ${orgId}`,
      signal: cancel.signal,
      policy: connectTestHooks.roleCheckPolicy,
      sessionName: 'devcontrol-check',
    })
  } finally {
    res.off('close', onClose)
  }

  const fenceFailure = (err: unknown) => {
    if (isConnectionChanged(err)) {
      return res.status(409).json({ success: false, code: 'CONNECTION_CHANGED', message: CHECK_AGAIN_MESSAGES.connectionChanged })
    }
    logChecksWriteFailure('check again', orgId, err)
    return res.status(500).json({ success: false, code: 'CONNECT_STATE_UNAVAILABLE', message: CONNECT_STATE_UNAVAILABLE_MESSAGE })
  }

  if (!roleCheck.ok) {
    const result = CHECK_AGAIN_RESULT[roleCheck.failure]
    if (result) {
      try {
        await saveCheckResults(orgId, identity, account.id, { outcome: { attempt: { at: startedAt, result }, source: 'check_again' } })
      } catch (err: unknown) {
        return fenceFailure(err)
      }
    }
    const base = ROLE_CHECK_RESPONSES[roleCheck.failure]
    const message =
      roleCheck.failure === 'aws_unavailable' ? CHECK_AGAIN_MESSAGES.awsUnavailable
        : result && result !== 'aws_unavailable' ? CHECK_AGAIN_MESSAGES.roleRefused
          : base.message
    return res.status(base.status).json({ success: false, code: base.code, message })
  }

  const checkedAt = new Date()
  const [permissionCheck, policyResult] = await Promise.all([
    runPermissionCheck({
      credentials: roleCheck.credentials,
      region: account.region ?? 'us-east-1',
      context: `Check again org ${orgId}`,
      clients: connectTestHooks.probeClients,
    }),
    comparePoliciesWith(roleCheck.credentials, account, `Check again org ${orgId}`),
  ])
  try {
    await saveCheckResults(orgId, identity, account.id, {
      outcome: { attempt: { at: startedAt, result: 'ok' }, roleUniqueId: roleCheck.roleUniqueId, source: 'check_again' },
      permission: { checks: permissionCheck.checks, at: checkedAt, trigger: 'check_again' },
      policy: { result: policyResult, at: checkedAt, trigger: 'check_again' },
    })
  } catch (err: unknown) {
    return fenceFailure(err)
  }

  // Never the role ARN, the External ID or any AWS value.
  await auditEvents.record({
    organizationId: orgId,
    actorId: req.user!.userId,
    action: 'aws_account.checked',
    resourceType: 'aws_account',
    resourceId: null,
    metadata: { awsAccountId: account.account_id },
    request: auditRequestContext(req),
  })

  const now = new Date()
  const row = await readConnectionChecksOrNull(pool, orgId, account.id)
  return res.json({
    success: true,
    data: { ...connectionChecksView(row, now), checkAgain: { availableAt: checkAgainAvailableAt(row?.check_again_started_at, now) } },
  })
}

// GET /api/aws/accounts
// Returns only the accounts belonging to the calling org. external_id is
// included for the owner only; for every other role the field is absent.
// `connection` (readConnectionState) is the server's own answer to "is AWS
// connected": consumers use it, never `data.length`.
// The response depends on the caller, so it is never stored.
router.get('/accounts', async (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, no-store')
  try {
    const result = await pool.query(
      `SELECT id, org_id, account_id, role_arn, nickname, external_id, region, connected_at, status
       FROM aws_accounts
       WHERE org_id = $1
       ORDER BY connected_at DESC`,
      [req.user!.organizationId]
    )
    const owner = await isCurrentOwner(req)
    const data = owner
      ? result.rows
      : result.rows.map(({ external_id: _externalId, ...account }) => account)
    const { state, account } = await readConnectionState(req.user!.organizationId)
    const health = state === 'connected' && account ? await readHealthSummary(req.user!.organizationId, account) : undefined
    const connection = health ? { state, health } : { state }
    return res.json({ success: true, data, connection })
  } catch (err: any) {
    console.error('[aws/accounts GET]', err)
    return res.status(500).json({ success: false, message: 'Failed to retrieve AWS accounts.' })
  }
})

export default router