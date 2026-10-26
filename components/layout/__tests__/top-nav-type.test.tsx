/**
 * The top nav is on the app type scale (typography plan T2c; founder decisions on the T2 plan, Oct 24):
 * top-level items are the body role (15 px) in ink, menu items the ui role (14 px), their descriptions meta
 * (13 px) and badges label (12 px); the search trigger is ui in muted ink and its shortcut a label. The
 * DevControl wordmark and the "DC" monogram are brand marks and stay exactly as they were.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ user: { fullName: 'Sample Owner', email: 'owner@example.com' }, logout: vi.fn(), isLoading: false }),
}))
vi.mock('@/lib/services/anomaly.service', () => ({ anomalyService: { getAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }) } }))
// Each useWebSocket() call opens its own socket; the mock counts hook instances (a state initialiser runs
// once per mounted hook), so a second socket shows up as a second instance.
const ws = vi.hoisted(() => ({ isConnected: true, instances: 0 }))
vi.mock('@/lib/hooks/useWebSocket', async () => {
  const React = await import('react')
  return { useWebSocket: () => { React.useState(() => { ws.instances++ }); return { socket: null, isConnected: ws.isConnected } } }
})

import { TopNav } from '../top-nav'

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  }
})

const classes = (el: Element) => el.className.split(/\s+/)

async function renderNav() {
  const utils = render(<TopNav />)
  await act(async () => {})
  return utils
}

describe('top nav: desktop', () => {
  it('top-level items are the body role, medium weight, ink', async () => {
    const { container } = await renderNav()
    const nav = container.querySelector('nav')!
    const items = [...nav.querySelectorAll(':scope > div > button, :scope > a')]
    expect(items.map((b) => b.textContent)).toEqual(['Services', 'Infrastructure', 'Costs', 'Security', 'Observability', 'DevOps'])
    for (const item of items) {
      expect(classes(item)).toEqual(expect.arrayContaining(['text-body', 'font-medium', 'text-ink']))
      expect(item.className).not.toMatch(/text-base|text-\[#/)
    }
  })

  it('menu items are ui in ink, descriptions meta in muted ink, badges labels', async () => {
    const { container } = await renderNav()
    const costs = [...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Costs')!
    fireEvent.mouseEnter(costs.parentElement!)
    const link = within(container.querySelector('nav')!).getByRole('link', { name: /Optimization Controls/ })
    const label = within(link).getByText('Optimization Controls')
    expect(classes(label)).toEqual(expect.arrayContaining(['text-ui', 'font-semibold', 'text-ink']))
    expect(classes(within(link).getByText('Tune detection thresholds'))).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted']))
    const badge = within(link).getByText('Enterprise')
    expect(classes(badge)).toEqual(expect.arrayContaining(['text-label', 'font-semibold', 'text-white']))
    // No inline type left on the menu items (the badge keeps only its fill).
    for (const el of [label, badge, within(link).getByText('Tune detection thresholds')]) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/font-size|font-weight|line-height|(?:^|;\s*)color:/)
    }
  })

  it('the search trigger is ui in muted ink, its shortcut a label', async () => {
    await renderNav()
    const search = screen.getByText('Search...').closest('button')!
    expect(classes(search)).toEqual(expect.arrayContaining(['text-ui', 'text-ink-muted']))
    expect(search.className).not.toMatch(/text-base|text-slate-500|text-meta/)
    const kbd = search.querySelector('kbd')!
    expect(classes(kbd)).toEqual(expect.arrayContaining(['text-label', 'text-ink-muted']))
    expect(kbd.className).not.toMatch(/text-\[10px\]|opacity-/)
  })

  it('the wordmark and the monogram are unchanged (brand)', async () => {
    const { container } = await renderNav()
    const desktopLogo = [...container.querySelectorAll('a[href="/dashboard"]')].find((a) => a.className.includes('font-semibold'))!
    expect(desktopLogo.querySelector('span:not(.text-white)')!.className).toBe('text-xl')
    expect(desktopLogo.querySelector('span.text-white')!.className).toBe('text-white text-xl font-bold')
    const mobileLogo = [...container.querySelectorAll('a[href="/dashboard"]')].find((a) => !a.className.includes('font-semibold'))! as HTMLElement
    expect(mobileLogo.style.fontWeight).toBe('700')
    expect(mobileLogo.style.fontSize).toBe('1.2rem')
    expect(mobileLogo.style.color).toBe('rgb(30, 27, 75)')
    expect(mobileLogo.style.letterSpacing).toBe('-0.01em')
  })
})

describe('top nav: phone bar and drawer', () => {
  it('drawer sections are the body role in ink; their links ui (active: semibold violet); Settings ui muted', async () => {
    await renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const section = screen.getAllByRole('button').find((b) => b.textContent === 'Costs' && b.getAttribute('style')?.includes('14px 20px'))!
    expect(classes(section)).toEqual(expect.arrayContaining(['text-body', 'font-semibold', 'text-ink']))
    expect(section.getAttribute('style')).not.toMatch(/font-size|font-weight|(?:^|;\s*)color:/)
    fireEvent.click(section)
    const item = screen.getAllByRole('link', { name: 'Cost Overview' }).find((a) => a.getAttribute('style')?.includes('padding'))!
    expect(classes(item)).toEqual(expect.arrayContaining(['text-ui', 'font-normal', 'text-ink-muted']))
    expect(item.getAttribute('style')).not.toMatch(/font-size|font-weight|(?:^|;\s*)color:/)
    const settings = screen.getAllByRole('link').find((a) => a.textContent?.includes('Settings') && a.getAttribute('href') === '/settings')!
    expect(classes(settings)).toEqual(expect.arrayContaining(['text-ui', 'text-ink-muted']))
  })

  it('the phone bar icons take their colour from ink classes, not inline styles', async () => {
    await renderNav()
    const menu = screen.getByRole('button', { name: 'Open menu' })
    expect(classes(menu)).toContain('text-ink')
    expect(menu.getAttribute('style')).not.toMatch(/(?:^|;\s*)color:/)
    const bell = screen.getByRole('link', { name: 'Alerts' })
    expect(classes(bell)).toContain('text-ink-muted')
    expect(bell.getAttribute('style')).not.toMatch(/(?:^|;\s*)color:/)
  })
})

describe('top nav: Live updates', () => {
  beforeEach(() => { ws.instances = 0; ws.isConnected = true })

  it('opens one socket for both bars', async () => {
    await renderNav()
    expect(ws.instances).toBe(1)
  })

  it.each([
    [true, 'Live updates'],
    [false, 'Live updates paused'],
  ])('socket open = %s: one indicator in each bar, inside the banner, named "%s"', async (isConnected, label) => {
    ws.isConnected = isConnected
    const { container } = await renderNav()
    const mobile = container.querySelector('[data-nav-bar="mobile"]')!
    const desktop = container.querySelector('[data-nav-bar="desktop"]')!
    const inMobile = within(mobile as HTMLElement).getByRole('status', { name: label })
    const inDesktop = within(desktop as HTMLElement).getByRole('status', { name: label })
    expect(container.querySelectorAll('[data-testid="connection-indicator"]')).toHaveLength(2)
    // Phone bar: before the alerts bell, dot only below sm. Desktop: first in the right-hand group (before
    // search), dot only below xl.
    expect(inMobile.nextElementSibling?.getAttribute('aria-label')).toBe('Alerts')
    expect(within(inMobile).getByText(label).className).toContain('sm:not-sr-only')
    expect(inDesktop.parentElement!.firstElementChild).toBe(inDesktop)
    expect(inDesktop.nextElementSibling?.textContent).toContain('Search...')
    expect(within(inDesktop).getByText(label).className).toContain('xl:not-sr-only')
  })
})
