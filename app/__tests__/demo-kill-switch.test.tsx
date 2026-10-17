/**
 * Demo mode is switched off for everyone. It ran on two localStorage flags
 * ('devcontrol_demo_mode' and the persisted 'sales-demo-mode' store) that
 * survived logout, and actions on demo screens still wrote to the real
 * organization. These guards keep it off: every demo check reports real mode
 * even with both flags set, app load removes both flags, /demo redirects to the
 * public product tour, and no UI offers demo mode (the banner included).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, waitFor, act } from '@testing-library/react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import nextConfig from '../../next.config'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { demoModeService } from '@/lib/services/demo-mode.service'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { clearLegacyDemoFlags, LEGACY_DEMO_KEYS } from '@/lib/legacy-demo-cleanup'
import { Providers } from '../providers'
import { UserDropdown } from '@/components/ui/user-dropdown'
import { DemoBanner } from '@/components/demo/DemoBanner'
import MonitoringPage from '../(app)/admin/monitoring/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}))
vi.mock('@/lib/contexts/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
// Renders the avatar menu's items inline, so the test sees the open menu's contents.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => <hr />,
  }
})
vi.mock('@/lib/services/alert-history.service', () => ({
  alertHistoryService: { getAlertHistory: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DEMO_KEY = 'devcontrol_demo_mode'
const SALES_DEMO_KEY = 'sales-demo-mode'

/** Both flags exactly as the old /demo page and avatar menu left them. */
function setBothDemoFlags() {
  localStorage.setItem(DEMO_KEY, 'true')
  localStorage.setItem(SALES_DEMO_KEY, JSON.stringify({ state: { enabled: true }, version: 0 }))
}

beforeEach(() => {
  localStorage.clear()
  setBothDemoFlags()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('every demo check reports real mode with both flags set', () => {
  it('useDemoMode() is false, including after a demo-mode-changed event', () => {
    const { result } = renderHook(() => useDemoMode())
    expect(result.current).toBe(false)
    act(() => {
      window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: true } }))
    })
    expect(result.current).toBe(false)
  })

  it('demoModeService.isEnabled() is false, and enable()/toggle() change nothing', () => {
    expect(demoModeService.isEnabled()).toBe(false)
    demoModeService.enable()
    demoModeService.toggle()
    expect(demoModeService.isEnabled()).toBe(false)
    expect(localStorage.getItem(DEMO_KEY)).toBe('true')
  })

  it('useSalesDemo() is disabled in both call shapes, and enable()/toggle() change nothing', () => {
    const { result } = renderHook(() => ({ store: useSalesDemo(), selected: useSalesDemo((state) => state.enabled) }))
    expect(result.current.store.enabled).toBe(false)
    expect(result.current.selected).toBe(false)
    act(() => {
      result.current.store.enable()
      result.current.store.toggle()
    })
    const after = renderHook(() => useSalesDemo((state) => state.enabled))
    expect(after.result.current).toBe(false)
    expect(localStorage.getItem(SALES_DEMO_KEY)).toBe(JSON.stringify({ state: { enabled: true }, version: 0 }))
  })
})

describe('app load removes both legacy flags', () => {
  it('names exactly the two legacy keys', () => {
    expect([...LEGACY_DEMO_KEYS]).toEqual([DEMO_KEY, SALES_DEMO_KEY])
  })

  it('clearLegacyDemoFlags() removes both keys and leaves other keys alone', () => {
    localStorage.setItem('accessToken', 'placeholder-token')
    clearLegacyDemoFlags()
    expect(localStorage.getItem(DEMO_KEY)).toBeNull()
    expect(localStorage.getItem(SALES_DEMO_KEY)).toBeNull()
    expect(localStorage.getItem('accessToken')).toBe('placeholder-token')
  })

  it('clearLegacyDemoFlags() never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => clearLegacyDemoFlags()).not.toThrow()
  })

  it('rendering the root Providers removes both keys', async () => {
    render(<Providers><div>page</div></Providers>)
    expect(screen.getByText('page')).toBeInTheDocument()
    await waitFor(() => {
      expect(localStorage.getItem(DEMO_KEY)).toBeNull()
      expect(localStorage.getItem(SALES_DEMO_KEY)).toBeNull()
    })
  })
})

describe('/demo is gone', () => {
  it('/demo redirects to /tour (not permanent)', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects.filter((r) => r.source === '/demo')).toEqual([
      { source: '/demo', destination: '/tour', permanent: false },
    ])
  })

  it('app/demo has no page or layout', () => {
    expect(existsSync(join(__dirname, '..', 'demo'))).toBe(false)
  })
})

describe('no UI offers demo mode', () => {
  it('the avatar menu has no demo control', () => {
    render(<UserDropdown user={{ name: 'Test User', email: 'user@example.com', initials: 'TU' }} onLogout={() => {}} />)
    expect(screen.getByText('Sign out')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/demo/i)
  })

  it('Admin Monitoring, AWS not connected, offers no demo data and shows no demo banner', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/cloudwatch/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { connected: false } }) })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    }) as unknown as typeof fetch

    render(<MonitoringPage />)

    await waitFor(() => expect(screen.getByText('Stop Flying Blind on AWS')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /demo/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Explore Demo Data/i)).not.toBeInTheDocument()
  })

  it('the app-wide demo banner renders nothing', () => {
    const { container } = render(<DemoBanner />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
  })
})
