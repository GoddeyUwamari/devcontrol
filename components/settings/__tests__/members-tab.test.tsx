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

beforeEach(() => {
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
