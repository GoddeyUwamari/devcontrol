/**
 * PR4c empty states, /compliance/frameworks/soc2 (SOC 2 Readiness).
 *   - Copy, in both states (founder wording): the subtitle and the AWS-Observed Evidence line say "your AWS
 *     account", never "your connected AWS account"; CC6.1's claim says what DevControl checks.
 *   - With no AWS account connected: the card under the subtitle; no per-criterion "Not yet evaluated" block and
 *     no "No AWS-observed evidence yet"; the criterion tabs, their descriptions and Customer-Provided Evidence stay.
 *   - Connected (or when the check fails) the page is otherwise today's. Until the check answers, grey blocks only.
 *
 * GET /api/aws/accounts is the backend's own body through the real service. The readiness criteria are the
 * backend's six for a new org (soc2CriteriaConfig.ts, none evaluated), CC6.1 with its claim as the config has it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accountsResponse, type ConnectionMode } from '@/components/aws/__tests__/accounts-wire'
import Soc2ReadinessDetailPage from '../page'

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

const m = vi.hoisted(() => ({ connection: 'not_connected' as string, enterprise: true }))

const CC61_CLAIM = 'Checks whether encryption at rest is enabled, based on AWS discovery.'
const CRITERIA = [
  { criterionId: 'CC6.1', name: 'Encryption at rest', evidenceClaim: CC61_CLAIM, limitation: 'Does not establish KMS key-policy adequacy, per-object encryption overrides, or that encryption was continuously enabled over any period.' },
  { criterionId: 'CC6.6', name: 'Public network exposure', evidenceClaim: 'No public network exposure was detected on this resource, as observed by AWS discovery.', limitation: 'Absence of a finding is not proof.' },
  { criterionId: 'CC6.2', name: 'IAM console-user MFA', evidenceClaim: 'MFA is enabled.', limitation: 'Console users only.' },
  { criterionId: 'CC6.3', name: 'IAM access-key age', evidenceClaim: 'Key age is within the threshold.', limitation: 'Age only.' },
  { criterionId: 'CC9.1', name: 'AWS Backup recovery-point presence', evidenceClaim: 'A recovery point exists.', limitation: 'Presence only.' },
  { criterionId: 'CC7.1', name: 'Unrestricted security-group ingress', evidenceClaim: 'No unrestricted ingress detected.', limitation: 'One narrow observation.' },
].map((c) => ({ ...c, dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/hooks/useSoc2Readiness', () => ({
  useSoc2Readiness: () => ({ data: CRITERIA, isLoading: false, error: null, refetch: vi.fn() }),
  // soc2.routes.ts GET /evidence for a new org: no observations.
  useSoc2Evidence: () => ({ data: [], isLoading: false, error: null }),
}))
vi.mock('@/lib/hooks/useCustomerEvidence', () => ({
  useCustomerEvidenceList: () => ({ data: [], isLoading: false, error: null }),
  useCreateCustomerEvidence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerEvidenceMetadata: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/hooks/useSubscription', () => ({ useSubscription: () => ({ isEnterprise: m.enterprise, isLoading: false }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))

beforeEach(() => {
  m.connection = 'not_connected'
  m.enterprise = true
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') return accountsResponse(m.connection as ConnectionMode) as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><Soc2ReadinessDetailPage /></QueryClientProvider>)
}

const SUBTITLE = /^Technical evidence DevControl observes from your AWS account, and supporting evidence your\s+organization provides\./
const SECTION_LINE = 'Technical facts DevControl observes directly from your AWS account.'

function expectNewCopy() {
  expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
  expect(screen.getAllByText(SECTION_LINE).length).toBeGreaterThan(0)
  expect(screen.getByText(CC61_CLAIM)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/connected AWS account/)
  expect(document.body.textContent).not.toMatch(/Encryption at rest is enabled for this resource/)
}

describe('PR4c: /compliance/frameworks/soc2 with no AWS account connected', () => {
  it.each([true, false])('enterprise=%s: the card under the subtitle; criteria and Customer-Provided Evidence kept; no evaluation or AWS-observed evidence state', async (enterprise) => {
    m.enterprise = enterprise
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(card.previousElementSibling).toBe(screen.getByRole('heading', { level: 1, name: 'SOC 2 Readiness' }).parentElement)
    expectNewCopy()
    expect(screen.getAllByRole('tab')).toHaveLength(6)
    expect(screen.getByText('Does not establish KMS key-policy adequacy, per-object encryption overrides, or that encryption was continuously enabled over any period.')).toBeInTheDocument()
    expect(screen.getByText('AWS-Observed Evidence')).toBeInTheDocument()
    expect(screen.queryByText('Not yet evaluated')).toBeNull()
    expect(screen.queryByText(/No technical evaluation has been computed/)).toBeNull()
    expect(screen.queryByText('No AWS-observed evidence yet')).toBeNull()
    expect(screen.getAllByText('Customer-Provided Evidence').length).toBeGreaterThan(0)
  })

  it('connection loading: grey blocks only, no card, criteria or evaluation state', async () => {
    m.connection = 'PENDING'
    renderPage()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/aws/accounts'))
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('Not yet evaluated')).toBeNull()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
  })
})

describe('PR4c: /compliance/frameworks/soc2 connected: the new copy, otherwise unchanged', () => {
  it.each(['connected', 'FAIL'])('%s: "Not yet evaluated" and "No AWS-observed evidence yet" stay; no card', async (connection) => {
    m.connection = connection
    renderPage()
    expect(await screen.findByText('Not yet evaluated')).toBeInTheDocument()
    expect(screen.getByText('No AWS-observed evidence yet')).toBeInTheDocument()
    expectNewCopy()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(6)
  })
})
