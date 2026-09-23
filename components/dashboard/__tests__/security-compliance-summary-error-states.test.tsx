/**
 * Security Key Findings: a failed request must never read as a real result.
 *
 * Each fact on the card (account findings, resource compliance, SOC 2 readiness,
 * custom frameworks) has four distinct states -- loading, error, genuine empty,
 * data -- and the error state ("Unavailable") must never fall through to that
 * fact's empty/not-evaluated text. Page-level wiring (real queries failing) is
 * covered in app/(app)/dashboard/__tests__/key-findings-error-states.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SecurityComplianceSummary } from '../security-compliance-summary'

type Props = ComponentProps<typeof SecurityComplianceSummary>

const ZERO = { critical: 0, high: 0, medium: 0, low: 0 }
const EMPTY_FINDINGS_TEXT = 'No open account-level findings recorded yet.'

function renderCard(overrides: Partial<Props> = {}) {
  const props: Props = {
    findingCounts: ZERO,
    riskDataLoading: false,
    complianceBreakdown: null,
    soc2Subtext: '0 of 6 criteria evaluated',
    soc2Loading: false,
    customFrameworksSubtext: 'No custom frameworks yet',
    customFrameworksLoading: false,
    ...overrides,
  }
  return render(<SecurityComplianceSummary {...props} />)
}

/** The sub-line of the info row with the given headline. */
function subOf(headline: string) {
  const row = screen.getByText(headline).parentElement as HTMLElement
  return within(row).getAllByText(/.+/).at(-1)?.textContent
}

describe('account-level findings', () => {
  it('request failed -> "Unavailable", not the genuine-empty text', () => {
    renderCard({ findingCounts: null, findingsError: true })
    expect(screen.getByText('Account-level findings: Unavailable')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_FINDINGS_TEXT)).not.toBeInTheDocument()
  })

  it('successful response with all-zero counts -> existing genuine-empty text (unchanged)', () => {
    renderCard({ findingCounts: ZERO })
    expect(screen.getByText(EMPTY_FINDINGS_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument()
  })

  it('successful response with findings -> the severity rows (unchanged)', () => {
    renderCard({ findingCounts: { critical: 1, high: 2, medium: 0, low: 0 } })
    expect(screen.getByText('1 critical finding')).toBeInTheDocument()
    expect(screen.getByText('2 high findings')).toBeInTheDocument()
  })

  it('loading -> skeletons, neither empty text nor "Unavailable" (unchanged)', () => {
    renderCard({ findingCounts: null, riskDataLoading: true, findingsError: true, resourceComplianceError: true })
    expect(screen.queryByText(EMPTY_FINDINGS_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument()
    expect(screen.queryByText('Resource compliance')).not.toBeInTheDocument()
  })
})

describe('resource compliance', () => {
  it('request failed -> "Unavailable", not "Not yet evaluated"', () => {
    renderCard({ resourceComplianceError: true })
    expect(subOf('Resource compliance')).toBe('Unavailable')
    expect(screen.queryByText('Not yet evaluated')).not.toBeInTheDocument()
  })

  it('successful response with no severity counts -> existing "Not yet evaluated" (unchanged)', () => {
    renderCard({ complianceBreakdown: null })
    expect(subOf('Resource compliance')).toBe('Not yet evaluated')
  })

  it('successful response with issues -> the severity breakdown (unchanged)', () => {
    renderCard({ complianceBreakdown: '2 High · 1 Low' })
    expect(subOf('Resource compliance')).toBe('2 High · 1 Low')
  })
})

describe('SOC 2 readiness', () => {
  it('request failed -> "Unavailable", never "0 of 6 criteria evaluated"', () => {
    renderCard({ soc2Error: true, soc2Subtext: '0 of 6 criteria evaluated' })
    expect(subOf('SOC 2 readiness')).toBe('Unavailable')
    expect(screen.queryByText('0 of 6 criteria evaluated')).not.toBeInTheDocument()
  })

  it('successful response with zero evaluated criteria -> existing "0 of 6 criteria evaluated" (unchanged)', () => {
    renderCard({ soc2Subtext: '0 of 6 criteria evaluated' })
    expect(subOf('SOC 2 readiness')).toBe('0 of 6 criteria evaluated')
  })
})

describe('custom frameworks', () => {
  it('reported error -> "Unavailable", not "No custom frameworks yet"', () => {
    renderCard({ customFrameworksError: true })
    expect(subOf('Custom frameworks')).toBe('Unavailable')
    expect(screen.queryByText('No custom frameworks yet')).not.toBeInTheDocument()
  })

  it('no error and none configured -> existing "No custom frameworks yet" (unchanged)', () => {
    renderCard()
    expect(subOf('Custom frameworks')).toBe('No custom frameworks yet')
  })
})

describe('regression: an error can never render its fact\'s empty state', () => {
  it('with every request failed, none of the four empty/zero texts appears', () => {
    renderCard({
      findingCounts: null,
      findingsError: true,
      resourceComplianceError: true,
      soc2Error: true,
      customFrameworksError: true,
    })
    for (const emptyText of [EMPTY_FINDINGS_TEXT, 'Not yet evaluated', '0 of 6 criteria evaluated', 'No custom frameworks yet']) {
      expect(screen.queryByText(emptyText)).not.toBeInTheDocument()
    }
    expect(screen.getAllByText(/Unavailable/)).toHaveLength(4)
  })

  it('links are unchanged in the error state (rows stay navigable to their detail pages)', () => {
    renderCard({ soc2Error: true, customFrameworksError: true })
    expect(screen.getByText('SOC 2 readiness').closest('a')).toHaveAttribute('href', '/compliance/frameworks/soc2')
    expect(screen.getByText('Custom frameworks').closest('a')).toHaveAttribute('href', '/compliance/frameworks')
  })
})
