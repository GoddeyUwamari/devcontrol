import { NextResponse } from 'next/server'

// Mock invoice data
const mockInvoices = [
  {
    id: 'INV-2024-001',
    tenantId: 'tenant-1',
    tenantName: 'Acme Corporation',
    amount: 2499.99,
    status: 'paid',
    dueDate: '2024-01-15',
    createdAt: '2024-01-01',
  },
  {
    id: 'INV-2024-002',
    tenantId: 'tenant-2',
    tenantName: 'TechStart Inc',
    amount: 1299.50,
    status: 'pending',
    dueDate: '2024-02-01',
    createdAt: '2024-01-15',
  },
  {
    id: 'INV-2024-003',
    tenantId: 'tenant-3',
    tenantName: 'Global Solutions Ltd',
    amount: 4999.00,
    status: 'overdue',
    dueDate: '2024-01-20',
    createdAt: '2024-01-05',
  },
  {
    id: 'INV-2024-004',
    tenantId: 'tenant-4',
    tenantName: 'StartupHub',
    amount: 599.99,
    status: 'paid',
    dueDate: '2024-01-25',
    createdAt: '2024-01-10',
  },
  {
    id: 'INV-2024-005',
    tenantId: 'tenant-5',
    tenantName: 'Enterprise Corp',
    amount: 9999.99,
    status: 'open',
    dueDate: '2024-02-15',
    createdAt: '2024-01-20',
  },
  {
    id: 'INV-2024-006',
    tenantId: 'tenant-1',
    tenantName: 'Acme Corporation',
    amount: 2499.99,
    status: 'void',
    dueDate: '2024-01-10',
    createdAt: '2023-12-28',
  },
  {
    id: 'INV-2024-007',
    tenantId: 'tenant-6',
    tenantName: 'CloudTech Solutions',
    amount: 3750.00,
    status: 'pending',
    dueDate: '2024-02-05',
    createdAt: '2024-01-22',
  },
  {
    id: 'INV-2024-008',
    tenantId: 'tenant-7',
    tenantName: 'Digital Dynamics',
    amount: 1850.25,
    status: 'overdue',
    dueDate: '2024-01-18',
    createdAt: '2024-01-03',
  },
  {
    id: 'INV-2024-009',
    tenantId: 'tenant-8',
    tenantName: 'InnovateCo',
    amount: 5200.00,
    status: 'paid',
    dueDate: '2024-01-28',
    createdAt: '2024-01-14',
  },
  {
    id: 'INV-2024-010',
    tenantId: 'tenant-9',
    tenantName: 'DataStream LLC',
    amount: 799.99,
    status: 'open',
    dueDate: '2024-02-10',
    createdAt: '2024-01-25',
  },
]

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status')

    let filteredInvoices = mockInvoices

    // Filter by status if provided
    if (statusFilter && statusFilter !== 'all') {
      filteredInvoices = mockInvoices.filter(
        (invoice) => invoice.status.toLowerCase() === statusFilter.toLowerCase()
      )
    }

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 300))

    return NextResponse.json(filteredInvoices)
  } catch (error) {
    console.error('Error fetching invoices:', error)
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    )
  }
}
