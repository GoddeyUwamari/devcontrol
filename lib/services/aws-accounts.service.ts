import api, { handleApiResponse } from '@/lib/api'

export interface AwsAccount {
  id: number
  org_id: string
  account_id: string
  role_arn: string
  nickname: string | null
  /** Present for the organization owner only; absent for every other role. */
  external_id?: string | null
  region: string
  connected_at: string
  status: string
}

export interface ConnectInitData {
  externalId: string
  platformAccountId: string
  trustPolicy: object
  /**
   * The CloudFormation quick-create link, template version and hosted template URL, sent only
   * when the server switch is on and the template configuration is valid (AWS connect PR D2).
   * Otherwise absent, and the Connect AWS page's CloudFormation card stays hidden. The page
   * checks both URLs before rendering them (connect-aws/launchStackUrl.ts).
   */
  launchStack?: { url: string; templateVersion: string; templateUrl?: string }
}

export interface ConnectAwsPayload {
  roleArn: string
  nickname?: string
}

/** One operation the post-connect permission check tested (backend connect-permission-check.ts). */
export type PermissionCheckStatus = 'verified' | 'denied' | 'not_verified'
export interface PermissionCheckEntry {
  action: string
  status: PermissionCheckStatus
}
export interface PermissionCheckReport {
  checks: PermissionCheckEntry[]
}

export interface ConnectAwsResult {
  account: AwsAccount
  /** Absent only from a server older than the permission check. */
  permissionCheck: PermissionCheckReport | null
}

/**
 * Whether the organization has an active AWS connection, as the server decides
 * it (GET /api/aws/accounts `connection.state`, backend routes/aws.routes.ts
 * readConnectionState): exactly one eligible ('active') aws_accounts row.
 *
 *   connected      the one active connection exists
 *   not_connected  none: no row, or only rows that are not active
 *   ambiguous      more than one active row: the server scans none of them
 *
 * Never derived from how many rows the list has, nor from any AWS-derived data
 * (stats, resources, spend): historical data left from an earlier connection
 * says nothing about the current one.
 */
export type AwsConnectionState = 'connected' | 'not_connected' | 'ambiguous'

export interface AwsAccountsAndConnection {
  accounts: AwsAccount[]
  connection: AwsConnectionState
  /** `connection.health` (AWS connect PR D1); null from a server without it, or when it couldn't be read. */
  health?: ConnectionHealthSummary | null
}

const CONNECTION_STATES: readonly string[] = ['connected', 'not_connected', 'ambiguous']

/**
 * The connection's health as the server displays it (backend services/connection-health.ts
 * displayHealth). `not_checked_recently` overrides every stored state once the last conclusive
 * check is more than 24 h old, so `ok` is always fresh.
 */
export type ConnectionHealthState = 'ok' | 'failing' | 'lost' | 'not_checked_recently' | 'not_checked_yet'
const HEALTH_STATES: readonly string[] = ['ok', 'failing', 'lost', 'not_checked_recently', 'not_checked_yet']

/** GET /api/aws/accounts `connection.health`: the display state and its date. */
export interface ConnectionHealthSummary {
  state: ConnectionHealthState
  since: string | null
}

const isDateOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)))

/**
 * `connection.health` of a GET /api/aws/accounts body. Null when absent (a server from
 * before PR D1, or a health row that couldn't be read) or not recognized: the caller
 * then shows what it showed before D1, never an error.
 */
export function parseConnectionHealth(connection: unknown): ConnectionHealthSummary | null {
  const health = (connection as { health?: unknown } | null | undefined)?.health as { state?: unknown; since?: unknown } | null | undefined
  if (!health || typeof health.state !== 'string' || !HEALTH_STATES.includes(health.state)) return null
  const since = health.since ?? null
  if (!isDateOrNull(since)) return null
  return { state: health.state as ConnectionHealthState, since }
}

/** One listing a scan was refused (backend aws-connection-checks.repository.ts SAVED_SCAN_SOURCES). */
export interface RefusedSource {
  source: string
  action: string
}

export type PolicyCheck =
  | {
      unreadable: false
      securityAudit: 'attached' | 'missing'
      viewOnlyAccess: 'attached' | 'missing'
      readExtras: 'matches' | 'differs' | 'missing' | 'unreadable'
      readOnlyAccess: boolean
      /** Other AWS-managed policies, by their public names. */
      otherAwsManaged: string[]
      /** Customer-managed and other inline policies: a count only, never their names. */
      otherCount: number
      checkedAt: string
    }
  | { unreadable: true; checkedAt: string }

/**
 * GET /api/aws/accounts/checks (AWS connect PR D1): fixed verdicts and dates only. The server
 * never sends the role ID, a policy document, inline policy names or customer-managed ARNs,
 * and this type has no place for them.
 */
export interface ConnectionChecks {
  health: {
    state: ConnectionHealthState
    /** The stored result named when stale; null when never checked. */
    lastResult: 'ok' | 'failing' | 'lost' | null
    checkedAt: string | null
    failingSince: string | null
  }
  roleReplacedAt: string | null
  permissionCheck: { checks: PermissionCheckEntry[]; checkedAt: string } | null
  policyCheck: PolicyCheck | null
  refusedSources: { scannedAt: string; sources: RefusedSource[] } | null
  /** Present for the organization owner only: when Check again is next available (null: now). */
  checkAgain?: { availableAt: string | null }
}

/** What a 409 NOT_CONNECTED from /checks means: the server has no checks for an eligible connection. */
export const NO_CONNECTION_CHECKS: ConnectionChecks = {
  health: { state: 'not_checked_yet', lastResult: null, checkedAt: null, failingSince: null },
  roleReplacedAt: null,
  permissionCheck: null,
  policyCheck: null,
  refusedSources: null,
}

const LAST_RESULTS: readonly string[] = ['ok', 'failing', 'lost']
const PERMISSION_STATUSES: readonly string[] = ['verified', 'denied', 'not_verified']
const ATTACHED: readonly string[] = ['attached', 'missing']
const READ_EXTRAS: readonly string[] = ['matches', 'differs', 'missing', 'unreadable']

/** The date a display state needs (null: none), so a state is never shown without it. */
function healthDateFor(state: string, health: Record<string, unknown>): unknown {
  if (state === 'failing' || state === 'lost') return health.failingSince
  if (state === 'ok' || state === 'not_checked_recently') return health.checkedAt
  return null
}

/**
 * Only the fields the page renders, each checked; anything unrecognized is null (or the whole
 * body is, when the health itself isn't recognized), never a guess.
 */
export function parseConnectionChecks(body: unknown): ConnectionChecks | null {
  if (!body || typeof body !== 'object') return null
  const data = body as Record<string, unknown>
  const health = (data.health ?? null) as Record<string, unknown> | null
  if (!health || typeof health.state !== 'string' || !HEALTH_STATES.includes(health.state)) return null
  const state = health.state as ConnectionHealthState
  const lastResult = health.lastResult ?? null
  if (lastResult !== null && !(typeof lastResult === 'string' && LAST_RESULTS.includes(lastResult))) return null
  if (state === 'not_checked_recently' && lastResult === null) return null
  const checkedAt = health.checkedAt ?? null
  const failingSince = health.failingSince ?? null
  if (!isDateOrNull(checkedAt) || !isDateOrNull(failingSince)) return null
  if (state !== 'not_checked_yet' && healthDateFor(state, { checkedAt, failingSince }) === null) return null

  const roleReplacedAt = isDateOrNull(data.roleReplacedAt ?? null) ? ((data.roleReplacedAt as string | null | undefined) ?? null) : null

  const permission = data.permissionCheck as { checks?: unknown; checkedAt?: unknown } | null | undefined
  const permissionCheck =
    permission && Array.isArray(permission.checks) && typeof permission.checkedAt === 'string' && isDateOrNull(permission.checkedAt)
      ? {
          checks: permission.checks
            .filter((c): c is PermissionCheckEntry =>
              !!c && typeof (c as PermissionCheckEntry).action === 'string' && PERMISSION_STATUSES.includes((c as PermissionCheckEntry).status))
            .map(({ action, status }) => ({ action, status })),
          checkedAt: permission.checkedAt,
        }
      : null

  const policy = data.policyCheck as Record<string, unknown> | null | undefined
  let policyCheck: PolicyCheck | null = null
  if (policy && typeof policy.checkedAt === 'string' && isDateOrNull(policy.checkedAt)) {
    if (policy.unreadable === true) {
      policyCheck = { unreadable: true, checkedAt: policy.checkedAt }
    } else if (
      typeof policy.securityAudit === 'string' && ATTACHED.includes(policy.securityAudit)
      && typeof policy.viewOnlyAccess === 'string' && ATTACHED.includes(policy.viewOnlyAccess)
      && typeof policy.readExtras === 'string' && READ_EXTRAS.includes(policy.readExtras)
    ) {
      policyCheck = {
        unreadable: false,
        securityAudit: policy.securityAudit as 'attached' | 'missing',
        viewOnlyAccess: policy.viewOnlyAccess as 'attached' | 'missing',
        readExtras: policy.readExtras as 'matches' | 'differs' | 'missing' | 'unreadable',
        readOnlyAccess: policy.readOnlyAccess === true,
        otherAwsManaged: Array.isArray(policy.otherAwsManaged) ? policy.otherAwsManaged.filter((n): n is string => typeof n === 'string') : [],
        otherCount: typeof policy.otherCount === 'number' && Number.isInteger(policy.otherCount) && policy.otherCount > 0 ? policy.otherCount : 0,
        checkedAt: policy.checkedAt,
      }
    }
  }

  const refused = data.refusedSources as { scannedAt?: unknown; sources?: unknown } | null | undefined
  const refusedSources =
    refused && typeof refused.scannedAt === 'string' && isDateOrNull(refused.scannedAt) && Array.isArray(refused.sources)
      ? {
          scannedAt: refused.scannedAt,
          sources: refused.sources
            .filter((s): s is RefusedSource => !!s && typeof (s as RefusedSource).source === 'string' && typeof (s as RefusedSource).action === 'string')
            .map(({ source, action }) => ({ source, action })),
        }
      : null

  const checks: ConnectionChecks = {
    health: { state, lastResult: lastResult as ConnectionChecks['health']['lastResult'], checkedAt, failingSince },
    roleReplacedAt,
    permissionCheck,
    policyCheck,
    refusedSources,
  }
  const checkAgain = data.checkAgain as { availableAt?: unknown } | null | undefined
  if (checkAgain && typeof checkAgain === 'object') {
    const availableAt = checkAgain.availableAt ?? null
    checks.checkAgain = { availableAt: isDateOrNull(availableAt) ? availableAt : null }
  }
  return checks
}

/** The HTTP status and body of a failed request (axios shape), or null when there was no response. */
function errorResponse(err: unknown): { status?: number; data?: { code?: unknown } } | null {
  return (err as { response?: { status?: number; data?: { code?: unknown } } } | null)?.response ?? null
}

/**
 * The connection state of a GET /api/aws/accounts body. A server from before the
 * `connection` field (a deploy where this frontend ships first) is answered by
 * the same rule from its rows' own status: exactly one 'active' row. Anything
 * else is an error, never "not connected".
 */
export function parseAwsConnection(connection: unknown, accounts: unknown): AwsConnectionState {
  const state = (connection as { state?: unknown } | null | undefined)?.state
  if (typeof state === 'string' && CONNECTION_STATES.includes(state)) return state as AwsConnectionState
  if (connection !== undefined) throw new Error('The AWS connection state was not recognized')
  if (!Array.isArray(accounts)) throw new Error('The AWS accounts response was not a list')
  const active = accounts.filter((account) => (account as { status?: unknown } | null)?.status === 'active').length
  return active === 0 ? 'not_connected' : active === 1 ? 'connected' : 'ambiguous'
}

const awsAccountsService = {
  async connectInit(): Promise<ConnectInitData> {
    const response = await api.get<{ success: boolean; data: ConnectInitData }>(
      '/api/aws/accounts/connect-init'
    )
    return handleApiResponse(response)
  },

  async connect(payload: ConnectAwsPayload): Promise<ConnectAwsResult> {
    const response = await api.post<{ success: boolean; data: AwsAccount; message: string; permissionCheck?: PermissionCheckReport }>(
      '/api/aws/accounts',
      payload
    )
    const account = handleApiResponse(response)
    return { account, permissionCheck: response.data.permissionCheck ?? null }
  },

  /** The organization's account rows and the server's connection state (parseAwsConnection). */
  async getAccountsAndConnection(): Promise<AwsAccountsAndConnection> {
    const response = await api.get<{ success: boolean; data: AwsAccount[]; connection?: unknown }>(
      '/api/aws/accounts'
    )
    const accounts = handleApiResponse(response)
    return {
      accounts,
      connection: parseAwsConnection(response.data.connection, accounts),
      health: parseConnectionHealth(response.data.connection),
    }
  },

  /**
   * The connection's saved checks (GET /api/aws/accounts/checks, AWS connect PR D1).
   *   - 409 NOT_CONNECTED: no eligible connection, so no checks yet (NO_CONNECTION_CHECKS);
   *   - 404 (a server from before PR D1) or a body that isn't recognized: null, and the page
   *     shows what it showed before D1;
   *   - anything else throws.
   */
  async getConnectionChecks(): Promise<ConnectionChecks | null> {
    try {
      const response = await api.get<{ success: boolean; data: unknown }>('/api/aws/accounts/checks')
      return parseConnectionChecks(handleApiResponse(response))
    } catch (err: unknown) {
      const response = errorResponse(err)
      if (response?.status === 409 && response.data?.code === 'NOT_CONNECTED') return NO_CONNECTION_CHECKS
      if (response?.status === 404) return null
      throw err
    }
  },

  /** Check again (owner only): the saved checks after it ran. A refusal throws the axios error. */
  async checkAgain(): Promise<ConnectionChecks | null> {
    const response = await api.post<{ success: boolean; data: unknown }>('/api/aws/accounts/check-again')
    return parseConnectionChecks(handleApiResponse(response))
  },
}

export default awsAccountsService
