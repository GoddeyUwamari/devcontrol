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

  it.each([true, false])('never says "Connected" (socket open = %s): it is not the AWS connection', (isConnected) => {
    socketState.isConnected = isConnected
    const { container } = render(<ConnectionIndicator />)
    const badge = screen.getByTestId('connection-indicator')
    expect(container.textContent).not.toMatch(/connected/i)
    expect(badge.getAttribute('aria-label')).not.toMatch(/connected/i)
  })
})
