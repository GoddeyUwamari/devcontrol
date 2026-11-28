/**
 * /services/new for a brand-new workspace (onboarding Stage B, founder rulings D1-D8):
 *   - D1 a team is optional: with no teams at all the form is usable, Create is
 *     enabled once Name and Template are filled, and no team_id is sent;
 *   - D2 Owner email defaults to the signed-in user, stays editable, and a
 *     typed value is never overwritten;
 *   - D3 Template stays required, with today's four choices and nothing preselected;
 *   - D4 the Team label and helper, and no "No teams found" dead end;
 *   - D8 "More options" (Team, Owner email, GitHub URL, Description) starts
 *     collapsed with the approved hint under it (fix round 1), is a real button with aria-expanded/aria-controls, and opens
 *     whenever a field inside it has an error (or there is no owner to default to);
 *   - the GitHub page's "Create a service ->" return path survives (no team detour).
 *
 * The page is real; the limit hook, the services/teams clients, the signed-in
 * user, the router and the toast are stubbed. The Radix select is replaced
 * with a native one so the form can be filled in jsdom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CREATE_SERVICE_HREF, GITHUB_PAGE_HREF } from '@/lib/github-connection/copy'

const { push, toast, create, state } = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { loading: vi.fn(() => 'toast-1'), success: vi.fn(), error: vi.fn() },
  create: vi.fn(),
  state: {
    teams: [] as { id: string; name: string }[],
    auth: { user: { email: 'signed-in@example.com' } as { email: string } | null, isLoading: false },
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn() }) }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/hooks/use-service-limit', () => ({ useServiceLimit: () => ({ data: undefined, refetch: vi.fn() }) }))
vi.mock('@/lib/services/services.service', () => ({ servicesService: { create: (...a: unknown[]) => create(...a) } }))
vi.mock('@/lib/services/teams.service', () => ({ teamsService: { getAll: async () => state.teams } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => state.auth }))

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

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = () => <QueryClientProvider client={client}><NewServicePage /></QueryClientProvider>
  const view = render(page())
  return { ...view, rerenderPage: () => view.rerender(page()) }
}

const submit = () => screen.getByRole('button', { name: /Create Service/ })
const toggle = () => screen.getByRole('button', { name: 'More options' })
const region = () => screen.getByTestId('more-options')
const selects = () => {
  const [template, team] = screen.getAllByTestId('native-select')
  return { template, team }
}

function fillRequired(name = 'checkout-api') {
  fireEvent.change(screen.getByLabelText(/Service Name/), { target: { value: name } })
  fireEvent.change(selects().template, { target: { value: 'api' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.teams = []
  state.auth = { user: { email: 'signed-in@example.com' }, isLoading: false }
  window.history.replaceState(null, '', '/services/new')
})

describe('D1 + D4: a workspace with no teams can create its first service', () => {
  it('no "No teams found" dead end; Create is enabled once Name and Template are filled', async () => {
    mount()
    await waitFor(() => expect(within(selects().team).getByText('No team')).toBeInTheDocument())
    expect(screen.queryByText(/No teams found/)).toBeNull()
    expect(screen.queryByText(/create a team first/i)).toBeNull()
    expect(submit()).toBeDisabled()

    fillRequired()
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })

  it('submits with no team: no teamId, the prefilled owner, then back to /services', async () => {
    create.mockResolvedValue({ id: 'svc-1' })
    mount()
    fillRequired()
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      name: 'checkout-api', template: 'api', owner: 'signed-in@example.com',
      teamId: undefined, description: undefined, githubUrl: undefined,
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/services'))
  })

  it('the Team label and helper are the approved copy, and "No team" is the default choice', async () => {
    state.teams = [{ id: TEAM_ID, name: 'Platform' }]
    mount()
    expect(screen.getByText('Team (optional)')).toBeInTheDocument()
    expect(screen.getByText('You can group services into teams later.')).toBeInTheDocument()
    await within(selects().team).findByText('Platform')
    expect((selects().team as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('No team')
  })
})

describe('with teams: the existing behaviour is kept', () => {
  it.each([
    ['a team chosen is sent', TEAM_ID, TEAM_ID],
    ['choosing "No team" again after a team sends none', 'no-team', undefined],
  ])('%s', async (_label, finalChoice, sent) => {
    state.teams = [{ id: TEAM_ID, name: 'Platform' }, { id: '00000000-0000-4000-8000-0000000000a2', name: 'Data' }]
    create.mockResolvedValue({ id: 'svc-1' })
    mount()
    fillRequired()
    fireEvent.click(toggle())
    await within(selects().team).findByText('Platform')
    fireEvent.change(selects().team, { target: { value: TEAM_ID } })
    fireEvent.change(selects().team, { target: { value: finalChoice } })
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0].teamId).toBe(sent)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/services'))
  })
})

describe('D2: Owner email defaults to the signed-in user and stays editable', () => {
  it('label, helper and the prefilled value', () => {
    mount()
    const owner = screen.getByLabelText(/Owner email/) as HTMLInputElement
    expect(owner.value).toBe('signed-in@example.com')
    expect(screen.getByText('Who to contact about this service. Defaults to you.')).toBeInTheDocument()
  })

  it('an edited owner is what is sent', async () => {
    create.mockResolvedValue({ id: 'svc-1' })
    mount()
    fillRequired()
    fireEvent.click(toggle())
    fireEvent.change(screen.getByLabelText(/Owner email/), { target: { value: 'oncall@example.com' } })
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0].owner).toBe('oncall@example.com')
  })

  it('a user that arrives after the first render fills an empty owner, but never one already typed', async () => {
    state.auth = { user: null, isLoading: true }
    const first = mount()
    first.rerenderPage()
    state.auth = { user: { email: 'signed-in@example.com' }, isLoading: false }
    first.rerenderPage()
    await waitFor(() => expect((screen.getByLabelText(/Owner email/) as HTMLInputElement).value).toBe('signed-in@example.com'))
    first.unmount()

    state.auth = { user: null, isLoading: true }
    const second = mount()
    fireEvent.change(screen.getByLabelText(/Owner email/), { target: { value: 'typed@example.com' } })
    state.auth = { user: { email: 'signed-in@example.com' }, isLoading: false }
    second.rerenderPage()
    await new Promise((r) => setTimeout(r, 20))
    expect((screen.getByLabelText(/Owner email/) as HTMLInputElement).value).toBe('typed@example.com')
  })
})

describe('D3: Template stays required, with today\'s choices', () => {
  it('nothing is preselected, the four choices are unchanged, and Create waits for one', async () => {
    mount()
    const template = selects().template as HTMLSelectElement
    expect(template.value).toBe('')
    expect(Array.from(template.options).map((o) => o.value).filter(Boolean)).toEqual(['api', 'frontend', 'worker', 'database'])

    fireEvent.change(screen.getByLabelText(/Service Name/), { target: { value: 'checkout-api' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(submit()).toBeDisabled()
    fireEvent.change(template, { target: { value: 'worker' } })
    await waitFor(() => expect(submit()).not.toBeDisabled())
  })
})

describe('D8: More options', () => {
  it('starts collapsed: Name and Template outside, Team, Owner email, GitHub URL and Description inside', () => {
    mount()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveAttribute('aria-controls', region().id)
    expect(region()).not.toBeVisible()
    expect(region()).toContainElement(screen.getByText('Team (optional)'))
    expect(region()).toContainElement(selects().team)
    for (const label of [/Owner email/, /GitHub Repository URL/, /Description/]) {
      expect(region()).toContainElement(screen.getByLabelText(label))
    }
    expect(region()).not.toContainElement(screen.getByLabelText(/Service Name/))
    expect(screen.getByLabelText(/Service Name/)).toBeVisible()
    expect(region()).not.toContainElement(selects().template)
    expect(selects().template).toBeVisible()
  })

  it('collapsed, it shows the approved hint under the toggle, as the toggle\'s description; open, the hint is gone', async () => {
    mount()
    const hint = screen.getByTestId('more-options-hint')
    expect(hint).toHaveTextContent(/^Team, owner email \(defaults to you\), GitHub URL, description$/)
    expect(hint).toBeVisible()
    expect(region()).not.toContainElement(hint)
    expect(toggle()).toHaveAttribute('aria-describedby', hint.id)
    expect(toggle()).toHaveAccessibleDescription('Team, owner email (defaults to you), GitHub URL, description')

    fireEvent.click(toggle())
    expect(screen.queryByTestId('more-options-hint')).toBeNull()
    expect(toggle()).not.toHaveAttribute('aria-describedby')
    fireEvent.click(toggle())
    expect(screen.getByTestId('more-options-hint')).toBeVisible()

    // Held open by an error: no hint either.
    fireEvent.change(screen.getByLabelText(/GitHub Repository URL/), { target: { value: 'not a url' } })
    await waitFor(() => expect(region()).toBeVisible())
    expect(screen.queryByTestId('more-options-hint')).toBeNull()
  })

  it('is a native, focusable button (Enter and Space work natively) that opens and closes the region', () => {
    mount()
    const button = toggle()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('tabindex')
    button.focus()
    expect(button).toHaveFocus()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(region()).toBeVisible()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(region()).not.toBeVisible()
  })

  it('opens on its own when a field inside it gets an error while collapsed (e.g. an autofilled GitHub URL)', async () => {
    mount()
    expect(region()).not.toBeVisible()
    fireEvent.change(screen.getByLabelText(/GitHub Repository URL/), { target: { value: 'not a url' } })
    await waitFor(() => expect(region()).toBeVisible())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(within(region()).getByText('Must be a valid URL')).toBeVisible()
  })

  it('emptying the required owner inside it shows the error there, and a submit sends nothing', async () => {
    mount()
    fillRequired()
    fireEvent.change(screen.getByLabelText(/Owner email/), { target: { value: '' } })
    fireEvent.submit(submit().closest('form')!)
    await waitFor(() => expect(region()).toBeVisible())
    expect(within(region()).getByText('Must be a valid email address')).toBeVisible()
    expect(create).not.toHaveBeenCalled()
  })

  it('cannot be collapsed over an error, does not close under the fix, and collapses again after it', async () => {
    mount()
    fireEvent.click(toggle())
    fireEvent.change(screen.getByLabelText(/Owner email/), { target: { value: 'nope' } })
    await waitFor(() => expect(within(region()).getByText('Must be a valid email address')).toBeVisible())
    fireEvent.click(toggle())
    expect(region()).toBeVisible()
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.change(screen.getByLabelText(/Owner email/), { target: { value: 'fixed@example.com' } })
    await waitFor(() => expect(within(region()).queryByText('Must be a valid email address')).toBeNull())
    expect(region()).toBeVisible()
    fireEvent.click(toggle())
    expect(region()).not.toBeVisible()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opened by an error while collapsed, it stays open after the fix', async () => {
    mount()
    fireEvent.change(screen.getByLabelText(/GitHub Repository URL/), { target: { value: 'not a url' } })
    await waitFor(() => expect(region()).toBeVisible())
    fireEvent.change(screen.getByLabelText(/GitHub Repository URL/), { target: { value: 'https://github.com/example/repo' } })
    await waitFor(() => expect(within(region()).queryByText('Must be a valid URL')).toBeNull())
    expect(region()).toBeVisible()
  })

  it('with no signed-in email to default to, it is open, so the empty required owner is in sight', async () => {
    state.auth = { user: null, isLoading: false }
    mount()
    expect(region()).toBeVisible()
    expect((screen.getByLabelText(/Owner email/) as HTMLInputElement).value).toBe('')
  })
})

describe('the GitHub page\'s "Create a service ->" return path survives (no team detour)', () => {
  it('zero teams, opened from CREATE_SERVICE_HREF: created with no team, then back to the GitHub page', async () => {
    expect(CREATE_SERVICE_HREF).toBe(`/services/new?returnTo=${encodeURIComponent(GITHUB_PAGE_HREF)}`)
    window.history.replaceState(null, '', CREATE_SERVICE_HREF)
    create.mockResolvedValue({ id: 'svc-1' })
    mount()
    // Nothing on the form sends the user elsewhere first.
    expect(screen.queryByRole('link', { name: /team/i })).toBeNull()
    fillRequired('payments-api')
    await waitFor(() => expect(submit()).not.toBeDisabled())
    fireEvent.click(submit())
    await waitFor(() => expect(push).toHaveBeenCalledWith(GITHUB_PAGE_HREF))
    expect(GITHUB_PAGE_HREF).toBe('/settings/integrations/github')
    expect(create.mock.calls[0][0].teamId).toBeUndefined()
  })
})
