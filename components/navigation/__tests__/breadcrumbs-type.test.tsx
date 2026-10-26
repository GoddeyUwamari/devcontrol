/**
 * The two breadcrumbs and the back button are on the app type scale (typography plan T2c): the trail is the
 * meta role (13 px), links and earlier steps are muted ink, the current page is ink. The layout breadcrumb's
 * links keep the breadcrumb-link class, which the frozen link rule in app/globals.css leaves alone.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Breadcrumb as LayoutBreadcrumb } from '@/components/ui/breadcrumb'
import { Breadcrumb as PageBreadcrumb } from '../breadcrumb'
import { BackButton } from '../back-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const classes = (el: Element) => el.className.split(/\s+/)
const ITEMS = [
  { label: 'Settings', href: '/settings' },
  { label: 'Organization', href: '/settings/organization' },
  { label: 'Members' },
]

describe('layout breadcrumb (components/ui/breadcrumb)', () => {
  it('is the meta role; links are muted ink and keep breadcrumb-link; the current page is ink', () => {
    render(<LayoutBreadcrumb items={ITEMS} />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(classes(nav)).toContain('text-meta')
    expect(classes(nav)).not.toContain('text-sm')

    const link = screen.getByRole('link', { name: 'Settings' })
    expect(classes(link)).toEqual(expect.arrayContaining(['breadcrumb-link', 'text-ink-muted', 'hover:text-ink']))
    expect(link.className).not.toMatch(/(?<![\w:-])text-gray-500/)

    const current = screen.getByText('Members')
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(classes(current)).toEqual(expect.arrayContaining(['font-medium', 'text-ink']))
  })
})

describe('page breadcrumb (components/navigation/breadcrumb)', () => {
  it('is the meta role; links are muted ink, the current page ink', () => {
    render(<PageBreadcrumb items={ITEMS} />)
    expect(classes(screen.getByRole('navigation', { name: 'Breadcrumb' }))).toContain('text-meta')
    expect(classes(screen.getByRole('link', { name: 'Organization' }))).toEqual(expect.arrayContaining(['text-ink-muted', 'hover:text-ink', 'font-medium']))
    const current = screen.getByText('Members')
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(classes(current)).toContain('text-ink')
  })
})

describe('back button', () => {
  it('keeps the button role sizes; the keyboard hint is meta, its key a label', () => {
    render(<BackButton href="/payments" label="Back to payments" showKeyboardHint />)
    expect(classes(screen.getByRole('button', { name: 'Back to payments' }))).toContain('text-ui')
    const hint = screen.getByText(/to go back/)
    expect(classes(hint)).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted']))
    expect(classes(screen.getByText('Esc'))).toEqual(expect.arrayContaining(['text-label', 'text-ink-body']))
  })
})
