import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { KEEP_CLEAR_OF_FLOATING, boxesOverlap } from '@/lib/floating-keep-clear'

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

  describe('never covers a keep-clear element (trend-lag round 2: the Dashboard cost trend legend on a phone)', () => {
    /** A 390 x 844 phone: the pill rests at left 16, bottom 16 (about 130 x 30). */
    function setUp(legendTop: number) {
      const legend = document.createElement('div')
      legend.setAttribute(KEEP_CLEAR_OF_FLOATING, '')
      const box = { top: legendTop }
      legend.getBoundingClientRect = () => ({ left: 33, right: 357, top: box.top, bottom: box.top + 60, width: 324, height: 60, x: 33, y: box.top, toJSON: () => ({}) })
      document.body.appendChild(legend)
      const pill = { offsetLeft: 16, offsetTop: 844 - 16 - 30, offsetWidth: 130, offsetHeight: 30 }
      for (const [k, v] of Object.entries(pill)) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get() { return this.dataset?.testid === 'connection-indicator' ? v : 0 } })
      return { legend, box }
    }
    const frame = () => act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise((r) => requestAnimationFrame(() => r(null))) })
    const cleanUp = (legend: HTMLElement) => {
      legend.remove()
      for (const k of ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]
    }

    it('slides out while its resting box overlaps the legend, and back once the legend scrolls clear; its label stays in the page', async () => {
      const { legend, box } = setUp(300)
      render(<ConnectionIndicator />)
      const pill = screen.getByTestId('connection-indicator')
      await frame()
      expect(pill.dataset.steppedAside).toBeUndefined()
      expect(pill.className).toContain('translate-x-0')

      box.top = 780 // the legend now runs under the pill's corner
      await frame()
      expect(pill.dataset.steppedAside).toBe('true')
      expect(pill.className).toContain('-translate-x-[calc(100%+2rem)]')
      expect(screen.getByRole('status', { name: 'Live updates paused' }).textContent).toBe('Live updates paused')

      box.top = 900 // scrolled past
      await frame()
      expect(pill.dataset.steppedAside).toBeUndefined()
      cleanUp(legend)
    })

    it('boxesOverlap: shared area only; touching edges do not count', () => {
      const a = { left: 0, right: 10, top: 0, bottom: 10 }
      expect(boxesOverlap(a, { left: 5, right: 15, top: 5, bottom: 15 })).toBe(true)
      expect(boxesOverlap(a, { left: 10, right: 20, top: 0, bottom: 10 })).toBe(false)
      expect(boxesOverlap(a, { left: 0, right: 10, top: 10, bottom: 20 })).toBe(false)
    })
  })
})
