/**
 * The service-registration docs restored after #221 describe the real API:
 * POST /api/services (owners and admins) with name, template, owner, team_id
 * and optional github_url and description -- validated here by the backend's
 * own createServiceSchema -- answered 201 with the services row; GET
 * /api/services/registered lists registered services. No /v1 paths and no
 * tier, repository or tags fields. Authentication is the access token from
 * signing in (no API keys), and the error example is what the validation
 * middleware really sends.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ApiReferencePage from '../docs/api/page'
import GettingStartedPage from '../docs/getting-started/page'
import DocsPage from '../docs/page'
import { createServiceSchema } from '../../../backend/src/validators/schemas'
import { validateBody } from '../../../backend/src/middleware/validation'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/docs',
  useSearchParams: () => new URLSearchParams(),
}))

const FAKE_FIELDS = /"(tier|repository|tags)"/

describe('/docs/api: Services API', () => {
  it('the Services API card: the real base path and its four methods (GET, POST, PUT, DELETE)', () => {
    render(<ApiReferencePage />)
    const endpoints = document.getElementById('endpoints') as HTMLElement
    const card = within(endpoints).getByText('Services API').closest('[class*="hover:shadow-lg"]') as HTMLElement

    expect(within(card).getByText('Create, update, and manage services in your catalog')).toBeInTheDocument()
    expect(within(card).getByText('4 methods')).toBeInTheDocument()
    // The base path, and the list and create examples under it.
    expect(within(card).getAllByText('/api/services').length).toBe(3)
    expect(document.body.textContent).not.toContain('/v1/services')
  })

  it('the create request body is accepted by the backend schema and has no made-up fields', () => {
    render(<ApiReferencePage />)
    const blocks = Array.from(document.querySelectorAll('pre code')).map(c => c.textContent ?? '')
    const request = blocks.find(b => b.includes('"name": "payment-service"') && !b.includes('"success"'))!
    const body = JSON.parse(request)

    expect(Object.keys(body).sort()).toEqual(['description', 'github_url', 'name', 'owner', 'team_id', 'template'])
    expect(() => createServiceSchema.parse(body)).not.toThrow()
    // Only description and github_url are optional.
    for (const field of ['name', 'template', 'owner', 'team_id']) {
      const { [field]: _omitted, ...rest } = body
      expect(createServiceSchema.safeParse(rest).success).toBe(false)
    }
    expect(createServiceSchema.safeParse({ ...body, github_url: undefined, description: undefined }).success).toBe(true)
    expect(request).not.toMatch(FAKE_FIELDS)
    expect(screen.getByText(/Organization owners and admins only/)).toBeInTheDocument()
  })

  it('the response is the controller\'s 201 envelope around a services row', () => {
    render(<ApiReferencePage />)
    const blocks = Array.from(document.querySelectorAll('pre code')).map(c => c.textContent ?? '')
    const response = JSON.parse(blocks.find(b => b.includes('"success": true') && b.includes('payment-service'))!)

    expect(response.success).toBe(true)
    expect(response.message).toBe('Service created successfully')
    // database/migrations/001_create_platform_tables.sql services columns + organization_id.
    expect(Object.keys(response.data).sort()).toEqual([
      'created_at', 'description', 'github_url', 'id', 'metadata', 'name',
      'organization_id', 'owner', 'status', 'team_id', 'template', 'updated_at',
    ])
    expect(response.data.status).toBe('active')
    expect(JSON.stringify(response)).not.toMatch(FAKE_FIELDS)
    const responseCard = screen.getByText('Successful service creation response').closest('div')!.parentElement!
    expect(within(responseCard).getByText('201')).toBeInTheDocument()
  })
})

describe('/docs/api: endpoint examples are shown', () => {
  it('the Services API card lists its examples, including the registered list and create', () => {
    render(<ApiReferencePage />)
    const examples = screen.getByRole('list', { name: 'Services API examples' })
    const items = within(examples).getAllByRole('listitem').map(li => li.textContent)
    expect(items).toEqual([
      'GET/api/servicesList discovered resourcesRetrieve the discovered AWS resources in your organization',
      'GET/api/services/registeredList registered servicesRetrieve the services registered in your catalog',
      'POST/api/servicesCreate a serviceRegister a new service in the catalog (organization owners and admins)',
    ])
  })

  it('every endpoint card shows its examples', () => {
    render(<ApiReferencePage />)
    const endpoints = document.getElementById('endpoints') as HTMLElement
    const lists = within(endpoints).getAllByRole('list')
    expect(lists.map(l => l.getAttribute('aria-label'))).toEqual([
      'Services API examples', 'Deployments API examples', 'Infrastructure API examples',
      'Teams API examples', 'Metrics API examples', 'Webhooks API examples',
    ])
    for (const list of lists) expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})

describe('docs authentication', () => {
  it('/docs/api: a Bearer access token from signing in, and no API keys', () => {
    render(<ApiReferencePage />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/api[ _-]?key/i)
    expect(text).toContain('Authorization: Bearer YOUR_ACCESS_TOKEN')
    expect(text).toContain('Access Token Authentication')
    expect(text).toContain('POST /api/auth/login returns it as data.accessToken')
    expect(text).toContain('Missing, invalid or expired access token')
    const links = screen.getAllByRole('link').map(l => l.getAttribute('href'))
    expect(links).not.toContain('/settings/api-keys')
    expect(screen.getAllByRole('link', { name: /Sign In/ }).map(l => l.getAttribute('href'))).toEqual(['/login', '/login'])
  })

  it('/docs index: the API request sample uses an access token, not an API key', () => {
    render(<DocsPage />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Authorization: Bearer $ACCESS_TOKEN')
    expect(text).not.toContain('$API_KEY')
    // The only remaining mention is the devcontrol/deploy-action sample's
    // `api-key:` input, deferred with the CLI/SDK claims.
    expect(text.match(/api[ _-]?key/gi)).toEqual(['api-key'])
    expect(text).toContain('uses: devcontrol/deploy-action@v1')
  })

  it('/docs/getting-started: no API keys', () => {
    render(<GettingStartedPage />)
    expect(document.body.textContent).not.toMatch(/api[ _-]?key/i)
  })
})

describe('/docs/api: error example', () => {
  it('is exactly what validateBody answers for POST /api/services with an empty name', async () => {
    render(<ApiReferencePage />)
    const blocks = Array.from(document.querySelectorAll('pre code')).map(c => c.textContent ?? '')
    const documented = JSON.parse(blocks.find(b => b.includes('"Validation failed"'))!)

    const json = vi.fn()
    const res = { status: vi.fn(() => res), json } as never
    const req = {
      body: { name: '', template: 'api', owner: 'owner@example.com', team_id: '00000000-0000-4000-8000-000000000000' },
    } as never
    const next = vi.fn()
    await validateBody(createServiceSchema)(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(documented)
    expect(documented).toEqual({ success: false, error: 'Validation failed', details: 'name: Service name is required' })
  })
})

describe('/docs/getting-started', () => {
  it('has the Register your services step, pointing at Add Service', () => {
    render(<GettingStartedPage />)
    expect(screen.getByText('Register your services')).toBeInTheDocument()
    expect(screen.getByText('Add your services to the catalog with ownership and metadata.')).toBeInTheDocument()
    const addService = screen.getAllByRole('link').find(l => l.textContent?.includes('Add Service'))
    expect(addService).toHaveAttribute('href', '/services/new')
    expect(document.body.textContent).not.toContain('devcontrol service create')
  })
})

describe('/docs index', () => {
  it('names the Service Catalog card and category link; no /v1 path', () => {
    render(<DocsPage />)
    const catalog = screen.getAllByText('Service Catalog')
    expect(catalog.length).toBe(2)
    expect(catalog.map(el => el.closest('a')?.getAttribute('href')).sort()).toEqual(['/docs', '/services'])
    expect(screen.queryByText('Resource Inventory')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('/v1/services')
  })
})
