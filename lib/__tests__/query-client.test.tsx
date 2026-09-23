/**
 * resetQueryClientForIdentityChange + the app's QueryClient wiring.
 *
 * The integration-level proof (real AuthProvider login/logout/session-expiry over
 * the real dashboard) lives in app/(app)/dashboard/__tests__/tenant-cache-isolation.test.tsx;
 * this file pins the two properties that proof relies on:
 *   1. after the reset helper runs -- without waiting on the network -- an
 *      old-identity response can never land anywhere. (This asserts the outcome,
 *      not which call enforces it: in the current query-core, clear() itself also
 *      cancels what it removes, so the explicit cancelQueries() is defense in depth.);
 *   2. the QueryClient the app actually renders with is the lib/query-client
 *      singleton -- the instance AuthProvider resets via useQueryClient().
 */
import { describe, it, expect, vi } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryObserver, useQueryClient } from '@tanstack/react-query'
import { queryClient as appQueryClient, resetQueryClientForIdentityChange } from '../query-client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('resetQueryClientForIdentityChange', () => {
  it('removes cached data, and an in-flight old-identity request can never write its response back', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['platform-dashboard-stats'], { monthlyAwsCost: 1111 })
    client.setQueryData(['platform-dashboard-stats', 'org-a'], { monthlyAwsCost: 1111 })

    const inFlight = deferred<{ owner: string }>()
    const observer = new QueryObserver(client, { queryKey: ['cost-analysis-runs', 'org-a'], queryFn: () => inFlight.promise })
    const unsubscribe = observer.subscribe(() => {})
    expect(observer.getCurrentResult().fetchStatus).toBe('fetching')

    // Resolves while the old request is still unanswered -- the reset never waits on the network.
    await resetQueryClientForIdentityChange(client)

    expect(client.getQueryCache().getAll()).toEqual([])

    // The old identity's response finally arrives...
    inFlight.resolve({ owner: 'org-a' })
    await inFlight.promise
    await Promise.resolve()

    // ...and lands nowhere: not in the cache, not even in an observer still bound to it.
    expect(client.getQueryCache().getAll()).toEqual([])
    expect(client.getQueryData(['cost-analysis-runs', 'org-a'])).toBeUndefined()
    expect(observer.getCurrentResult().data).toBeUndefined()
    unsubscribe()
  })
})

describe('application QueryClient wiring', () => {
  it('app/providers.tsx renders with the lib/query-client singleton (the instance AuthProvider resets)', async () => {
    const { Providers } = await import('@/app/providers')
    let seen: QueryClient | undefined
    function Probe() {
      const client = useQueryClient()
      useEffect(() => { seen = client })
      return null
    }
    render(<Providers><Probe /></Providers>)
    expect(seen).toBe(appQueryClient)
  })
})
