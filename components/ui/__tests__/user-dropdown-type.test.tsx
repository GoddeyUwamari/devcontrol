/**
 * The user menu is on the app type scale (typography plan T2c): initials and items are the ui role (14 px),
 * the email meta (13 px) in muted ink, the name ui in ink, and an item badge a label in the strong danger ink
 * (it sits on a red tint). "Sign out" keeps text-destructive (red-600 on white, which passes AA).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LayoutDashboard } from 'lucide-react'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
// userNavSections has no badges today; one is added here so the badge's classes are covered.
vi.mock('@/lib/navigation-config', () => ({
  userNavSections: [{ items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, badge: 'New' }] }],
}))

import { UserDropdown } from '../user-dropdown'

const classes = (el: Element) => el.className.split(/\s+/)

async function open() {
  render(<UserDropdown user={{ name: 'Sample Owner', email: 'owner@example.com', initials: 'SO' }} onLogout={vi.fn()} />)
  const trigger = screen.getByText('SO').closest('button')!
  await act(async () => { fireEvent.keyDown(trigger, { key: 'Enter' }) })
  await screen.findByRole('menu')
}

describe('user menu', () => {
  it('initials are ui (14 px), not 16', () => {
    render(<UserDropdown user={{ name: 'Sample Owner', email: 'owner@example.com', initials: 'SO' }} onLogout={vi.fn()} />)
    const initials = screen.getByText('SO')
    expect(classes(initials)).toEqual(expect.arrayContaining(['text-ui', 'font-semibold', 'text-ink-muted']))
    expect(initials.className).not.toMatch(/text-base/)
  })

  it('name ui in ink, email meta in muted ink, items ui, badge a strong-danger label', async () => {
    await open()
    expect(classes(screen.getByText('Sample Owner'))).toEqual(expect.arrayContaining(['text-ui', 'font-medium', 'text-ink']))
    expect(classes(screen.getByText('owner@example.com'))).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted', 'truncate']))
    expect(classes(screen.getByText('Dashboard'))).toContain('text-ui')
    const badge = screen.getByText('New')
    expect(classes(badge)).toEqual(expect.arrayContaining(['text-label', 'font-semibold', 'text-ink-danger-strong']))
    expect(badge.className).not.toMatch(/(?<![\w:-])text-destructive|text-xs|font-medium/)
  })

  it('"Sign out" keeps the destructive colour', async () => {
    await open()
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' })
    expect(classes(signOut)).toContain('text-destructive')
  })
})
