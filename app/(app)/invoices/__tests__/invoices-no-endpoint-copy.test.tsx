/**
 * CAT-3 (C3-D11, copy PENDING FOUNDER APPROVAL): /api/billing/invoices has no
 * backend route, so this page's request always fails. It must not call that
 * "usually temporary" or blame AWS permissions; it says where invoices are.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(async () => { throw Object.assign(new Error('HTTP 404'), { response: { status: 404 } }) }) },
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (select?: (s: { enabled: boolean }) => unknown) => (select ? select({ enabled: false }) : { enabled: false }) }))
vi.mock('@/components/invoices/invoice-form-dialog', () => ({ InvoiceFormDialog: () => null }))
vi.mock('@/components/invoices/invoice-actions', () => ({ InvoiceActions: () => null }))

import InvoicesPage from '../page'

describe('/invoices when the invoices request fails', () => {
  it('says where invoices are, with a link to Billing; no "temporary" error or AWS permission hint', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(<QueryClientProvider client={client}><InvoicesPage /></QueryClientProvider>)

    await screen.findByText("Invoices aren't shown on this page yet")
    expect(container.textContent).toContain('Self-serve plans: your invoices are under Manage Billing on the Billing page. Plans billed by our team: invoices come from us by email.')
    expect(screen.getByText('Go to Billing →').getAttribute('href')).toBe('/settings/billing')
    expect(container.textContent).not.toMatch(/usually temporary|Having trouble fetching billing data|ce:GetCostAndUsage|Missing billing permissions/)
  })
})
