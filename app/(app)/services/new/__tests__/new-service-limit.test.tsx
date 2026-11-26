/**
 * /services/new at the services limit (service-limits stage-a C1-C7, approved
 * in Addendum 1). The notice and the disabled submit are explanatory: the
 * server's 402 is the guarantee, and when a stale page still submits, its own
 * message is shown (C7), never the HTTP client's generic text.
 *
 * The page is real; the limit hook, the services/teams clients, the router and
 * the toast are stubbed. The Radix select is replaced with a native one so the
 * form can be filled in jsdom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ServiceLimit } from '@/lib/types'

const { push, toast, refetch, create, state } = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { loading: vi.fn(() => 'toast-1'), success: vi.fn(), error: vi.fn() },
  refetch: vi.fn(),
  create: vi.fn(),
  state: { limit: undefined as ServiceLimit | undefined },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn() }) }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/hooks/use-service-limit', () => ({ useServiceLimit: () => ({ data: state.limit, refetch }) }))
vi.mock('@/lib/services/services.service', () => ({ servicesService: { create: (...a: unknown[]) => create(...a) } }))
vi.mock('@/lib/services/teams.service', () => ({ teamsService: { getAll: async () => [{ id: '00000000-0000-4000-8000-0000000000a1', name: 'Platform' }] } }))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const Ctx = React.createContext<{ value?: string; onValueChange?: (v: string) => void }>({})
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const { value, onValueChange } = React.useContext(Ctx)
      return <select data-testid="native-select" value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}><option value="" />{children}</select>
    },
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  }
})

import NewServicePage from '../page'

const TEAM_ID = '00000000-0000-4000-8000-0000000000a1'

const at = (over: Partial<ServiceLimit> = {}): ServiceLimit => ({
  used: 5, max: 5, plan: 'Visibility', freePlan: 'Visibility', reached: true, upgradeAvailable: true, reason: null, ...over,
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = () => <QueryClientProvider client={client}><NewServicePage /></QueryClientProvider>
  const view = render(page())
  return { ...view, rerenderPage: () => view.rerender(page()) }
}

async function fillForm() {
  fireEvent.change(screen.getByLabelText(/Service Name/), { target: { value: 'checkout-api' } })
  fireEvent.change(screen.getByLabelText(/Owner Email/), { target: { value: 'owner@example.com' } })
  const [template, team] = screen.getAllByTestId('native-select')
  fireEvent.change(template, { target: { value: 'api' } })
  await within(team).findByText('Platform')
  fireEvent.change(team, { target: { value: TEAM_ID } })
}

const submit = () => screen.getByRole('button', { name: /Create Service/ })

beforeEach(() => {
  vi.clearAllMocks()
  state.limit = undefined
})

describe('/services/new at the services limit', () => {
  it('C1 + C2: title, body and "See plans" when an upgrade is offered; submit disabled with C6 as its reason', async () => {
    state.limit = at()
    mount()
    const notice = screen.getByTestId('service-limit-notice')
    expect(notice).toHaveTextContent('Service limit reached')
    expect(notice).toHaveTextContent(
      "Your Visibility plan includes 5 services, and this workspace has 5. Your existing services, deployments and GitHub mappings aren't affected. See plans",
    )
    expect(within(notice).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    const reason = screen.getByTestId('service-limit-submit-reason')
    expect(reason).toHaveTextContent('Service limit reached')
    expect(submit()).toHaveAttribute('aria-describedby', reason.id)
  })

  it('C6: a valid, submittable form is disabled by the limit alone, and a click creates nothing', async () => {
    state.limit = at({ used: 4, reached: false })
    const view = mount()
    await fillForm()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    expect(submit()).not.toHaveAttribute('aria-describedby')

    state.limit = at()
    view.rerenderPage()
    expect(submit()).toBeDisabled()
    expect(submit()).toHaveAttribute('aria-describedby', screen.getByTestId('service-limit-submit-reason').id)
    fireEvent.click(submit())
    fireEvent.submit(submit().closest('form')!)
    await new Promise((r) => setTimeout(r, 50))
    expect(create).not.toHaveBeenCalled()
  })

  it('C3: a managed plan (no upgrade offered) gets the support contact, no "See plans"', () => {
    state.limit = at({ plan: 'Cost Control', max: 20, used: 20, upgradeAvailable: false })
    mount()
    const notice = screen.getByTestId('service-limit-notice')
    expect(notice).toHaveTextContent(
      "Your Cost Control plan includes 20 services, and this workspace has 20. Your existing services, deployments and GitHub mappings aren't affected. To change your plan's limits, contact us.",
    )
    expect(within(notice).getByRole('link', { name: 'contact us' })).toHaveAttribute('href', 'mailto:support@getdevcontrol.com')
    expect(within(notice).queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('C4: a billing hold says billing, with "Update billing"', () => {
    state.limit = at({ reason: 'BILLING_RESTRICTED', used: 8 })
    mount()
    const notice = screen.getByTestId('service-limit-notice')
    expect(notice).toHaveTextContent(
      "Billing needs attention, so this workspace has the Visibility limit of 5 services until it's resolved. It has 8. Your existing services aren't affected. Update billing",
    )
    expect(within(notice).getByRole('link', { name: 'Update billing' })).toHaveAttribute('href', '/settings/billing')
    expect(within(notice).queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('C5: over the limit (after a downgrade) is the same sentence with the real count', () => {
    state.limit = at({ used: 7 })
    mount()
    expect(screen.getByTestId('service-limit-notice')).toHaveTextContent('Your Visibility plan includes 5 services, and this workspace has 7.')
  })

  it('below the limit, unlimited or unknown: no notice, no reason, the form submits and returns', async () => {
    for (const shown of [at({ used: 4, reached: false }), at({ max: null, reached: false, used: 300 }), undefined]) {
      state.limit = shown
      const view = mount()
      expect(screen.queryByTestId('service-limit-notice')).toBeNull()
      expect(screen.queryByTestId('service-limit-submit-reason')).toBeNull()
      view.unmount()
    }
    state.limit = at({ used: 4, reached: false })
    create.mockResolvedValue({ id: 'svc-1' })
    mount()
    await fillForm()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())
    await waitFor(() => expect(push).toHaveBeenCalledWith('/services'))
    expect(toast.success).toHaveBeenCalledWith('Service created successfully!', { id: 'toast-1' })
  })

  it('C7: a stale page that still submits shows "Service not created" with the server\'s message, stays, and reads the limit again', async () => {
    state.limit = at({ used: 4, reached: false })
    const message = "Your Visibility plan includes 5 services, and this workspace has 5. Existing services aren't affected."
    create.mockRejectedValue(Object.assign(new Error('Request failed with status code 402'), {
      response: { status: 402, data: { success: false, error: message, code: 'RESOURCE_LIMIT_REACHED', details: { resourceType: 'services' } } },
    }))
    mount()
    await fillForm()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Service not created', { id: 'toast-1', description: message }))
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('status code'), expect.anything())
    expect(push).not.toHaveBeenCalled()
    expect(refetch).toHaveBeenCalled()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('any other failure keeps the previous behaviour (its message), not the limit title', async () => {
    state.limit = at({ used: 1, reached: false })
    create.mockRejectedValue(new Error('Team not found'))
    mount()
    await fillForm()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Team not found', { id: 'toast-1' }))
    expect(refetch).not.toHaveBeenCalled()
  })
})
