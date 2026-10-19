/**
 * The "Registered services" section of /services lists the organization's
 * services-table rows from GET /api/services/registered: separate loading,
 * empty (with a link to Add Service) and error states; a service created on
 * /services/new is listed when the user lands back on /services; and another
 * organization's services never render.
 *
 * Runs the REAL AuthProvider, section and services.service; the network is
 * faked at the axios instance with the route's real JSON
 * ({ success, services, total }).
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegisteredServices } from '../RegisteredServices'
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context'
import api from '@/lib/api'
import { authService } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'

vi.mock('next/navigation', () => {
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return { useRouter: () => router, usePathname: () => '/services', useSearchParams: () => new URLSearchParams() }
})

const ORG = {
  a: { id: '00000000-0000-4000-8000-00000000000a', name: 'Org A', slug: 'org-a' },
  b: { id: '00000000-0000-4000-8000-00000000000b', name: 'Org B', slug: 'org-b' },
} as const
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'user@example.invalid', fullName: 'User' }

function accessTokenFor(organizationId: string): string {
  const payload = btoa(JSON.stringify({ userId: USER.id, organizationId, role: 'member', type: 'access' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`
}

function signInAs(org: { id: string }) {
  localStorage.setItem('accessToken', accessTokenFor(org.id))
  localStorage.setItem('refreshToken', 'refresh-token')
  localStorage.setItem('user', JSON.stringify(USER))
}

/** A row exactly as GET /api/services/registered returns it. */
function row(id: string, name: string, extra: Partial<{ owner: string; team_id: string | null; team_name: string | null; github_url: string | null; created_at: string }> = {}) {
  return {
    id, name,
    owner: extra.owner ?? 'owner@example.invalid',
    team_id: extra.team_id ?? null,
    team_name: extra.team_name ?? null,
    github_url: extra.github_url ?? null,
    created_at: extra.created_at ?? '2026-10-01T00:00:00.000Z',
  }
}

/** What the fake server answers per organization (by the token's claim). */
let byOrg: Record<string, () => unknown[] | Promise<unknown[]>>

function currentTokenOrg(): string {
  const token = localStorage.getItem('accessToken') ?? ''
  return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).organizationId
}

function AuthControls() {
  const { login } = useAuth()
  return <button onClick={() => login(USER.email, 'password')}>test: log in</button>
}

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AuthControls />
        <RegisteredServices />
      </AuthProvider>
    </QueryClientProvider>
  )
  return { client, ...view }
}

const registeredCalls = () => vi.mocked(api.get).mock.calls.filter(([u]) => u === '/api/services/registered').length

beforeEach(() => {
  localStorage.clear()
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG.a, ORG.b] } as never)
  vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG.a, ORG.b] as never)
  byOrg = { [ORG.a.id]: () => [], [ORG.b.id]: () => [] }
  vi.spyOn(api, 'get').mockImplementation((async (url: string) => {
    if (url !== '/api/services/registered') throw new Error(`unexpected GET ${url}`)
    const services = await byOrg[currentTokenOrg()]()
    return { data: { success: true, services, total: services.length } }
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Registered services section', () => {
  it('lists the registered services with owner, team, repository and date', async () => {
    signInAs(ORG.a)
    byOrg[ORG.a.id] = () => [
      row('s1', 'payments-api', { team_id: 't1', team_name: 'Payments', github_url: 'https://github.com/example/payments-api' }),
      row('s2', 'worker'),
    ]
    mount()

    const section = await screen.findByRole('region', { name: 'Registered services' })
    await within(section).findByText('payments-api')
    const rows = within(section).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('payments-api')
    expect(rows[0]).toHaveTextContent('owner@example.invalid')
    expect(rows[0]).toHaveTextContent('Payments')
    expect(within(rows[0]).getByRole('link', { name: 'github.com/example/payments-api' })).toHaveAttribute('href', 'https://github.com/example/payments-api')
    expect(rows[1]).toHaveTextContent('worker')
    expect(rows[1]).toHaveTextContent('No team')
    expect(rows[1]).toHaveTextContent('None')
    expect(within(section).getByText('2 registered')).toBeInTheDocument()
  })

  it('loading: a status, neither empty nor an error', async () => {
    signInAs(ORG.a)
    byOrg[ORG.a.id] = () => new Promise(() => {})
    mount()

    expect(await screen.findByRole('status')).toHaveTextContent('Loading registered services...')
    expect(screen.queryByText('No services registered yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('empty: says so and links to Add Service', async () => {
    signInAs(ORG.a)
    mount()

    expect(await screen.findByText('No services registered yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add Service' })).toHaveAttribute('href', '/services/new')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('error: an alert with a retry, never the empty state', async () => {
    signInAs(ORG.a)
    let fail = true
    byOrg[ORG.a.id] = () => {
      if (fail) { fail = false; throw new Error('Request failed with status code 500') }
      return [row('s1', 'payments-api')]
    }
    mount()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load registered services.")
    expect(screen.queryByText('No services registered yet.')).not.toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByText('payments-api')).toBeInTheDocument()
  })

  it('a service created on /services/new is listed when the user lands back on /services', async () => {
    signInAs(ORG.a)
    // The app's default staleTime: without refetchOnMount the cached empty list would be reused.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } })
    // AuthProvider lives in the app layout and stays mounted across client
    // navigation; only the /services page content leaves and comes back.
    function Navigation() {
      const [onServices, setOnServices] = useState(true)
      return (
        <>
          <button onClick={() => setOnServices((v) => !v)}>test: navigate</button>
          {onServices && <RegisteredServices />}
        </>
      )
    }
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Navigation />
        </AuthProvider>
      </QueryClientProvider>
    )
    expect(await screen.findByText('No services registered yet.')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByText('test: navigate')) }) // to /services/new
    // Created there (POST /api/services); the form then routes back to /services.
    byOrg[ORG.a.id] = () => [row('s-new', 'just-created')]
    await act(async () => { fireEvent.click(screen.getByText('test: navigate')) })

    expect(await screen.findByText('just-created')).toBeInTheDocument()
  })

  it('keys the list by the session\'s organization and never shows another organization\'s services', async () => {
    signInAs(ORG.a)
    byOrg[ORG.a.id] = () => [row('a1', 'org-a-service')]
    byOrg[ORG.b.id] = () => [row('b1', 'org-b-service')]
    const { client } = mount()
    expect(await screen.findByText('org-a-service')).toBeInTheDocument()
    expect(client.getQueryData(['registered-services', ORG.a.id])).toEqual([expect.objectContaining({ id: 'a1' })])

    vi.spyOn(authService, 'login').mockResolvedValue({
      accessToken: accessTokenFor(ORG.b.id), refreshToken: 'refresh-token', user: USER, organization: ORG.b,
    } as never)
    await act(async () => { fireEvent.click(screen.getByText('test: log in')) })

    expect(await screen.findByText('org-b-service')).toBeInTheDocument()
    expect(screen.queryByText('org-a-service')).not.toBeInTheDocument()
    await waitFor(() => expect(client.getQueryData(['registered-services', ORG.a.id])).toBeUndefined())
    expect(registeredCalls()).toBeGreaterThanOrEqual(2)
  })
})
