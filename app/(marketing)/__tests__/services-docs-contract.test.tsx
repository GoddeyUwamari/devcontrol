/**
 * The service-registration docs restored after #221 describe the real API:
 * POST /api/services (owners and admins) with name, template, owner, team_id
 * and optional github_url and description -- validated here by the backend's
 * own createServiceSchema -- answered 201 with the services row; GET
 * /api/services/registered lists registered services. No /v1 paths and no
 * tier, repository or tags fields.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ApiReferencePage from '../docs/api/page'
import GettingStartedPage from '../docs/getting-started/page'
import DocsPage from '../docs/page'
import { createServiceSchema } from '../../../backend/src/validators/schemas'

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
    expect(within(card).getByText('/api/services')).toBeInTheDocument()
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
