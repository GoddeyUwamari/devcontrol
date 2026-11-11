/**
 * CAT-3 (§4.3, C3-D9): a managed (hand-provisioned) plan is billed by our team,
 * so its invoices never appear on this page; the empty state says so instead
 * of "after your first billing cycle". Self-serve copy is unchanged.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InvoiceList } from '../invoice-list'
import type { Invoice } from '@/types/billing'

describe('InvoiceList empty state', () => {
  it('managed plan: invoices come from our team by email, with the support address', () => {
    const { container } = render(<InvoiceList invoices={[]} managed />)
    expect(screen.getByText('No invoices on this page')).toBeInTheDocument()
    expect(container.textContent).toContain('Your plan is billed by our team, so invoices come by email, not through this page. For a copy, email support@getdevcontrol.com.')
    expect(screen.getByText('support@getdevcontrol.com').closest('a')!.getAttribute('href')).toBe('mailto:support@getdevcontrol.com')
    expect(container.textContent).not.toMatch(/first billing cycle|No invoices yet/)
  })

  it('self-serve plan: unchanged', () => {
    const { container } = render(<InvoiceList invoices={[]} />)
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
    expect(container.textContent).toContain('Your invoices will appear here after your first billing cycle')
    expect(container.textContent).not.toContain('billed by our team')
  })

  it('managed plan with invoices: the list still shows them', () => {
    const invoice: Invoice = {
      id: 'in_1', number: 'INV-001', status: 'paid', amount_paid: 4900, currency: 'usd',
      created: 1762000000, pdfUrl: null, hostedUrl: null, amount_refunded: 0, refund_status: null,
    }
    const { container } = render(<InvoiceList invoices={[invoice]} managed />)
    expect(container.textContent).toContain('INV-001')
    expect(container.textContent).not.toContain('No invoices on this page')
  })
})
