/**
 * The top nav is on the app type scale (typography plan T2c; founder decisions on the T2 plan, Oct 24):
 * desktop top-level items are 16 px (text-base, 16/24; founder decision Oct 26) in ink, menu items the ui role (14 px), their descriptions meta
 * (13 px) and badges label (12 px); the search trigger is ui in muted ink and its shortcut a label. The
 * DevControl wordmark and the "DC" monogram are brand marks and stay exactly as they were.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ user: { fullName: 'Sample Owner', email: 'owner@example.com' }, logout: vi.fn(), isLoading: false }),
}))
vi.mock('@/lib/services/anomaly.service', () => ({ anomalyService: { getAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }) } }))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null, isConnected: true }) }))

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
  it('top-level items are 16 px (text-base, founder decision Oct 26), medium weight, ink', async () => {
    const { container } = await renderNav()
    const nav = container.querySelector('nav')!
    const items = [...nav.querySelectorAll(':scope > div > button, :scope > a')]
    expect(items.map((b) => b.textContent)).toEqual(['Services', 'Infrastructure', 'Costs', 'Security', 'Observability', 'DevOps'])
    for (const item of items) {
      expect(classes(item)).toEqual(expect.arrayContaining(['text-base', 'font-medium', 'text-ink']))
      expect(item.className).not.toMatch(/text-body|text-ui|text-\[#/)
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
