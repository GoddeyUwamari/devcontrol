import { NextResponse } from 'next/server'

export interface Subscription {
  id: string
  tenantName: string
  plan: string
  status: 'active' | 'cancelled' | 'past_due'
  amount: number
  nextBillingDate: string
}

// Mock data for demonstration
const mockSubscriptions: Subscription[] = [
  {
    id: 'sub_1',
    tenantName: 'Acme Corporation',
    plan: 'Enterprise',
    status: 'active',
    amount: 299.99,
    nextBillingDate: '2025-11-15T00:00:00Z',
  },
  {
    id: 'sub_2',
    tenantName: 'TechStart Inc',
    plan: 'Professional',
    status: 'active',
    amount: 149.99,
    nextBillingDate: '2025-11-20T00:00:00Z',
  },
  {
    id: 'sub_3',
    tenantName: 'Global Solutions',
    plan: 'Basic',
    status: 'cancelled',
    amount: 49.99,
    nextBillingDate: '2025-11-10T00:00:00Z',
  },
  {
    id: 'sub_4',
    tenantName: 'Digital Dynamics',
    plan: 'Enterprise',
    status: 'active',
    amount: 299.99,
    nextBillingDate: '2025-11-25T00:00:00Z',
  },
  {
    id: 'sub_5',
    tenantName: 'Cloud Innovators',
    plan: 'Professional',
    status: 'past_due',
    amount: 149.99,
    nextBillingDate: '2025-10-15T00:00:00Z',
  },
  {
    id: 'sub_6',
    tenantName: 'Future Systems',
    plan: 'Basic',
    status: 'active',
    amount: 49.99,
    nextBillingDate: '2025-11-12T00:00:00Z',
  },
  {
    id: 'sub_7',
    tenantName: 'NextGen Technologies',
    plan: 'Enterprise',
    status: 'active',
    amount: 299.99,
    nextBillingDate: '2025-12-01T00:00:00Z',
  },
  {
    id: 'sub_8',
    tenantName: 'Smart Enterprises',
    plan: 'Professional',
    status: 'cancelled',
    amount: 149.99,
    nextBillingDate: '2025-10-30T00:00:00Z',
  },
  {
    id: 'sub_9',
    tenantName: 'Innovative Solutions Ltd',
    plan: 'Professional',
    status: 'active',
    amount: 149.99,
    nextBillingDate: '2025-11-18T00:00:00Z',
  },
  {
    id: 'sub_10',
    tenantName: 'Prime Technologies',
    plan: 'Enterprise',
    status: 'active',
    amount: 299.99,
    nextBillingDate: '2025-11-22T00:00:00Z',
  },
  {
    id: 'sub_11',
    tenantName: 'Vertex Corp',
    plan: 'Basic',
    status: 'past_due',
    amount: 49.99,
    nextBillingDate: '2025-10-20T00:00:00Z',
  },
  {
    id: 'sub_12',
    tenantName: 'Synergy Partners',
    plan: 'Professional',
    status: 'active',
    amount: 149.99,
    nextBillingDate: '2025-11-28T00:00:00Z',
  },
  {
    id: 'sub_13',
    tenantName: 'DataFlow Inc',
    plan: 'Enterprise',
    status: 'active',
    amount: 299.99,
    nextBillingDate: '2025-12-05T00:00:00Z',
  },
  {
    id: 'sub_14',
    tenantName: 'Alpine Systems',
    plan: 'Basic',
    status: 'cancelled',
    amount: 49.99,
    nextBillingDate: '2025-10-25T00:00:00Z',
  },
]

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status')

    // Filter subscriptions based on status
    let filteredSubscriptions = mockSubscriptions

    if (statusFilter && statusFilter !== 'all') {
      filteredSubscriptions = mockSubscriptions.filter(
        (subscription) => subscription.status === statusFilter
      )
    }

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 300))

    return NextResponse.json(filteredSubscriptions)
  } catch (error) {
    console.error('Error fetching subscriptions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    )
  }
}
