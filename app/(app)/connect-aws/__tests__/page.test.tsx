/**
 * Regression coverage for the Traffic Experiment #1 readiness audit's P0 fix:
 * a successful AWS connection must invalidate the dashboard's cached
 * `platform-dashboard-stats` query (4hr staleTime, refetchOnMount disabled —
 * see app/(app)/dashboard/page.tsx), not just `aws-accounts`. Without this,
 * a user redirected to /dashboard immediately after connecting would be
 * stuck looking at pre-connection (empty) stats for up to 4 hours.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConnectAwsPage from '../page'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/gtag', () => ({
  trackLeadQualified: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockConnectInit = vi.fn()
const mockConnect = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    connectInit: (...args: unknown[]) => mockConnectInit(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}))

const CONNECT_INIT_DATA = {
  externalId: 'ext-123',
  platformAccountId: '999999999999',
  trustPolicy: { Version: '2012-10-17', Statement: [] },
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectAwsPage />
    </QueryClientProvider>
  )
}

async function fillValidRoleArnAndGetButton() {
  const input = await screen.findByPlaceholderText(/arn:aws:iam/i)
  fireEvent.change(input, { target: { value: 'arn:aws:iam::123456789012:role/DevControlRole' } })
  const button = screen.getByRole('button', { name: /connect account/i })
  // Button is disabled until connectInit() resolves and populates initData.
  await waitFor(() => expect(button).not.toBeDisabled())
  return button
}

describe('Connect AWS page — dashboard cache invalidation on successful connection', () => {
  beforeEach(() => {
    mockConnectInit.mockResolvedValue(CONNECT_INIT_DATA)
    vi.clearAllMocks()
    mockConnectInit.mockResolvedValue(CONNECT_INIT_DATA)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('invalidates both aws-accounts and platform-dashboard-stats on a successful connection', async () => {
    mockConnect.mockResolvedValue({ id: 1, org_id: 'org-1', account_id: '123456789012', role_arn: 'arn:aws:iam::123456789012:role/DevControlRole', nickname: null, external_id: 'ext-123', region: 'us-east-1', connected_at: new Date().toISOString(), status: 'active' })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderPage(queryClient)
    const button = await fillValidRoleArnAndGetButton()
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalled()
    })

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(invalidatedKeys).toContainEqual(['aws-accounts'])
    expect(invalidatedKeys).toContainEqual(['platform-dashboard-stats'])
    // Exactly these two — no unrelated query invalidations introduced.
    expect(invalidatedKeys).toHaveLength(2)
  })

  it('does not invalidate any query when the connection attempt fails', async () => {
    mockConnect.mockRejectedValue({ response: { data: { message: 'Failed to assume role' } } })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderPage(queryClient)
    const button = await fillValidRoleArnAndGetButton()
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
