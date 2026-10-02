/**
 * Team Members tab against the real GET /members contract: a flat row whose
 * `id` is the member's user id (backend organizationService.getMembers).
 * Names and emails come from the flat fields, "(You)" from id, and role
 * changes and removals send that id -- never `undefined`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const ME = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const ORG = '99999999-9999-4999-8999-999999999999'

vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: ME } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/modals/invite-member-modal', () => ({ InviteMemberModal: () => null }))
vi.mock('@/lib/services/organizations.service', () => ({
  organizationsService: { getMembers: vi.fn(), updateMemberRole: vi.fn(), removeMember: vi.fn() },
}))

import { MembersTab } from '../members-tab'
import { organizationsService } from '@/lib/services/organizations.service'

/** Rows exactly as the backend returns them (flat; id = user id). */
const ROWS = [
  { id: ME, email: 'owner@example.com', fullName: 'Olivia Owner', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00Z', invitedBy: null, isActive: true },
  { id: MEMBER, email: 'member@example.com', fullName: 'Max Member', avatarUrl: null, role: 'member', joinedAt: '2026-02-01T00:00:00Z', invitedBy: ME, isActive: true },
]

beforeAll(() => {
  // Radix Select needs these in jsdom.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
})

beforeEach(async () => {
  const { toast } = await import('sonner')
  vi.mocked(toast.error).mockReset()
  vi.mocked(organizationsService.getMembers).mockReset().mockResolvedValue(ROWS as never)
  vi.mocked(organizationsService.updateMemberRole).mockReset().mockResolvedValue(undefined)
  vi.mocked(organizationsService.removeMember).mockReset().mockResolvedValue(undefined)
})

const renderTab = () => render(<MembersTab organization={{ id: ORG } as never} />)
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

async function chooseRole(rowEl: HTMLElement, label: string) {
  const trigger = within(rowEl).getByRole('combobox')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

describe('member rendering', () => {
  it('names and emails come from the flat fullName/email; never "Unknown User" / "No email"', async () => {
    renderTab()
    expect(await screen.findByText('Max Member')).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Unknown User|No email/)
    expect(within(row('Max Member')).getByText('MM')).toBeInTheDocument()
  })

  it('"(You)" marks the current user by id, and only them', async () => {
    renderTab()
    await screen.findByText('Max Member')
    expect(within(row('Olivia Owner')).getByText('(You)')).toBeInTheDocument()
    expect(within(row('Max Member')).queryByText('(You)')).toBeNull()
  })
})

describe('role change and removal send the member id', () => {
  it('role change calls updateMemberRole with the member\'s id', async () => {
    renderTab()
    await screen.findByText('Max Member')
    await chooseRole(row('Max Member'), 'Viewer')
    await waitFor(() => expect(organizationsService.updateMemberRole).toHaveBeenCalledWith(ORG, MEMBER, 'viewer'))
  })

  it('removal calls removeMember with the member\'s id', async () => {
    renderTab()
    await screen.findByText('Max Member')
    fireEvent.pointerDown(within(row('Max Member')).getByRole('button', { name: 'Member actions menu' }), { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Remove member/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Max Member')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Member' }))
    await waitFor(() => expect(organizationsService.removeMember).toHaveBeenCalledWith(ORG, MEMBER))
  })
})

describe('error toasts show the backend\'s safe error field', () => {
  const apiError = (body: Record<string, unknown>) => Object.assign(new Error('Request failed'), { response: { data: body } })

  it('role change failure: the toast description is response.data.error, never response.data.message', async () => {
    const { toast } = await import('sonner')
    vi.mocked(organizationsService.updateMemberRole).mockRejectedValue(
      apiError({ success: false, error: 'Insufficient permissions to assign this role', message: 'should not be shown' })
    )
    renderTab()
    await screen.findByText('Max Member')
    await chooseRole(row('Max Member'), 'Viewer')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to update role', { description: 'Insufficient permissions to assign this role' })
    )
  })

  it('removal failure: the toast description is response.data.error', async () => {
    const { toast } = await import('sonner')
    vi.mocked(organizationsService.removeMember).mockRejectedValue(apiError({ success: false, error: 'Validation failed' }))
    renderTab()
    await screen.findByText('Max Member')
    fireEvent.pointerDown(within(row('Max Member')).getByRole('button', { name: 'Member actions menu' }), { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Remove member/ }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove Member' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to remove member', { description: 'Validation failed' }))
  })

  it('with no error field, the generic fallback', async () => {
    const { toast } = await import('sonner')
    vi.mocked(organizationsService.updateMemberRole).mockRejectedValue(new Error('Network Error'))
    renderTab()
    await screen.findByText('Max Member')
    await chooseRole(row('Max Member'), 'Viewer')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update role', { description: 'Please try again' }))
  })
})

describe('Admin role option', () => {
  const ADMIN_ME = { ...ROWS[0], role: 'admin' }
  const optionsFor = async (rowName: string) => {
    const trigger = within(row(rowName)).getByRole('combobox')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const listbox = await screen.findByRole('listbox')
    return within(listbox).getAllByRole('option').map((o) => o.textContent)
  }

  it('an owner is offered Admin, Member and Viewer', async () => {
    renderTab()
    await screen.findByText('Max Member')
    expect(await optionsFor('Max Member')).toEqual(['Admin', 'Member', 'Viewer'])
  })

  it('an admin is not offered Admin (the backend lets admins grant only member or viewer)', async () => {
    vi.mocked(organizationsService.getMembers).mockResolvedValue([ADMIN_ME, ROWS[1]] as never)
    renderTab()
    await screen.findByText('Max Member')
    expect(await optionsFor('Max Member')).toEqual(['Member', 'Viewer'])
  })

  it('an admin viewing an existing admin still sees that row\'s current value', async () => {
    const otherAdmin = { ...ROWS[1], id: '33333333-3333-4333-8333-333333333333', fullName: 'Ada Admin', email: 'ada@example.com', role: 'admin' }
    vi.mocked(organizationsService.getMembers).mockResolvedValue([ADMIN_ME, otherAdmin] as never)
    renderTab()
    await screen.findByText('Ada Admin')
    expect(within(row('Ada Admin')).getByRole('combobox')).toHaveTextContent('Admin')
  })
})
