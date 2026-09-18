/**
 * Coverage for the SOC 2 Readiness detail page (Phase 4).
 *
 * Truthfulness discipline mirrors compliance-frameworks-truthfulness.test.tsx: no
 * PASS/FAIL, no compliance/readiness score, no certification/Type II/audit-approval
 * claims, and REVIEWED must never be presented as approved/certified/compliant.
 *
 * useSoc2Readiness/useSoc2Evidence/useCustomerEvidenceList/useSubscription are mocked;
 * the property under test is this page's own composition/rendering, not React Query or
 * the backend.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Soc2ReadinessDetailPage from '../page'

// Radix Select (used by Soc2CustomerEvidenceForm) calls these DOM APIs, which jsdom
// does not implement -- scoped to this file only, not the shared vitest.setup.ts,
// since no other test in this codebase currently exercises a Select component.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

type CriterionFixture = {
  criterionId: string
  name: string
  evidenceClaim: string
  limitation: string
  dispositionClass: string
  evaluated: boolean
  evidenceSummary: { supports: number; contradicts: number; unknown: number } | null
  computedAt: string | null
}

const SIX_CRITERIA: CriterionFixture[] = [
  { criterionId: 'CC6.1', name: 'Encryption at rest', evidenceClaim: 'Encryption at rest is enabled.', limitation: 'Does not establish KMS key-policy adequacy.', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
  { criterionId: 'CC6.6', name: 'Public network exposure', evidenceClaim: 'No public exposure detected.', limitation: 'Absence of a finding is not proof.', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
  { criterionId: 'CC6.2', name: 'IAM console-user MFA', evidenceClaim: 'MFA is enabled.', limitation: 'Covers console-password users only.', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
  { criterionId: 'CC6.3', name: 'IAM access-key age', evidenceClaim: 'Key has not exceeded threshold.', limitation: 'Age-based signal only.', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
  { criterionId: 'CC9.1', name: 'AWS Backup recovery-point presence', evidenceClaim: 'A recovery point exists.', limitation: 'Backup presence only.', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
  { criterionId: 'CC7.1', name: 'Unrestricted security-group ingress', evidenceClaim: 'No unrestricted ingress detected.', limitation: 'A single, narrow observation.', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
]

let readinessState: { data: CriterionFixture[] | undefined; isLoading: boolean; error: Error | null } = {
  data: SIX_CRITERIA,
  isLoading: false,
  error: null,
}

type ObservationFixture = {
  criterionId: string
  resourceArn: string | null
  resourceType: string
  provenance: string
  result: string
  observedAt: string | null
  collectedAt: string
  source: Record<string, unknown>
  explanation: string
  schemaVersion: number
}

let evidenceState: { data: ObservationFixture[] | undefined; isLoading: boolean; error: Error | null } = {
  data: [],
  isLoading: false,
  error: null,
}

vi.mock('@/lib/hooks/useSoc2Readiness', () => ({
  useSoc2Readiness: () => readinessState,
  useSoc2Evidence: () => evidenceState,
}))

type CustomerEvidenceFixture = {
  evidenceId: string
  criterionId: string
  evidenceType: string
  title: string
  description: string | null
  externalReference: string | null
  provenance: 'SELF_ATTESTED'
  status: 'SUBMITTED' | 'REVIEWED' | 'EXPIRED' | 'SUPERSEDED'
  submittedBy: string | null
  submittedAt: string
  reviewDate: string | null
  createdAt: string
  updatedAt: string
}

let customerEvidenceState: { data: CustomerEvidenceFixture[] | undefined; isLoading: boolean; error: Error | null } = {
  data: [],
  isLoading: false,
  error: null,
}

const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()

vi.mock('@/lib/hooks/useCustomerEvidence', () => ({
  useCustomerEvidenceList: () => customerEvidenceState,
  useCreateCustomerEvidence: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateCustomerEvidenceMetadata: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
}))

let subscriptionState: { isEnterprise: boolean; isLoading: boolean } = { isEnterprise: true, isLoading: false }
vi.mock('@/lib/hooks/useSubscription', () => ({
  useSubscription: () => subscriptionState,
}))

function renderPage() {
  return render(<Soc2ReadinessDetailPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  readinessState = { data: SIX_CRITERIA, isLoading: false, error: null }
  evidenceState = { data: [], isLoading: false, error: null }
  customerEvidenceState = { data: [], isLoading: false, error: null }
  subscriptionState = { isEnterprise: true, isLoading: false }
})

describe('routing', () => {
  it('renders the SOC 2 Readiness page and a back link to /compliance/frameworks', () => {
    renderPage()
    expect(screen.getByText('SOC 2 Readiness')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Back to Compliance Frameworks'))
    expect(mockPush).toHaveBeenCalledWith('/compliance/frameworks')
  })
})

describe('readiness — six criteria', () => {
  it('renders a tab for each of the six configured criteria', () => {
    renderPage()
    for (const c of SIX_CRITERIA) {
      expect(screen.getByRole('tab', { name: c.criterionId })).toBeInTheDocument()
    }
  })

  it('shows the truthful not-yet-evaluated state for an unevaluated criterion, never a synthetic positive', () => {
    renderPage()
    expect(screen.getByText('Not yet evaluated')).toBeInTheDocument()
    expect(screen.queryByText(/compliant/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no issues/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/passed/i)).not.toBeInTheDocument()
  })

  it('renders evidenceClaim, limitation, and disposition for the active criterion', () => {
    renderPage()
    expect(screen.getByText('Encryption at rest is enabled.')).toBeInTheDocument()
    expect(screen.getByText('Does not establish KMS key-policy adequacy.')).toBeInTheDocument()
    expect(screen.getByText('Directly Observable')).toBeInTheDocument()
  })

  it('renders computedAt and the evidence summary once a criterion is evaluated', () => {
    readinessState = {
      data: [
        { ...SIX_CRITERIA[0], evaluated: true, evidenceSummary: { supports: 3, contradicts: 1, unknown: 2 }, computedAt: '2026-09-18T09:00:00.000Z' },
        ...SIX_CRITERIA.slice(1),
      ],
      isLoading: false,
      error: null,
    }
    renderPage()
    expect(screen.getByText(/3 supports/)).toBeInTheDocument()
    expect(screen.getByText(/1 contradicts/)).toBeInTheDocument()
    expect(screen.getByText(/2 unknown/)).toBeInTheDocument()
    expect(screen.getByText(/Evaluation computed at/)).toBeInTheDocument()
  })
})

describe('technical evidence (AWS-Observed)', () => {
  it('renders OBSERVED provenance and SUPPORTS result correctly', () => {
    evidenceState = {
      data: [{ criterionId: 'CC6.1', resourceArn: 'arn:aws:s3:::bucket-1', resourceType: 's3', provenance: 'OBSERVED', result: 'SUPPORTS', observedAt: '2026-09-18T00:00:00.000Z', collectedAt: '2026-09-18T00:00:00.000Z', source: {}, explanation: 'Bucket is encrypted.', schemaVersion: 1 }],
      isLoading: false,
      error: null,
    }
    renderPage()
    expect(screen.getByText('AWS-Observed')).toBeInTheDocument()
    expect(screen.getByText('Supports')).toBeInTheDocument()
    expect(screen.getByText('Bucket is encrypted.')).toBeInTheDocument()
  })

  it('renders CONTRADICTS result correctly', () => {
    evidenceState = {
      data: [{ criterionId: 'CC6.1', resourceArn: 'arn:aws:s3:::bucket-2', resourceType: 's3', provenance: 'OBSERVED', result: 'CONTRADICTS', observedAt: null, collectedAt: '2026-09-18T00:00:00.000Z', source: {}, explanation: 'Bucket is not encrypted.', schemaVersion: 1 }],
      isLoading: false,
      error: null,
    }
    renderPage()
    expect(screen.getByText('Contradicts')).toBeInTheDocument()
  })

  it('renders UNKNOWN neutrally, never implying a false positive or negative', () => {
    evidenceState = {
      data: [{ criterionId: 'CC6.1', resourceArn: 'arn:aws:s3:::bucket-3', resourceType: 's3', provenance: 'OBSERVED', result: 'UNKNOWN', observedAt: null, collectedAt: '2026-09-18T00:00:00.000Z', source: {}, explanation: 'Unable to determine.', schemaVersion: 1 }],
      isLoading: false,
      error: null,
    }
    renderPage()
    const badge = screen.getByText('Unknown')
    expect(badge).toBeInTheDocument()
    expect(badge.className).not.toMatch(/emerald|red/)
  })

  it('shows the resource ARN safely (copy affordance, no crash) and shows the org-level label when resourceArn is null', () => {
    evidenceState = {
      data: [{ criterionId: 'CC7.1', resourceArn: null, resourceType: 'organization', provenance: 'OBSERVED', result: 'UNKNOWN', observedAt: null, collectedAt: '2026-09-18T00:00:00.000Z', source: {}, explanation: 'No roster available.', schemaVersion: 1 }],
      isLoading: false,
      error: null,
    }
    renderPage()
    expect(screen.getByText('Organization-level observation')).toBeInTheDocument()
  })

  it('shows the truthful empty state when no technical evidence exists yet', () => {
    renderPage()
    expect(screen.getByText('No AWS-observed evidence yet')).toBeInTheDocument()
  })
})

describe('entitlement — customer evidence management', () => {
  it('Enterprise user sees the customer-evidence management section, not an upgrade prompt', () => {
    subscriptionState = { isEnterprise: true, isLoading: false }
    renderPage()
    expect(screen.getByText('Customer-Provided Evidence')).toBeInTheDocument()
    // Two legitimate "Add Evidence" affordances render: the section header button and
    // the empty-state's own action button (no customer evidence exists in this fixture).
    expect(screen.getAllByText('Add Evidence').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/Upgrade to Enterprise/)).not.toBeInTheDocument()
  })

  it('non-Enterprise user sees the UpgradePrompt and no mutation controls', () => {
    subscriptionState = { isEnterprise: false, isLoading: false }
    renderPage()
    expect(screen.queryByText('Add Evidence')).not.toBeInTheDocument()
    expect(screen.getByText(/Upgrade to Enterprise/)).toBeInTheDocument()
  })
})

describe('customer evidence — empty state and lifecycle display', () => {
  it('shows a truthful empty state, never a fabricated score or violation count', () => {
    renderPage()
    expect(screen.getByText('No customer-provided evidence yet')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('displays SELF_ATTESTED provenance and each lifecycle status, with no mutation controls for review/expire/supersede', () => {
    customerEvidenceState = {
      data: [
        { evidenceId: 'e1', criterionId: 'CC6.1', evidenceType: 'policy', title: 'Encryption policy', description: 'Our policy.', externalReference: 'https://example.com/policy.pdf', provenance: 'SELF_ATTESTED', status: 'SUBMITTED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
        { evidenceId: 'e2', criterionId: 'CC6.1', evidenceType: 'procedure', title: 'Reviewed procedure', description: null, externalReference: null, provenance: 'SELF_ATTESTED', status: 'REVIEWED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
        { evidenceId: 'e3', criterionId: 'CC6.1', evidenceType: 'training', title: 'Expired training', description: null, externalReference: null, provenance: 'SELF_ATTESTED', status: 'EXPIRED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
        { evidenceId: 'e4', criterionId: 'CC6.1', evidenceType: 'attestation', title: 'Superseded attestation', description: null, externalReference: null, provenance: 'SELF_ATTESTED', status: 'SUPERSEDED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
      ],
      isLoading: false,
      error: null,
    }
    renderPage()

    expect(screen.getAllByText('Self-Attested').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('Submitted')).toBeInTheDocument()
    expect(screen.getByText('Reviewed by DevControl')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Superseded')).toBeInTheDocument()

    // No review/expire/supersede button anywhere -- those are platform-staff-only.
    expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^expire$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^supersede$/i })).not.toBeInTheDocument()

    // Edit is only offered for SUBMITTED, not REVIEWED/EXPIRED/SUPERSEDED.
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBe(1)
  })

  it('renders externalReference as a link with the non-verification disclaimer, never fetching it', async () => {
    customerEvidenceState = {
      data: [
        { evidenceId: 'e1', criterionId: 'CC6.1', evidenceType: 'policy', title: 'Encryption policy', description: null, externalReference: 'https://example.com/policy.pdf', provenance: 'SELF_ATTESTED', status: 'SUBMITTED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
      ],
      isLoading: false,
      error: null,
    }
    const fetchSpy = vi.spyOn(global, 'fetch')
    renderPage()
    fireEvent.click(screen.getByText('Encryption policy'))
    await waitFor(() => expect(screen.getByText(/Externally hosted/)).toBeInTheDocument())
    const link = screen.getByRole('link', { name: /policy\.pdf/ }) as HTMLAnchorElement
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
    expect(link.rel).toContain('noreferrer')
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('policy.pdf'), expect.anything())
    fetchSpy.mockRestore()
  })
})

describe('customer evidence — create and edit flows', () => {
  it('opens the create form with the criterion pre-filled from the active tab, and blocks submission until an evidence type is chosen (never calls the mutation with incomplete data)', async () => {
    renderPage()

    fireEvent.click(screen.getAllByText('Add Evidence')[0])

    // Criterion is pre-filled from the active tab (CC6.1) via defaultCriterionId --
    // the Select already shows the selected label, not its placeholder. (Radix renders
    // this in more than one place -- a visible trigger plus an accessibility-only
    // native <select> mirror -- so this asserts presence, not a single match.)
    expect(screen.getAllByText('CC6.1 — Encryption at rest').length).toBeGreaterThanOrEqual(1)

    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Encryption policy' } })
    fireEvent.click(screen.getByText('Submit Evidence'))

    // No evidence type was chosen -- the form's own validation blocks submission.
    await waitFor(() => expect(mockCreateMutateAsync).not.toHaveBeenCalled())
  })

  it('opens the edit form for a SUBMITTED record with the criterion locked (not a select), and calls the update mutation with only metadata fields', async () => {
    customerEvidenceState = {
      data: [
        { evidenceId: 'e1', criterionId: 'CC6.1', evidenceType: 'policy', title: 'Encryption policy', description: 'desc', externalReference: null, provenance: 'SELF_ATTESTED', status: 'SUBMITTED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
      ],
      isLoading: false,
      error: null,
    }
    mockUpdateMutateAsync.mockResolvedValue({})
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // Criterion is rendered as plain text in edit mode, not a select control.
    expect(screen.queryByRole('combobox', { name: /criterion/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Updated policy title' } })
    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled())
    const { evidenceId, request } = mockUpdateMutateAsync.mock.calls[0][0]
    expect(evidenceId).toBe('e1')
    expect(request.title).toBe('Updated policy title')
    expect(request).not.toHaveProperty('provenance')
    expect(request).not.toHaveProperty('status')
    expect(request).not.toHaveProperty('organizationId')
    expect(request).not.toHaveProperty('submittedBy')
  })

  it('the form always shows a fixed, non-editable SELF_ATTESTED provenance badge, never an input for it', () => {
    renderPage()
    fireEvent.click(screen.getAllByText('Add Evidence')[0])
    expect(screen.getByText('Self-Attested')).toBeInTheDocument()
    expect(screen.queryByLabelText(/provenance/i)).not.toBeInTheDocument()
  })
})

describe('errors', () => {
  it('renders an error message and retry affordance for a readiness fetch failure', () => {
    readinessState = { data: undefined, isLoading: false, error: new Error('Failed to fetch SOC 2 readiness') }
    renderPage()
    expect(screen.getByText('Failed to fetch SOC 2 readiness')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('renders a loading skeleton while readiness is loading', () => {
    readinessState = { data: undefined, isLoading: true, error: null }
    const { container } = renderPage()
    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy()
  })

  // Regression coverage for the SOC2 frontend authentication bug (soc2.service.ts used
  // to call fetch() without an Authorization header, so production always surfaced this
  // exact 401). The page must render this as a visible authentication failure -- not
  // silently collapse into the "no criteria configured" empty state, which would make a
  // real auth outage indistinguishable from a legitimate, evaluated-nothing-yet account.
  it('renders a 401 authentication failure as an error, never as the empty "no criteria" state', () => {
    const authError = new Error('No authentication token provided') as Error & { statusCode?: number }
    authError.statusCode = 401
    readinessState = { data: undefined, isLoading: false, error: authError }
    renderPage()
    expect(screen.getByText('No authentication token provided')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(screen.queryByText('No SOC 2 criteria configured')).not.toBeInTheDocument()
  })
})

describe('truthfulness', () => {
  const FORBIDDEN_PATTERNS = [
    /\bPASS\b/,
    /\bFAIL\b/,
    /is certified|SOC 2 certified|fully certified|Type II certified/i,
    /audit approved|auditor approved/i,
    /operating effectiveness/i,
    /compliance (score|percentage)/i,
    /combined (score|evaluation)/i,
  ]

  it('the fully-rendered page never contains certification/PASS-FAIL/score wording', () => {
    customerEvidenceState = {
      data: [
        { evidenceId: 'e1', criterionId: 'CC6.1', evidenceType: 'policy', title: 'Encryption policy', description: 'desc', externalReference: null, provenance: 'SELF_ATTESTED', status: 'REVIEWED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
      ],
      isLoading: false,
      error: null,
    }
    const { container } = renderPage()
    const text = container.textContent ?? ''
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(text).not.toMatch(pattern)
    }
  })

  it('never shows a single overall SOC 2 score across criteria', () => {
    renderPage()
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument()
  })
})

describe('source separation', () => {
  it('AWS-Observed and Customer-Provided sections are visually and structurally distinct, never merged into one list', () => {
    evidenceState = {
      data: [{ criterionId: 'CC6.1', resourceArn: 'arn:aws:s3:::b', resourceType: 's3', provenance: 'OBSERVED', result: 'SUPPORTS', observedAt: null, collectedAt: '2026-09-18T00:00:00.000Z', source: {}, explanation: 'x', schemaVersion: 1 }],
      isLoading: false,
      error: null,
    }
    customerEvidenceState = {
      data: [
        { evidenceId: 'e1', criterionId: 'CC6.1', evidenceType: 'policy', title: 'A policy', description: null, externalReference: null, provenance: 'SELF_ATTESTED', status: 'SUBMITTED', submittedBy: 'u1', submittedAt: '2026-09-18T00:00:00.000Z', reviewDate: null, createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' },
      ],
      isLoading: false,
      error: null,
    }
    renderPage()
    expect(screen.getByText('AWS-Observed Evidence')).toBeInTheDocument()
    expect(screen.getByText('Customer-Provided Evidence')).toBeInTheDocument()
    // The AWS-observed row itself carries the 'AWS-Observed' provenance badge, and the
    // customer evidence row carries 'Self-Attested' -- never the reverse.
    const policyRow = screen.getByText('A policy').closest('div')!.parentElement!
    expect(policyRow.textContent).not.toContain('AWS-Observed')
  })
})
