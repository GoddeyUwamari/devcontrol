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

export interface InstallStart {
  state: string
  organizationId: string
  startedAt: number
}

export interface ParkedCallback {
  code?: string
  installationId?: string
  setupAction?: SetupAction
  state?: string
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

/** The install start, or null (an expired or malformed entry is removed). */
export function readInstallStart(now: number = Date.now()): InstallStart | null {
  const entry = read(GITHUB_INSTALL_START_KEY) as Partial<InstallStart> | null
  if (entry === null) return null
  if (
    typeof entry === 'object' &&
    typeof entry.state === 'string' && STATE_PATTERN.test(entry.state) &&
    typeof entry.organizationId === 'string' && entry.organizationId.length > 0 &&
    fresh(entry.startedAt, INSTALL_START_MAX_AGE_MS, now)
  ) {
    return { state: entry.state, organizationId: entry.organizationId, startedAt: entry.startedAt as number }
  }
  remove(GITHUB_INSTALL_START_KEY)
  return null
}

export function clearInstallStart(): void {
  remove(GITHUB_INSTALL_START_KEY)
}

/**
 * Keeps what the callback received, after checking each value's shape. A value
 * of the wrong shape is dropped (never stored). Returns whether anything usable
 * was kept: a code with an installation id, or a setup action of 'request'.
 */
export function parkCallback(
  values: { code?: string; installation_id?: string; setup_action?: string; state?: string },
  now: number = Date.now()
): boolean {
  const parked: ParkedCallback = { savedAt: now }
  if (values.code && CODE_PATTERN.test(values.code)) parked.code = values.code
  if (values.installation_id && INSTALLATION_ID_PATTERN.test(values.installation_id)) parked.installationId = values.installation_id
  if (values.setup_action && (SETUP_ACTIONS as readonly string[]).includes(values.setup_action)) parked.setupAction = values.setup_action as SetupAction
  if (values.state && STATE_PATTERN.test(values.state)) parked.state = values.state
  const usable = (parked.code !== undefined && parked.installationId !== undefined) || parked.setupAction === 'request'
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
