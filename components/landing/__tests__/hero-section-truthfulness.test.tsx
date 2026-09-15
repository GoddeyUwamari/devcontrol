/**
 * Product-truthfulness coverage for the marketing homepage hero trust badges
 * (product-truthfulness remediation, Phase 5 compliance audit).
 *
 * Prior state: "SOC 2 In Progress" implied an active SOC 2 audit/attestation
 * that isn't underway, and "GDPR Ready" is a substantive compliance claim with
 * no supporting implementation (no DPA, no subprocessor list, no data-subject
 * tooling) — see the Phase 5 audit. "Read-only IAM" and "AES-256 Encryption"
 * remain because they're genuinely implemented (see app/(app)/connect-aws/page.tsx's
 * ReadOnlyAccess IAM instructions and backend/src/services/encryption.service.ts's
 * AES-256-GCM credential encryption).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroSection } from '../HeroSection'

describe('HeroSection trust badges', () => {
  it('never claims SOC 2 is in progress, certified, compliant, or Type II', () => {
    render(<HeroSection />)
    expect(screen.queryByText(/SOC 2 In Progress/)).not.toBeInTheDocument()
    expect(screen.queryByText(/SOC 2 Certified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/SOC 2 Compliant/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/SOC 2 Type II/i)).not.toBeInTheDocument()
  })

  it('uses truthful future-state SOC 2 wording', () => {
    render(<HeroSection />)
    expect(screen.getByText('SOC 2 Readiness Planned')).toBeInTheDocument()
  })

  it('never shows a "GDPR Ready" or other unsupported GDPR compliance claim', () => {
    render(<HeroSection />)
    expect(screen.queryByText(/GDPR/)).not.toBeInTheDocument()
  })

  it('keeps the genuinely-implemented badges unchanged', () => {
    render(<HeroSection />)
    expect(screen.getByText('Read-only IAM')).toBeInTheDocument()
    expect(screen.getByText('AES-256 Encryption')).toBeInTheDocument()
  })

  it('renders exactly three trust badges', () => {
    render(<HeroSection />)
    const badges = ['Read-only IAM', 'AES-256 Encryption', 'SOC 2 Readiness Planned']
    for (const label of badges) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
