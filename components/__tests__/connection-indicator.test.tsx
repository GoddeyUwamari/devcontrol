import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The indicator is presentational: the top nav reads the socket once and passes its state down. If the
// indicator ever opened its own socket again, this mock would throw.
vi.mock('@/lib/hooks/useWebSocket', () => ({
  useWebSocket: () => { throw new Error('ConnectionIndicator must not open its own socket') },
}))

import { ConnectionIndicator } from '../ConnectionIndicator'

const classes = (el: Element) => el.className.split(/\s+/)

describe('ConnectionIndicator', () => {
  it.each([
    [true, 'Live updates', 'bg-green-500'],
    [false, 'Live updates paused', 'bg-red-500'],
  ])('socket open = %s: says "%s", with the same accessible name and tooltip, and keeps its dot', (isConnected, label, dot) => {
    render(<ConnectionIndicator isConnected={isConnected} compactBelow="sm" />)
    const badge = screen.getByRole('status', { name: label })
    expect(badge.textContent).toBe(label)
    expect(badge.getAttribute('title')).toBe(label)
    const dotEl = badge.querySelector('[aria-hidden="true"]')!
    expect(dotEl.className).toContain(dot)
    expect(dotEl.className.includes('animate-pulse')).toBe(isConnected)
  })

  it.each([
    ['sm', 'hidden sm:inline', 'sm:px-3'],
    ['xl', 'hidden xl:inline', 'xl:px-3'],
  ] as const)('below %s only the dot shows: the visible label starts there, the pill chrome too, and the name never depends on it', (bp, textClasses, pill) => {
    render(<ConnectionIndicator isConnected compactBelow={bp} />)
    const badge = screen.getByRole('status', { name: 'Live updates' })
    const text = screen.getByText('Live updates')
    expect(classes(text)).toEqual(expect.arrayContaining(textClasses.split(' ')))
    // Not sr-only + not-sr-only: the unlayered .sr-only in app/globals.css outranks Tailwind's layered
    // not-sr-only, so that label would never show (found in the T2c visual check).
    expect(text.className).not.toMatch(/sr-only/)
    expect(badge.getAttribute('aria-label')).toBe('Live updates')
    expect(classes(badge)).toContain(pill)
    // Its own border, fill and padding apply only from the breakpoint (none on the bare dot).
    expect(classes(badge).filter((c) => /^(?:border|bg-white|px-3|py-1\.5)$/.test(c))).toEqual([])
  })

  it.each([true, false])('is never fixed, absolute or sticky over the page: no offsets or z-index (socket open = %s)', (isConnected) => {
    render(<ConnectionIndicator isConnected={isConnected} compactBelow="sm" />)
    const cls = classes(screen.getByTestId('connection-indicator'))
    expect(cls.filter((c) => /^(?:[\w-]+:)?(?:fixed|absolute|sticky|-?(?:inset|top|right|bottom|left)-\S+|z-\S+)$/.test(c))).toEqual([])
  })

  it('is the label role at its existing size and weight (12 px, 400), in body ink', () => {
    render(<ConnectionIndicator isConnected compactBelow="sm" />)
    expect(classes(screen.getByTestId('connection-indicator'))).toEqual(expect.arrayContaining(['text-label', 'font-normal']))
    expect(classes(screen.getByText('Live updates'))).toContain('text-ink-body')
    expect(screen.getByTestId('connection-indicator').className).not.toMatch(/(?<![\w:-])text-xs/)
  })

  it.each([true, false])('never says "Connected" (socket open = %s): it is not the AWS connection', (isConnected) => {
    const { container } = render(<ConnectionIndicator isConnected={isConnected} compactBelow="xl" />)
    const badge = screen.getByTestId('connection-indicator')
    expect(container.textContent).not.toMatch(/connected/i)
    expect(badge.getAttribute('aria-label')).not.toMatch(/connected/i)
    expect(badge.getAttribute('title')).not.toMatch(/connected/i)
  })
})
