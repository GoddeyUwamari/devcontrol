/**
 * Rendering /infrastructure for the overview tests: a fresh QueryClient, and a
 * wait until every request has settled. vi.mock calls stay in each test file
 * (they are hoisted per file).
 */
import { expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'

export function renderInfrastructure() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(<QueryClientProvider client={client}><InfrastructurePage /></QueryClientProvider>)
  return { ...utils, client }
}

/** Until no query is fetching (`pending` may stay open). */
export async function settled(client: QueryClient, pending = 0) {
  await waitFor(() => expect(client.isFetching()).toBe(pending))
}
