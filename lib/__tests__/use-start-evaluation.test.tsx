/**
 * useStartEvaluation (Security V2 F3a): one request per framework at a time; a 200 is "started" (tracked by
 * its run id), a 409 is "already running" until the list is read again, anything else is a problem and
 * never a start. The page's button is also disabled while a start is in flight; this proves the hook holds
 * on its own (two calls in the same tick).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStartEvaluation } from '@/lib/compliance/useStartEvaluation'

const post = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { post } }))

const reject = (status?: number) => Promise.reject(Object.assign(new Error('Request failed'), status === undefined ? {} : { response: { status, data: { error: 'Failed to execute scan' } } }))

/** Lets React render the state set before the list read, as a real network read would. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  post.mockReset()
})

describe('useStartEvaluation', () => {
  it('two starts of the same framework in one tick send one request', async () => {
    let answer!: (value: unknown) => void
    post.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useStartEvaluation(refresh))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.start('fw-1')
      second = result.current.start('fw-1')
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/api/compliance-frameworks/fw-1/scan', {})
    expect(result.current.starting.has('fw-1')).toBe(true)
    await act(async () => { answer({ data: { success: true, data: { scanId: 's-1' } } }); await first; await second })
    expect(result.current.starting.has('fw-1')).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('different frameworks start independently', async () => {
    post.mockResolvedValue({ data: { success: true, data: { scanId: 's' } } })
    const { result } = renderHook(() => useStartEvaluation(vi.fn().mockResolvedValue(undefined)))
    await act(async () => { await Promise.all([result.current.start('a'), result.current.start('b')]) })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('a 200 tracks the run by its id after the list is read (started, never completed)', async () => {
    post.mockResolvedValue({ data: { success: true, data: { scanId: 's-1' } } })
    const { result } = renderHook(() => useStartEvaluation(vi.fn().mockResolvedValue(undefined)))
    await act(async () => { await result.current.start('fw-1') })
    expect(result.current.started['fw-1']).toEqual({ at: expect.any(Number), scanId: 's-1' })
    expect(result.current.problems).toEqual({})
  })

  /** Starts, holds the list read open, and returns what the hook tracked meanwhile and after. */
  async function trackedDuringRefresh() {
    let release!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const { result } = renderHook(() => useStartEvaluation(refresh))
    let done!: Promise<void>
    await act(async () => { done = result.current.start('fw-1'); await tick() })
    expect(refresh).toHaveBeenCalledTimes(1)
    const during = result.current.started['fw-1']
    await act(async () => { release(); await done })
    return { during, after: result.current.started['fw-1'], problems: result.current.problems }
  }

  it('a 200 without a run id is Running only until the list has been read again', async () => {
    post.mockResolvedValue({ data: { success: true, data: {} } })
    expect(await trackedDuringRefresh()).toEqual({ during: { at: expect.any(Number), scanId: null }, after: undefined, problems: {} })
  })

  it('a 409 is Running while the list is read, then the list is the truth; never a problem', async () => {
    post.mockImplementation(() => reject(409))
    expect(await trackedDuringRefresh()).toEqual({ during: { at: expect.any(Number), scanId: null }, after: undefined, problems: {} })
  })

  it.each([
    [403, 'viewer'],
    [402, 'plan'],
    [404, 'failed'],
    [500, 'failed'],
    [undefined, 'failed'],
  ])('%s → %s; nothing is started and the list is not read', async (status, problem) => {
    post.mockImplementation(() => reject(status))
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useStartEvaluation(refresh))
    await act(async () => { await result.current.start('fw-1') })
    expect(result.current.problems).toEqual({ 'fw-1': problem })
    expect(result.current.started).toEqual({})
    expect(refresh).not.toHaveBeenCalled()
    expect(result.current.starting.size).toBe(0)
  })

  it('a new start clears the previous problem; a failed refresh never throws', async () => {
    post.mockImplementationOnce(() => reject(500)).mockResolvedValueOnce({ data: { success: true, data: { scanId: 's-2' } } })
    const { result } = renderHook(() => useStartEvaluation(() => Promise.reject(new Error('network'))))
    await act(async () => { await result.current.start('fw-1') })
    expect(result.current.problems).toEqual({ 'fw-1': 'failed' })
    await act(async () => { await result.current.start('fw-1') })
    expect(result.current.problems).toEqual({})
    expect(result.current.started['fw-1']?.scanId).toBe('s-2')
  })
})
