/**
 * The marketing and sign-in pages render exactly as they did before the
 * app-only typography work (typography plan, Revision 3). That work restyles
 * the signed-in app only; these pages use frozen copies of the shared
 * components (components/marketing-ui) and none of the app tokens.
 *
 * Each page is rendered at 1440 and 390 px (the marketing components choose
 * their layout from window.innerWidth) and compared with an HTML fixture in
 * __fixtures__/, generated once from the code before that work began.
 *
 * Pages that respond to width only through CSS classes (sm:, lg:) give the
 * same markup at both widths, so their two fixtures are identical; pages that
 * read window.innerWidth give different markup.
 *
 * UPDATING A FIXTURE NEEDS FOUNDER SIGN-OFF IN THE PR. A fixture that no longer
 * matches means a marketing or sign-in page changed; never regenerate one to
 * make this test pass. Each fixture is read and compared directly: a missing or
 * different fixture fails, with or without CI or `vitest -u`. Fixtures are
 * written only with UPDATE_MARKETING_FIXTURES=1, which is refused when CI is set.
 */
process.env.TZ = 'UTC'

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { rejectEveryApiRequest } from '@/lib/__tests__/support/console-sentinels'
import MarketingLayout from '../layout'
import HomePage from '../page'
import PricingPage from '../pricing/page'
import GettingStartedPage from '../docs/getting-started/page'
import CostOptimizationPage from '../solutions/cost-optimization/page'
import LoginPage from '@/app/(auth)/login/page'
import ResetPasswordPage from '@/app/(auth)/reset-password/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(),
}))
// Google Analytics loads a third-party script; it renders no markup of its own.
vi.mock('@/components/analytics/site-analytics', () => ({ SiteAnalytics: () => null }))

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const NOW = new Date('2026-10-23T12:00:00Z')
/** Placeholder for the pricing page's /api/organizations/founding-count response. */
const FOUNDING_COUNT = 7
const WIDTHS = [1440, 390] as const

let restoreApi: () => void

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  restoreApi = rejectEveryApiRequest()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ count: FOUNDING_COUNT }), { headers: { 'Content-Type': 'application/json' } })
  )
})

afterEach(() => {
  restoreApi()
  vi.restoreAllMocks()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function withAuth(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}

/** Lets mount effects, the auth check and the stubbed fetch settle. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** One tag per line, so a fixture diff points at the element that changed. */
const format = (html: string) => html.replace(/></g, '>\n<') + '\n'

const text = (root: Element) => (root.textContent ?? '').replace(/\s+/g, ' ')

interface Page {
  name: string
  path: string
  element: () => ReactNode
  /** Real content and layout the render must contain before it is compared. */
  check: (root: HTMLElement) => void
}

const slots = (root: HTMLElement, slot: string) => root.querySelectorAll(`[data-slot="${slot}"]`).length

const PAGES: Page[] = [
  {
    name: 'marketing-home',
    path: '/',
    element: () => withAuth(<MarketingLayout><HomePage /></MarketingLayout>),
    check: (root) => {
      expect(root.querySelector('nav')).not.toBeNull()
      expect(root.querySelector('main')).not.toBeNull()
      expect(root.querySelector('footer')).not.toBeNull()
      expect(root.querySelectorAll('h1')).toHaveLength(1)
      expect(text(root.querySelector('h1')!)).toContain('Find the AWS waste hiding in your bill.')
      expect(root.querySelectorAll('section').length).toBeGreaterThanOrEqual(5)
      expect(slots(root, 'button')).toBeGreaterThan(0)
      expect(text(root)).toContain('All rights reserved')
    },
  },
  {
    name: 'pricing',
    path: '/pricing',
    element: () => <PricingPage />,
    check: (root) => {
      expect(text(root.querySelector('h1')!)).toContain('Simple Pricing. Serious Savings.')
      expect(root.querySelectorAll('h2').length).toBeGreaterThan(0)
      expect(root.querySelector('table')).not.toBeNull()
      // The stubbed founding-count response has arrived (the page's default is 5).
      expect(text(root)).toContain(`${FOUNDING_COUNT} of 50 spots claimed`)
    },
  },
  {
    name: 'login',
    path: '/login',
    element: () => withAuth(<LoginPage />),
    check: (root) => {
      expect(root.querySelector('form')).not.toBeNull()
      expect(root.querySelector('input[type="email"]')).not.toBeNull()
      expect(root.querySelector('input[type="password"]')).not.toBeNull()
      expect(root.querySelector('button[role="checkbox"]')).not.toBeNull()
      expect(slots(root, 'card')).toBeGreaterThan(0)
      expect(slots(root, 'card-title')).toBeGreaterThan(0)
      expect(slots(root, 'label')).toBeGreaterThan(0)
      expect(slots(root, 'button')).toBeGreaterThan(0)
    },
  },
  {
    name: 'reset-password',
    path: '/reset-password',
    element: () => withAuth(<ResetPasswordPage />),
    check: (root) => {
      expect(text(root)).toContain('Invalid reset link')
      expect(slots(root, 'card')).toBeGreaterThan(0)
      expect(slots(root, 'alert')).toBe(1)
      expect(slots(root, 'alert-title')).toBe(1)
      expect(slots(root, 'alert-description')).toBe(1)
      expect(text(root.querySelector('[data-slot="alert-title"]')!)).toContain('Link Error')
    },
  },
  {
    name: 'docs-getting-started',
    path: '/docs/getting-started',
    element: () => <GettingStartedPage />,
    check: (root) => {
      expect(root.querySelector('h1')).not.toBeNull()
      expect(slots(root, 'card')).toBeGreaterThan(0)
      expect(slots(root, 'card-title')).toBeGreaterThan(0)
      expect(slots(root, 'badge')).toBeGreaterThan(0)
      expect(slots(root, 'button')).toBeGreaterThan(0)
    },
  },
  {
    name: 'solutions-cost-optimization',
    path: '/solutions/cost-optimization',
    element: () => <CostOptimizationPage />,
    check: (root) => {
      expect(root.querySelector('h1')).not.toBeNull()
      expect(slots(root, 'card')).toBeGreaterThan(0)
      expect(slots(root, 'card-title')).toBeGreaterThan(0)
      expect(slots(root, 'badge')).toBeGreaterThan(0)
      expect(slots(root, 'button')).toBeGreaterThan(0)
    },
  },
]

const FIXTURES = join(__dirname, '__fixtures__')
const fixtureName = (page: Page, width: number) => `${page.name}-${width}.html`
const UPDATE = process.env.UPDATE_MARKETING_FIXTURES === '1'

describe('marketing fixtures', () => {
  it('UPDATE_MARKETING_FIXTURES is never honoured in CI', () => {
    if (UPDATE) expect(process.env.CI, 'UPDATE_MARKETING_FIXTURES=1 is refused when CI is set').toBeFalsy()
  })

  it('the fixture folder holds exactly the 12 expected files', () => {
    const expected = PAGES.flatMap((page) => WIDTHS.map((width) => fixtureName(page, width))).sort()
    expect(expected).toHaveLength(12)
    expect(readdirSync(FIXTURES).sort()).toEqual(expected)
  })
})

describe('marketing and sign-in pages are unchanged', () => {
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      it(`${page.name} at ${width} px matches __fixtures__/${page.name}-${width}.html`, async () => {
        setWidth(width)
        window.history.replaceState(null, '', page.path)
        const { container } = render(page.element())
        await settle()

        expect(window.innerWidth).toBe(width)
        expect(text(container)).not.toMatch(/something went wrong/i)
        page.check(container)
        const html = format(container.innerHTML)
        const fixture = join(FIXTURES, fixtureName(page, width))
        if (UPDATE) {
          expect(process.env.CI, 'UPDATE_MARKETING_FIXTURES=1 is refused when CI is set').toBeFalsy()
          writeFileSync(fixture, html)
        }
        expect(existsSync(fixture), `${fixtureName(page, width)} is missing`).toBe(true)
        expect(html).toBe(readFileSync(fixture, 'utf8'))
      })
    }
  }
})
