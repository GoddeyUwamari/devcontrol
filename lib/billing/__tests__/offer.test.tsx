/**
 * The public billing offer fails closed: only a well-formed "on" answer from
 * GET /api/billing/offer turns the trial on; one request serves the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { fetchBillingOffer, parseBillingOffer, resetBillingOfferForTests, TRIAL_OFF, OFFER_TTL_MS } from '../offer'
import { useBillingOffer } from '@/lib/hooks/use-billing-offer'

const ON = { trial: { enabled: true, days: 14, plans: ['starter', 'pro'], cardRequired: true } }

function respond(body: unknown, init: ResponseInit = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init })
}

beforeEach(() => resetBillingOfferForTests())
afterEach(() => vi.restoreAllMocks())

describe('parseBillingOffer', () => {
  it('on: days and plans from the server', () => {
    expect(parseBillingOffer(ON)).toEqual({ trialOn: true, days: 14, plans: ['starter', 'pro'] })
  })

  it.each([
    ['off', { trial: { enabled: false } }],
    ['enabled as a string', { trial: { enabled: 'true', days: 14, plans: ['starter'] } }],
    ['no days', { trial: { enabled: true, plans: ['starter'] } }],
    ['zero days', { trial: { enabled: true, days: 0, plans: ['starter'] } }],
    ['fractional days', { trial: { enabled: true, days: 1.5, plans: ['starter'] } }],
    ['plans not a list', { trial: { enabled: true, days: 14, plans: 'starter' } }],
    ['the founding-count shape', { count: 7 }],
    ['no plans (L-2)', { trial: { enabled: true, days: 14, plans: [] } }],
    ['only plans without a trial (L-2)', { trial: { enabled: true, days: 14, plans: ['enterprise', 'free', 'growth'] } }],
    ['null', null],
    ['a string', 'on'],
  ])('%s → off', (_name, body) => {
    expect(parseBillingOffer(body)).toEqual(TRIAL_OFF)
  })
})

describe('parseBillingOffer keeps only plans that have a trial (L-2)', () => {
  it('unknown ids are dropped, known ones kept', () => {
    expect(parseBillingOffer({ trial: { enabled: true, days: 14, plans: ['enterprise', 'starter'] } }))
      .toEqual({ trialOn: true, days: 14, plans: ['starter'] })
  })
})

describe('fetchBillingOffer', () => {
  it('one request, however many callers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(ON))
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => fetchBillingOffer()))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/billing\/offer$/)
    for (const r of results) expect(r.trialOn).toBe(true)
  })

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', () => Promise.resolve(respond({ error: 'x' }, { status: 500 }))],
    ['HTML', () => Promise.resolve(new Response('<html></html>', { status: 200 }))],
    ['a 404 from an older backend', () => Promise.resolve(respond({}, { status: 404 }))],
  ])('%s → off', async (_name, impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as () => Promise<Response>)
    expect(await fetchBillingOffer()).toEqual(TRIAL_OFF)
  })

  it('an answer is reused for a minute, then asked again (L-3)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond(ON))
      .mockResolvedValueOnce(respond({ trial: { enabled: false } }))
    expect((await fetchBillingOffer()).trialOn).toBe(true)
    vi.setSystemTime(Date.now() + OFFER_TTL_MS - 1)
    expect((await fetchBillingOffer()).trialOn).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 1)
    expect((await fetchBillingOffer()).trialOn).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('an open page picks up a switch-off within a minute (L-3)', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond(ON))
      .mockResolvedValue(respond({ trial: { enabled: false } }))
    function Probe() {
      return <span data-testid="probe">{useBillingOffer().trialOn ? 'on' : 'off'}</span>
    }
    const { getByTestId } = render(<Probe />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(getByTestId('probe').textContent).toBe('on')
    await act(async () => { await vi.advanceTimersByTimeAsync(OFFER_TTL_MS) })
    expect(getByTestId('probe').textContent).toBe('off')
    vi.useRealTimers()
  })

  it('a request that never answers is aborted and reads as off', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = fetchBillingOffer()
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toEqual(TRIAL_OFF)
    vi.useRealTimers()
  })
})
