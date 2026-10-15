/**
 * announceToScreenReader's live region is removed by a 1s timer. That timer
 * can outlive the page's document (a jsdom test environment is torn down
 * within the second), and must not throw "document is not defined" when it does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { announceToScreenReader } from '../accessibility'

const liveRegions = () => document.body.querySelectorAll('[role="status"][aria-live]')

afterEach(() => {
  vi.useRealTimers()
})

describe('announceToScreenReader', () => {
  it('adds a live region with the message and removes it after a second', () => {
    vi.useFakeTimers()
    announceToScreenReader('Dependencies refreshed', 'assertive')
    expect(liveRegions()).toHaveLength(1)
    expect(liveRegions()[0]).toHaveTextContent('Dependencies refreshed')
    expect(liveRegions()[0]).toHaveAttribute('aria-live', 'assertive')
    vi.advanceTimersByTime(999)
    expect(liveRegions()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(liveRegions()).toHaveLength(0)
  })

  it('the removal timer does nothing once the document is gone', () => {
    vi.useFakeTimers()
    announceToScreenReader('Loading is taking longer than usual')
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')!
    // What environment teardown leaves behind: no global document.
    delete (globalThis as { document?: Document }).document
    try {
      expect(typeof document).toBe('undefined')
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'document', descriptor)
    }
    liveRegions().forEach((el) => el.remove())
  })
})
