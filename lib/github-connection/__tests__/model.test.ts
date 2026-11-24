/**
 * D8b-1 rules: every claim answer's outcome (board 4), the index card's state
 * (board 1), banners (board 6), and the copy rules (founder, Nov 23).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bannersFor, cardState, claimOutcome, connectedLine, isRecording } from '../model'
import { COPY, installationSettingsUrl, permissionsNowHave, relativeTime, shortName } from '../copy'
import type { GitHubInstallation, GitHubRepository } from '../../services/github-connection.service'

const install = (over: Partial<GitHubInstallation> = {}): GitHubInstallation => ({
  installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', repository_selection: 'selected',
  permissions_state: 'expected', permission_differences: [], claimed_at: '2026-11-24T10:00:00.000Z', claimed_by_name: 'Goddey Uwamari',
  suspended_at: null, deleted_at: null, ...over,
})
const repo = (over: Partial<GitHubRepository> = {}): GitHubRepository => ({
  id: 'r1', github_repo_id: '1', installation_id: '42', full_name: 'acme-inc/api', service_id: null, service_name: null,
  deploy_rule: null, access_state: 'active', removed_at: null, last_event_at: null, ...over,
})
const answer = (status: number, body: Record<string, unknown>) => ({ status, body })

describe('claim answers -> board 4 outcomes (every code the server sends)', () => {
  it.each([
    [200, { success: true, data: { status: 'connected', installation: { account_login: 'acme-inc' } } }, { kind: 'connected', account: 'acme-inc' }],
    [200, { success: true, data: { status: 'already_connected' } }, { kind: 'already_connected' }],
    [200, { success: true, data: { status: 'pending_github_approval' } }, { kind: 'approval_requested' }],
    [202, { success: true, data: { status: 'waiting_for_github' } }, { kind: 'waiting' }],
    [400, { success: false, error: 'invalid_state' }, { kind: 'expired' }],
    [400, { success: false, error: 'missing_code_or_installation' }, { kind: 'expired' }],
    [400, { success: false, error: 'invalid_request' }, { kind: 'expired' }],
    [403, { success: false, error: 'installation_not_accessible' }, { kind: 'installer_mismatch' }],
    [403, { success: false, error: 'not_installer' }, { kind: 'installer_mismatch' }],
    [403, { success: false, error: 'github_authorization_failed' }, { kind: 'installer_mismatch' }],
    [403, { success: false, error: 'Insufficient permissions' }, { kind: 'not_allowed' }],
    [403, { success: false, error: 'not_available_in_demo' }, { kind: 'demo' }],
    [409, { success: false, error: 'installation_claimed_elsewhere' }, { kind: 'elsewhere' }],
    [409, { success: false, error: 'install_event_not_received', message: 'Reinstall it.' }, { kind: 'install_event_missing', message: 'Reinstall it.' }],
    [502, { success: false, error: 'github_unavailable' }, { kind: 'no_response', canRetry: false }],
    [503, { success: false, error: 'github_app_not_configured' }, { kind: 'off' }],
    [500, { success: false, error: 'Internal' }, { kind: 'failed' }],
    [0, {}, { kind: 'failed' }],
  ])('%i %j', (status, body, expected) => {
    expect(claimOutcome(answer(status, body), false)).toEqual(expected)
  })

  it('a 502 after a 202 can still be retried (RC-O2)', () => {
    expect(claimOutcome(answer(502, { error: 'github_unavailable' }), true)).toEqual({ kind: 'no_response', canRetry: true })
  })
})

describe('index card state (board 1)', () => {
  const on = (installations: GitHubInstallation[], demo = false) => ({ configured: true as const, can_manage: true, demo, installations, last_event_at: null })
  it('off, not connected, connected, needs attention, demo', () => {
    expect(cardState({ configured: false })).toBe('off')
    expect(cardState(on([]))).toBe('not_connected')
    expect(cardState(on([install()]))).toBe('connected')
    expect(cardState(on([install({ suspended_at: '2026-11-24T00:00:00Z' })]))).toBe('attention')
    expect(cardState(on([install({ deleted_at: '2026-11-24T00:00:00Z' })]))).toBe('attention')
    expect(cardState(on([install({ permissions_state: 'mismatch' })]))).toBe('attention')
    expect(cardState(on([], true))).toBe('demo')
  })

  it('"{account} · 4 repositories · 3 recording": detached and removed repositories are not counted; recording needs a service and a rule', () => {
    const repos = [
      repo({ id: 'a', service_id: 's', deploy_rule: { mode: 'job' } }),
      repo({ id: 'b', service_id: 's', deploy_rule: { mode: 'github_deployments' } }),
      repo({ id: 'c', service_id: 's', deploy_rule: { mode: 'none' } }),
      repo({ id: 'd' }),
      repo({ id: 'e', access_state: 'removed', service_id: 's', deploy_rule: { mode: 'job' } }),
      repo({ id: 'f', installation_id: null, service_id: 's', deploy_rule: { mode: 'job' } }),
    ]
    expect(connectedLine(on([install()]), repos)).toBe('acme-inc · 4 repositories · 2 recording')
    expect(connectedLine(on([install()]), null)).toBe('acme-inc')
    expect(isRecording(repos[0])).toBe(true)
    expect(isRecording(repos[2])).toBe(false)
  })
})

describe('banners (board 6)', () => {
  it('uninstalled alone; otherwise suspended, then mismatch', () => {
    expect(bannersFor(install())).toEqual([])
    expect(bannersFor(install({ deleted_at: 'x', suspended_at: 'y', permissions_state: 'mismatch' }))).toEqual(['uninstalled'])
    expect(bannersFor(install({ suspended_at: 'y', permissions_state: 'mismatch' }))).toEqual(['suspended', 'mismatch'])
  })

  it('the mismatch banner names what the app has: "Contents (read)" (board 6); a missing one reads "(no access)"', () => {
    expect(COPY.mismatchBody(permissionsNowHave([{ permission: 'contents', granted: 'read' }]))).toBe(
      "On GitHub the app now has: Contents (read). Expected: Actions, Deployments, Pull requests and Metadata, read-only. Review the app's permissions on GitHub."
    )
    expect(permissionsNowHave([{ permission: 'actions', granted: 'write' }, { permission: 'pull_requests', granted: null }])).toBe('Actions (write), Pull requests (no access)')
  })

  it('the suspended banner is the ruled sentence, word for word', () => {
    expect(COPY.suspendedBody).toBe(
      "GitHub doesn't send events while the app is suspended, so deploys that finish in that time aren't recorded and won't be added later. You can record them by hand on the Deployments page."
    )
  })
})

describe('formatting', () => {
  it('"Goddey U.", "4 minutes ago", installation settings URLs', () => {
    expect(shortName('Goddey Uwamari')).toBe('Goddey U.')
    expect(shortName('Cher')).toBe('Cher')
    const now = Date.parse('2026-11-24T10:00:00Z')
    expect(relativeTime('2026-11-24T09:56:00Z', now)).toBe('4 minutes ago')
    expect(relativeTime('2026-11-24T08:00:00Z', now)).toBe('2 hours ago')
    expect(relativeTime('2026-11-24T09:59:30Z', now)).toBe('just now')
    expect(installationSettingsUrl(install())).toBe('https://github.com/organizations/acme-inc/settings/installations/42')
    expect(installationSettingsUrl(install({ account_type: 'User', account_login: 'me' }))).toBe('https://github.com/settings/installations/42')
  })
})

describe('copy rules (founder, Nov 23)', () => {
  const sources = [
    'lib/github-connection/copy.ts',
    'app/(app)/settings/integrations/page.tsx',
    'app/(app)/settings/integrations/github/page.tsx',
    'app/(app)/settings/integrations/github/_components/NotConnected.tsx',
    'app/(app)/settings/integrations/github/_components/Connected.tsx',
    'app/(auth)/auth/github/callback/page.tsx',
  ].map((f) => readFileSync(join(process.cwd(), f), 'utf8'))
  const visible = Object.values(COPY).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: string[]) => string)('X', 'Y'))] : JSON.stringify(v)))
    .join('\n')

  it('never "every deployment", automatic retry or replay wording', () => {
    for (const banned of [/every deploy/i, /all (of your )?deploy/i, /retr(y|ied|ies) (later|automatically)/i, /replay/i, /recorded once you upgrade/i, /automatically record/i]) {
      expect(visible, String(banned)).not.toMatch(banned)
    }
  })

  it('the three ruled sentences, word for word', () => {
    expect(COPY.pageSubtitle).toBe('Record deployments from GitHub Actions.')
    expect(COPY.planLimitNote).toBe("Deployments over your plan's monthly limit aren't recorded.")
    expect(sources.some((s) => s.includes('COPY.suspendedBody'))).toBe(true)
  })
})
