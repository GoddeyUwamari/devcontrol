/**
 * data-surface="app" marks the signed-in app, so the app-only styles in
 * app/globals.css apply there and nowhere else: on the layout's wrapper (first
 * paint, and the sign-in loader) and on <html> (content portalled to <body>),
 * removed again when the app layout unmounts. The marketing and sign-in
 * layouts never set it.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SOURCE_FILES } from '@/app/__tests__/surface-scope'

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: true }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

// (app) shell chrome and hooks, as in components/analytics/__tests__/route-analytics-boundary.test.tsx.
vi.mock('@/components/layout/top-nav', () => ({ TopNav: () => null }))
vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/command-palette', () => ({ CommandPalette: () => null }))
vi.mock('@/components/ConnectionIndicator', () => ({ ConnectionIndicator: () => null }))
vi.mock('@/components/onboarding/welcome-modal', () => ({ WelcomeModal: () => null }))
vi.mock('@/components/ui/breadcrumb', () => ({ Breadcrumb: () => null }))
vi.mock('@/components/demo/DemoBanner', () => ({ DemoBanner: () => null }))
vi.mock('@/components/ai/AIChatWidget', () => ({ AIChatWidget: () => null }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/stores/onboarding-store', () => ({
  useOnboardingStore: (select: (s: { fetchStatus: () => void }) => unknown) => select({ fetchStatus: () => {} }),
}))
vi.mock('@/lib/hooks/useBreadcrumbs', () => ({ useBreadcrumbs: () => [] }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: false }) }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/components/analytics/site-analytics', () => ({ SiteAnalytics: () => null }))
// (marketing) layout chrome
vi.mock('@/components/layout/MarketingNav', () => ({ MarketingNav: () => null }))
vi.mock('@/components/footer', () => ({ Footer: () => null }))

import AppLayout from '../layout'
import MarketingLayout from '@/app/(marketing)/layout'
import AuthLayout from '@/app/(auth)/layout'

const html = () => document.documentElement

beforeEach(() => {
  auth.isAuthenticated = false
  auth.isLoading = true
})

afterEach(() => {
  delete html().dataset.surface
})

describe('app surface marker', () => {
  it('signed out (sign-in loader): set on <html> and on the wrapper around the loader', () => {
    const { container } = render(<AppLayout><p>page</p></AppLayout>)

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('page')).toBeNull()
    expect(html()).toHaveAttribute('data-surface', 'app')
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toHaveAttribute('data-surface', 'app')
    expect(wrapper).toContainElement(screen.getByRole('status'))
  })

  it('the wrapper carries only the marker: no class, style or other attribute that could change layout', () => {
    for (const signedIn of [false, true]) {
      auth.isAuthenticated = signedIn
      auth.isLoading = !signedIn
      const { container, unmount } = render(<AppLayout><p>page</p></AppLayout>)
      const wrapper = container.firstElementChild as HTMLElement
      expect(wrapper.tagName).toBe('DIV')
      expect(wrapper.getAttributeNames()).toEqual(['data-surface'])
      unmount()
    }
  })

  it('signed in: set on <html> and on the wrapper around the shell', () => {
    auth.isAuthenticated = true
    auth.isLoading = false
    const { container } = render(<AppLayout><p>page</p></AppLayout>)

    expect(html()).toHaveAttribute('data-surface', 'app')
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toHaveAttribute('data-surface', 'app')
    expect(wrapper).toContainElement(screen.getByRole('main'))
    expect(wrapper).toContainElement(screen.getByText('page'))
  })

  it('unmounting the app layout removes it from <html>', () => {
    const { unmount } = render(<AppLayout><p>page</p></AppLayout>)
    expect(html()).toHaveAttribute('data-surface', 'app')

    unmount()
    expect(html()).not.toHaveAttribute('data-surface')
  })

  it.each([
    ['(marketing)', MarketingLayout],
    ['(auth)', AuthLayout],
  ])('the %s layout does not set it', (_name, Layout) => {
    const { container } = render(<Layout><p>page</p></Layout>)

    expect(screen.getByText('page')).toBeInTheDocument()
    expect(html()).not.toHaveAttribute('data-surface')
    expect(container.querySelector('[data-surface]')).toBeNull()
  })

  // Signing out ends the session and pushes /login (lib/contexts/auth-context.tsx logout): the (app) layout
  // unmounts and the (auth) layout mounts in the same navigation. Afterwards nothing carries the marker, so
  // no APP SURFACE rule (every one needs it; app/__tests__/globals-marketing-scope.test.ts) can reach the
  // sign-in page, which keeps today's font. The browser capture checks the computed font itself.
  it('signing out to /login removes it, and the sign-in page renders outside it', () => {
    auth.isAuthenticated = true
    auth.isLoading = false
    function Routes() {
      const [path, setPath] = useState('/dashboard')
      if (path === '/login') {
        return (
          <AuthLayout>
            <form aria-label="Sign in" />
          </AuthLayout>
        )
      }
      return (
        <AppLayout>
          <button
            type="button"
            onClick={() => {
              auth.isAuthenticated = false
              setPath('/login')
            }}
          >
            Sign out
          </button>
        </AppLayout>
      )
    }
    const { container } = render(<Routes />)
    expect(html()).toHaveAttribute('data-surface', 'app')
    expect(container.querySelector('[data-surface="app"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    const form = screen.getByRole('form', { name: 'Sign in' })
    expect(html()).not.toHaveAttribute('data-surface')
    expect(document.querySelector('[data-surface]')).toBeNull()
    expect(form.closest('[data-surface]')).toBeNull()
  })

  it('only app/(app)/layout.tsx sets it', () => {
    const setters = SOURCE_FILES.filter((file) =>
      /data-surface|dataset\.surface|dataset\[\s*['"]surface['"]\s*\]|setAttribute\(\s*['"]data-surface/.test(readFileSync(join(process.cwd(), file), 'utf8'))
    )
    expect(setters).toEqual(['app/(app)/layout.tsx'])
  })
})
