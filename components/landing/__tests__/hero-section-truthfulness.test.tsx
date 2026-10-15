/**
 * Product-truthfulness coverage for the marketing homepage hero trust badges
 * (product-truthfulness remediation, Phase 5 compliance audit).
 *
 * Prior state: "SOC 2 In Progress" implied an active SOC 2 audit/attestation
 * that isn't underway, and "GDPR Ready" is a substantive compliance claim with
 * no supporting implementation (no DPA, no subprocessor list, no data-subject
 * tooling) — see the Phase 5 audit. The marketing hero w1 redesign replaced the
 * badge row with "Read-only access", "No agents" and "AES-256 encryption", and
 * dropped the SOC 2 badge entirely (founder decision, Option A).
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

  it('shows no SOC 2 badge at all', () => {
    render(<HeroSection />)
    expect(screen.queryByText(/SOC 2/)).not.toBeInTheDocument()
  })

  it('never shows a "GDPR Ready" or other unsupported GDPR compliance claim', () => {
    render(<HeroSection />)
    expect(screen.queryByText(/GDPR/)).not.toBeInTheDocument()
  })

  it('shows the approved badges and none of the old badge wording', () => {
    render(<HeroSection />)
    expect(screen.getByText('Read-only access', { selector: '[data-testid="hero-trust-badge"]' })).toBeInTheDocument()
    expect(screen.getByText('No agents', { selector: '[data-testid="hero-trust-badge"]' })).toBeInTheDocument()
    expect(screen.getByText('AES-256 encryption', { selector: '[data-testid="hero-trust-badge"]' })).toBeInTheDocument()
    expect(screen.queryByText('Read-only IAM')).not.toBeInTheDocument()
    expect(screen.queryByText('AES-256 Encryption')).not.toBeInTheDocument()
  })

  it('renders exactly three trust badges', () => {
    render(<HeroSection />)
    const badges = screen.getAllByTestId('hero-trust-badge').map((el) => el.textContent)
    expect(badges).toEqual(['Read-only access', 'No agents', 'AES-256 encryption'])
  })
})
