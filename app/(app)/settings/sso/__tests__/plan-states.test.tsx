/**
 * /settings/sso waits for a known plan: no gate while the organization loads
 * or fails, and GET /api/auth/saml/config only for a known Enterprise plan.
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import SSOSettingsPage from '../page'

let samlCalls = 0
function stubFetch() {
  samlCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/auth/saml')) samlCalls += 1
    return { ok: true, json: async () => ({ success: true, data: null }) }
  }))
}

describePlanStates('/settings/sso', {
  render: () => <SSOSettingsPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'free',
  reset: stubFetch,
  paidCalls: () => samlCalls,
  content: /Your IdP will authenticate users/,
  gate: 'Upgrade to Enterprise',
})
