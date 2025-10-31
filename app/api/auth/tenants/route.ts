import { NextResponse } from 'next/server'

export interface Tenant {
  id: string
  name: string
  email: string
  status: 'active' | 'inactive' | 'suspended'
  createdAt: string
}

// Mock data for demonstration
const mockTenants: Tenant[] = [
  {
    id: '1',
    name: 'Acme Corporation',
    email: 'admin@acme.com',
    status: 'active',
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '2',
    name: 'TechStart Inc',
    email: 'contact@techstart.com',
    status: 'active',
    createdAt: '2024-02-20T14:45:00Z',
  },
  {
    id: '3',
    name: 'Global Solutions',
    email: 'info@globalsolutions.com',
    status: 'inactive',
    createdAt: '2024-03-10T09:15:00Z',
  },
  {
    id: '4',
    name: 'Digital Dynamics',
    email: 'hello@digitaldynamics.com',
    status: 'active',
    createdAt: '2024-03-25T16:20:00Z',
  },
  {
    id: '5',
    name: 'Cloud Innovators',
    email: 'team@cloudinnovators.com',
    status: 'suspended',
    createdAt: '2024-04-05T11:00:00Z',
  },
  {
    id: '6',
    name: 'Future Systems',
    email: 'support@futuresystems.com',
    status: 'active',
    createdAt: '2024-04-12T13:30:00Z',
  },
  {
    id: '7',
    name: 'NextGen Technologies',
    email: 'admin@nextgen.tech',
    status: 'active',
    createdAt: '2024-05-01T08:45:00Z',
  },
  {
    id: '8',
    name: 'Smart Enterprises',
    email: 'contact@smartenterprises.com',
    status: 'inactive',
    createdAt: '2024-05-15T12:00:00Z',
  },
  {
    id: '9',
    name: 'Innovative Solutions Ltd',
    email: 'info@innovativesolutions.com',
    status: 'active',
    createdAt: '2024-06-01T10:15:00Z',
  },
  {
    id: '10',
    name: 'Prime Technologies',
    email: 'admin@primetech.com',
    status: 'active',
    createdAt: '2024-06-10T15:30:00Z',
  },
  {
    id: '11',
    name: 'Vertex Corp',
    email: 'hello@vertexcorp.com',
    status: 'active',
    createdAt: '2024-06-20T09:00:00Z',
  },
  {
    id: '12',
    name: 'Synergy Partners',
    email: 'info@synergypartners.com',
    status: 'suspended',
    createdAt: '2024-07-01T14:20:00Z',
  },
]

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.toLowerCase() || ''

    // Filter tenants based on search query
    let filteredTenants = mockTenants

    if (search) {
      filteredTenants = mockTenants.filter(
        (tenant) =>
          tenant.name.toLowerCase().includes(search) ||
          tenant.email.toLowerCase().includes(search)
      )
    }

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 300))

    return NextResponse.json(filteredTenants)
  } catch (error) {
    console.error('Error fetching tenants:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tenants' },
      { status: 500 }
    )
  }
}
