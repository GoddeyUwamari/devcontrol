/**
 * The GitHub connection's hand-off state, kept for this tab only
 * (sessionStorage), like lib/pending-invitation.ts:
 *
 * - the install start: the `state` POST /install returned, saved before the
 *   tab goes to GitHub, because GitHub may not echo it back (V1). At most 15
 *   minutes old, the state's own life on the server.
 * - the parked callback: what GitHub sent to /auth/github/callback (code,
 *   installation id, setup action, state), taken out of the URL there and
 *   kept until the GitHub page runs the claim. At most 10 minutes old, the
 *   OAuth code's life. Taken once: reading it removes it.
 *
 * Neither is ever put into a URL, a return path or a log. Both are removed on
 * logout. An expired or malformed entry is removed when read.
 *
 * I3 reconnect (founder D1, D3): the start can instead be a reconnect start,
 * which also keeps the installation id and the PKCE verifier POST /reconnect
 * returned (this tab only; sent once, with the claim). GitHub's authorize
 * redirect brings `code` and `state` without an installation id, or `error`;
 * those are parked only while this tab has a reconnect start, so the
 * first-install flow parks exactly what it did before. `error` is kept as one
 * of four fixed values; error_description is never stored or shown.
 */

export const GITHUB_INSTALL_START_KEY = 'githubInstallStart'
export const GITHUB_PARKED_CALLBACK_KEY = 'pendingGitHubClaim'

export const INSTALL_START_MAX_AGE_MS = 15 * 60 * 1000
export const PARKED_CALLBACK_MAX_AGE_MS = 10 * 60 * 1000

/** The shapes the server accepts (backend claimBody); anything else is never stored or sent. */
export const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const CODE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
export const INSTALLATION_ID_PATTERN = /^[1-9][0-9]{0,18}$/
export const SETUP_ACTIONS = ['install', 'update', 'request'] as const
export type SetupAction = (typeof SETUP_ACTIONS)[number]
/** A PKCE code verifier (backend CODE_VERIFIER_PATTERN). */
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/
/** GitHub's authorize errors the screen tells apart; any other error is 'other'. */
export const CALLBACK_ERRORS = ['access_denied', 'redirect_uri_mismatch', 'application_suspended', 'other'] as const
export type CallbackError = (typeof CALLBACK_ERRORS)[number]

export interface InstallStart {
  state: string
  organizationId: string
  startedAt: number
}

/** I3: a reconnect start (POST /reconnect), with what the claim sends back. */
export interface ReconnectStart extends InstallStart {
  mode: 'reconnect'
  installationId: string
  codeVerifier: string
}

export interface ParkedCallback {
  code?: string
  installationId?: string
  setupAction?: SetupAction
  state?: string
  /** I3: the authorize redirect's error, as one of CALLBACK_ERRORS. */
  error?: CallbackError
  savedAt: number
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the flow falls back to the server's own answers.
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Blocked storage holds nothing to clear.
  }
}

function read(key: string): unknown {
  try {
    const raw = storage()?.getItem(key) ?? null
    return raw === null ? null : JSON.parse(raw)
  } catch {
    remove(key)
    return null
  }
}

const fresh = (savedAt: unknown, maxAge: number, now: number) =>
  typeof savedAt === 'number' && savedAt <= now && now - savedAt < maxAge

export function saveInstallStart(state: string, organizationId: string, now: number = Date.now()): void {
  if (!STATE_PATTERN.test(state)) return
  write(GITHUB_INSTALL_START_KEY, { state, organizationId, startedAt: now } satisfies InstallStart)
}

/** I3: a reconnect start replaces any install start in this tab (one hand-off at a time). */
export function saveReconnectStart(
  start: { state: string; organizationId: string; installationId: string; codeVerifier: string },
  now: number = Date.now()
): boolean {
  if (!STATE_PATTERN.test(start.state) || !INSTALLATION_ID_PATTERN.test(start.installationId) || !CODE_VERIFIER_PATTERN.test(start.codeVerifier) || !start.organizationId) {
    return false
  }
  write(GITHUB_INSTALL_START_KEY, { ...start, mode: 'reconnect', startedAt: now } satisfies ReconnectStart)
  return true
}

/**
 * The install or reconnect start, or null (an expired or malformed entry is
 * removed). A reconnect start missing its installation id or verifier is
 * malformed.
 */
export function readInstallStart(now: number = Date.now()): InstallStart | ReconnectStart | null {
  const entry = read(GITHUB_INSTALL_START_KEY) as Partial<ReconnectStart> | null
  if (entry === null) return null
  if (
    typeof entry === 'object' &&
    typeof entry.state === 'string' && STATE_PATTERN.test(entry.state) &&
    typeof entry.organizationId === 'string' && entry.organizationId.length > 0 &&
    fresh(entry.startedAt, INSTALL_START_MAX_AGE_MS, now)
  ) {
    const base = { state: entry.state, organizationId: entry.organizationId, startedAt: entry.startedAt as number }
    if (entry.mode === undefined) return base
    if (
      entry.mode === 'reconnect' &&
      typeof entry.installationId === 'string' && INSTALLATION_ID_PATTERN.test(entry.installationId) &&
      typeof entry.codeVerifier === 'string' && CODE_VERIFIER_PATTERN.test(entry.codeVerifier)
    ) {
      return { ...base, mode: 'reconnect', installationId: entry.installationId, codeVerifier: entry.codeVerifier }
    }
  }
  remove(GITHUB_INSTALL_START_KEY)
  return null
}

/** Whether this tab started a reconnect (fresh or not: the GitHub page decides what an old one means). */
function reconnectStarted(): boolean {
  const entry = read(GITHUB_INSTALL_START_KEY) as { mode?: unknown } | null
  return entry !== null && typeof entry === 'object' && entry.mode === 'reconnect'
}

const callbackError = (value: string): CallbackError =>
  ((CALLBACK_ERRORS as readonly string[]).includes(value) ? value : 'other') as CallbackError

export function clearInstallStart(): void {
  remove(GITHUB_INSTALL_START_KEY)
}

/**
 * Keeps what the callback received, after checking each value's shape. A value
 * of the wrong shape is dropped (never stored). Returns whether anything usable
 * was kept: a code with an installation id, or a setup action of 'request';
 * and, only while this tab has a reconnect start (I3), a code alone (GitHub's
 * authorize redirect) or an error.
 */
export function parkCallback(
  values: { code?: string; installation_id?: string; setup_action?: string; state?: string; error?: string },
  now: number = Date.now()
): boolean {
  const parked: ParkedCallback = { savedAt: now }
  if (values.code && CODE_PATTERN.test(values.code)) parked.code = values.code
  if (values.installation_id && INSTALLATION_ID_PATTERN.test(values.installation_id)) parked.installationId = values.installation_id
  if (values.setup_action && (SETUP_ACTIONS as readonly string[]).includes(values.setup_action)) parked.setupAction = values.setup_action as SetupAction
  if (values.state && STATE_PATTERN.test(values.state)) parked.state = values.state
  const installUsable = (parked.code !== undefined && parked.installationId !== undefined) || parked.setupAction === 'request'
  let usable = installUsable
  if (!installUsable && reconnectStarted()) {
    if (values.error) {
      parked.error = callbackError(values.error)
      delete parked.code
    }
    usable = parked.error !== undefined || (parked.code !== undefined && parked.installationId === undefined && parked.setupAction === undefined)
  }
  if (!usable) return false
  write(GITHUB_PARKED_CALLBACK_KEY, parked)
  return true
}

/** The parked callback, removed as it is read (single use), or null. */
export function takeParkedCallback(now: number = Date.now()): ParkedCallback | null {
  const entry = read(GITHUB_PARKED_CALLBACK_KEY) as Partial<ParkedCallback> | null
  remove(GITHUB_PARKED_CALLBACK_KEY)
  if (entry === null || typeof entry !== 'object' || !fresh(entry.savedAt, PARKED_CALLBACK_MAX_AGE_MS, now)) return null
  const parked: ParkedCallback = { savedAt: entry.savedAt as number }
  if (typeof entry.code === 'string' && CODE_PATTERN.test(entry.code)) parked.code = entry.code
  if (typeof entry.installationId === 'string' && INSTALLATION_ID_PATTERN.test(entry.installationId)) parked.installationId = entry.installationId
  if (typeof entry.setupAction === 'string' && (SETUP_ACTIONS as readonly string[]).includes(entry.setupAction)) parked.setupAction = entry.setupAction
  if (typeof entry.state === 'string' && STATE_PATTERN.test(entry.state)) parked.state = entry.state
  if (typeof entry.error === 'string' && (CALLBACK_ERRORS as readonly string[]).includes(entry.error)) parked.error = entry.error
  return parked
}

/** Whether a parked callback is waiting (without taking it). */
export function hasParkedCallback(now: number = Date.now()): boolean {
  const entry = read(GITHUB_PARKED_CALLBACK_KEY) as Partial<ParkedCallback> | null
  return entry !== null && typeof entry === 'object' && fresh(entry.savedAt, PARKED_CALLBACK_MAX_AGE_MS, now)
}

/** Logout: nothing of a GitHub hand-off survives into the next session in this tab. */
export function clearGitHubConnectionState(): void {
  remove(GITHUB_INSTALL_START_KEY)
  remove(GITHUB_PARKED_CALLBACK_KEY)
}
