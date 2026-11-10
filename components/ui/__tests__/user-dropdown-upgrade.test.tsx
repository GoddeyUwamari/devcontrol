/**
 * Trial PR (TR-Q8): the user menu's "Upgrade Plan" item is shown only when the
 * server offers this organization an upgrade (never on the top plan or for a
 * plan our team manages). Every other item is unaffected.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))

import { UserDropdown } from '../user-dropdown'

async function open(upgradeAvailable?: boolean) {
  render(
    <UserDropdown
      user={{ name: 'Sample Owner', email: 'owner@example.com', initials: 'SO' }}
      onLogout={vi.fn()}
      {...(upgradeAvailable === undefined ? {} : { upgradeAvailable })}
    />
  )
  const trigger = screen.getByText('SO').closest('button')!
  await act(async () => { fireEvent.keyDown(trigger, { key: 'Enter' }) })
  await screen.findByRole('menu')
}

describe('user menu: Upgrade Plan', () => {
  it('hidden when the server offers no upgrade; Billing & Usage stays', async () => {
    await open(false)
    expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument()
    expect(screen.getByText('Billing & Usage')).toBeInTheDocument()
  })

  it('shown when the server offers an upgrade', async () => {
    await open(true)
    expect(screen.getByText('Upgrade Plan')).toBeInTheDocument()
  })
})
