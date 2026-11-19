/**
 * PR 3d-2 (D8): Connect AWS, next to "Home region · {r}":
 * - the owner (`can_change_home_region`) gets "Change in Services & Ownership →" to /services#region-coverage;
 * - the owner also gets "DevControl has a home-region suggestion for this account. Review it in Services &
 *   Ownership →" exactly when Services' own banner would show (homeRegionPromptShows; founder ruling Nov 19);
 * - a member sees the value only; with the Services redesign off (no Change button or banner there) nothing new shows.
 * The GET /api/aws/accounts answers are the Services home-region tests' own fixtures (accountsAnswer, proposal, split).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConnectAwsPage from '../page'
import { accountsAnswer, proposal, split, splitSeven } from '../../services/__tests__/home-region-fixtures'
import { tab5 } from '../../services/__tests__/redesign-fixtures'
import type { HomeRegionProposalView } from '@/lib/services/aws-accounts.service'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/gtag', () => ({ trackLeadQualified: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))

const mockGetAccountsAndConnection = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    connectInit: vi.fn(),
    connect: vi.fn(),
    getAccountsAndConnection: (...args: unknown[]) => mockGetAccountsAndConnection(...args),
    getConnectionChecks: async () => null,
  },
}))
vi.mock('@/lib/services/aws-services.service', () => ({ default: { getCoverage: async () => tab5('ok') } }))

const CHANGE = 'Change in Services & Ownership →'
const SUGGESTION = 'DevControl has a home-region suggestion for this account. Review it in Services & Ownership →'

async function show(answer: ReturnType<typeof accountsAnswer>) {
  mockGetAccountsAndConnection.mockResolvedValue(answer)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ConnectAwsPage /></QueryClientProvider>)
  await screen.findByTestId('connected-view')
  await screen.findByTestId('coverage-headline')
}
const homeValue = () => screen.getByText('Home region').nextElementSibling as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'true')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('D8: owner', () => {
  it.each([['proposed', proposal()], ['split', split()], ['split, 7 regions', splitSeven()]] as const)('%s: the Change link and the suggestion line', async (_n, p) => {
    await show(accountsAnswer({ proposal: p, canChange: true }))
    expect(homeValue().textContent).toBe(`us-east-1${CHANGE}`)
    expect(screen.getByRole('link', { name: CHANGE })).toHaveAttribute('href', '/services#region-coverage')
    expect(screen.getByTestId('home-region-suggestion').textContent).toBe(SUGGESTION)
    expect(screen.getByRole('link', { name: 'Review it in Services & Ownership →' })).toHaveAttribute('href', '/services')
  })

  it.each([
    ['no_signal', proposal({ state: 'no_signal' })], ['unavailable', proposal({ state: 'unavailable' })], ['none', null],
    ['waiting', proposal({ state: 'waiting' })], ['dismissed', proposal({ state: 'dismissed' })],
    // Founder ruling Nov 19: Services shows no banner for these (services-home-region.test.tsx "3d-2"), so no line here.
    ['proposed, no region', proposal({ region: null })],
    ['proposed, no share for its region', proposal({ shares: proposal().shares.filter((x) => x.region !== 'us-west-2') })],
    ['proposed, no current share', proposal({ current: null })],
  ] as [string, HomeRegionProposalView | null][])('%s: the Change link, never the suggestion', async (_n, p) => {
    await show(accountsAnswer({ proposal: p, canChange: true }))
    expect(screen.getByRole('link', { name: CHANGE })).toHaveAttribute('href', '/services#region-coverage')
    expect(screen.queryByTestId('home-region-suggestion')).toBeNull()
    expect(document.body.textContent).not.toContain('home-region suggestion')
  })

  it('missing keys (an older server): the value only', async () => {
    const answer = accountsAnswer({ proposal: proposal(), canChange: true })
    delete (answer as { homeRegion?: unknown }).homeRegion
    await show(answer)
    expect(homeValue().textContent).toBe('us-east-1')
    expect(screen.queryByRole('link', { name: CHANGE })).toBeNull()
    expect(screen.queryByTestId('home-region-suggestion')).toBeNull()
  })
})

describe('D8: member', () => {
  it.each([['proposed', proposal()], ['split', split()], ['none', null]] as [string, HomeRegionProposalView | null][])('%s: the value only, no link and no suggestion', async (_n, p) => {
    await show(accountsAnswer({ proposal: p, canChange: false }))
    expect(homeValue().textContent).toBe('us-east-1')
    expect(screen.queryByRole('link', { name: CHANGE })).toBeNull()
    expect(screen.queryByTestId('home-region-suggestion')).toBeNull()
  })
})

describe('D8: flag-off unchanged', () => {
  it.each([['V2', 'NEXT_PUBLIC_SERVICES_V2'], ['redesign', 'NEXT_PUBLIC_SERVICES_REDESIGN']])('Services %s off: an owner with a proposal sees the value only', async (_n, flag) => {
    vi.stubEnv(flag, 'false')
    await show(accountsAnswer({ proposal: proposal(), canChange: true }))
    expect(homeValue().textContent).toBe('us-east-1')
    expect(screen.queryByRole('link', { name: CHANGE })).toBeNull()
    expect(screen.queryByTestId('home-region-suggestion')).toBeNull()
  })
})
