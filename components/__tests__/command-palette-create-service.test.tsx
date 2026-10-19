/**
 * The command palette's "Create Service" action opens the Add Service form
 * (/services/new), not the services list.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from '../command-palette'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/services/services.service', () => ({ servicesService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/deployments.service', () => ({ deploymentsService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { query: vi.fn() } }))

beforeAll(() => {
  // cmdk scrolls the active item into view and measures the list.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  }
})

describe('command palette: Create Service', () => {
  it('goes to /services/new', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><CommandPalette /></QueryClientProvider>)

    await act(async () => { fireEvent.keyDown(document, { key: 'k', metaKey: true }) })
    await act(async () => { fireEvent.click(await screen.findByText('Create Service')) })

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/services/new')
  })
})
