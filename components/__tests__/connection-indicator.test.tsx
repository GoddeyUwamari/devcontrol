import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const socketState = vi.hoisted(() => ({ isConnected: false }))
vi.mock('@/lib/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ socket: null, isConnected: socketState.isConnected }),
}))

import { ConnectionIndicator } from '../ConnectionIndicator'

describe('ConnectionIndicator', () => {
  beforeEach(() => {
    socketState.isConnected = false
  })

  it.each([
    [true, 'Live updates', 'bg-green-500'],
    [false, 'Live updates paused', 'bg-red-500'],
  ])('socket open = %s: says "%s", with the same accessible name, and keeps its dot', (isConnected, label, dot) => {
    socketState.isConnected = isConnected
    render(<ConnectionIndicator />)
    const badge = screen.getByRole('status', { name: label })
    expect(badge.textContent).toBe(label)
    const dotEl = badge.querySelector('[aria-hidden="true"]')!
    expect(dotEl.className).toContain(dot)
    expect(dotEl.className.includes('animate-pulse')).toBe(isConnected)
  })

  it.each([true, false])('floats as a fixed pill in the bottom-left corner, above the page (socket open = %s)', (isConnected) => {
    socketState.isConnected = isConnected
    render(<ConnectionIndicator />)
    const classes = screen.getByTestId('connection-indicator').className.split(/\s+/)
    // Exactly one position and one offset per side, so a second class can't override the corner.
    expect(classes.filter((c) => /^(?:[\w-]+:)?(?:static|fixed|absolute|relative|sticky)$/.test(c))).toEqual(['fixed'])
    expect(classes.filter((c) => /^(?:[\w-]+:)?-?(?:inset|top|right|bottom|left)-\S+$/.test(c))).toEqual(['bottom-4', 'left-4'])
    expect(classes.filter((c) => /^(?:[\w-]+:)?z-\S+$/.test(c))).toEqual(['z-50'])
    expect(classes).toContain('shadow-lg')
    expect(classes.filter((c) => ['w-fit', 'ml-4', 'mb-4'].includes(c))).toEqual([])
  })

  it('is the label role at its existing size and weight (12 px, 400), its text in body ink, always shown in full', () => {
    socketState.isConnected = true
    render(<ConnectionIndicator />)
    const classes = screen.getByTestId('connection-indicator').className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['text-label', 'font-normal']))
    expect(classes).not.toContain('text-xs')
    const text = screen.getByText('Live updates')
    expect(text.className.split(/\s+/)).toContain('text-ink-body')
    expect(text.className).not.toMatch(/sr-only|hidden|text-gray-700/)
  })

  it.each([true, false])('never says "Connected" (socket open = %s): it is not the AWS connection', (isConnected) => {
    socketState.isConnected = isConnected
    const { container } = render(<ConnectionIndicator />)
    const badge = screen.getByTestId('connection-indicator')
    expect(container.textContent).not.toMatch(/connected/i)
    expect(badge.getAttribute('aria-label')).not.toMatch(/connected/i)
  })
})
