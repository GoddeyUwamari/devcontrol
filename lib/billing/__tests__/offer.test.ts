/**
 * The public billing offer fails closed: only a well-formed "on" answer from
 * GET /api/billing/offer turns the trial on; one request serves the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchBillingOffer, parseBillingOffer, resetBillingOfferForTests, TRIAL_OFF } from '../offer'

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
    ['null', null],
    ['a string', 'on'],
  ])('%s → off', (_name, body) => {
    expect(parseBillingOffer(body)).toEqual(TRIAL_OFF)
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
