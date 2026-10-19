/**
 * /deployments/new and /infrastructure/new pick a service from the
 * organization's registered services (GET /api/services/registered): their
 * service_id references the services table. "No services found. Please
 * create a service first." appears only when that list is really empty --
 * not while it loads, and not when services exist.
 *
 * Real AuthProvider and pages; the network is faked at the axios instance
 * with the route's real JSON ({ success, services, total }).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NewDeploymentPage from '../(app)/deployments/new/page'
import NewInfrastructurePage from '../(app)/infrastructure/new/page'
import { AuthProvider } from '@/lib/contexts/auth-context'
import api from '@/lib/api'
import { authService } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'

vi.mock('next/navigation', () => {
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return { useRouter: () => router, usePathname: () => '/deployments/new', useSearchParams: () => new URLSearchParams() }
})

const ORG = { id: '00000000-0000-4000-8000-00000000000a', name: 'Org A', slug: 'org-a' }
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'user@example.invalid', fullName: 'User' }
const EMPTY_MESSAGE = 'No services found. Please create a service first.'

function signIn() {
  const payload = btoa(JSON.stringify({ userId: USER.id, organizationId: ORG.id, role: 'admin', type: 'access' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  localStorage.setItem('accessToken', `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`)
  localStorage.setItem('refreshToken', 'refresh-token')
  localStorage.setItem('user', JSON.stringify(USER))
}

let registered: () => unknown[] | Promise<unknown[]>

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
})

beforeEach(() => {
  localStorage.clear()
  signIn()
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG] } as never)
  vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG] as never)
  registered = () => []
  vi.spyOn(api, 'get').mockImplementation((async (url: string) => {
    if (url !== '/api/services/registered') throw new Error(`unexpected GET ${url}`)
    const services = await registered()
    return { data: { success: true, services, total: services.length } }
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function mount(Page: () => React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthProvider><Page /></AuthProvider></QueryClientProvider>)
  await act(async () => {})
}

describe.each([
  ['/deployments/new', NewDeploymentPage],
  ['/infrastructure/new', NewInfrastructurePage],
])('%s service dropdown', (_path, Page) => {
  it('lists the registered services', async () => {
    registered = () => [
      { id: '00000000-0000-4000-8000-000000000001', name: 'payments-api', owner: 'o@example.invalid', team_id: null, team_name: null, github_url: null, created_at: '2026-10-01T00:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000002', name: 'worker', owner: 'o@example.invalid', team_id: null, team_name: null, github_url: null, created_at: '2026-10-01T00:00:00.000Z' },
    ]
    await mount(Page as () => React.ReactElement)

    const trigger = (await screen.findAllByRole('combobox'))[0]
    await screen.findByText('Select a service')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const options = await screen.findAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['payments-api', 'worker'])
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument()
  })

  it('no registered services: says to create one first', async () => {
    await mount(Page as () => React.ReactElement)
    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument()
  })

  it('while loading: no "create a service first"', async () => {
    registered = () => new Promise(() => {})
    await mount(Page as () => React.ReactElement)
    expect(await screen.findByText('Loading services...')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument()
  })
})
