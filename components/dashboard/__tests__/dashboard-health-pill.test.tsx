/**
 * The dashboard's AWS pill follows the connection's health (AWS connect PR D1, D1-D11, strings D1-D3):
 * green only when health is ok (the server's "ok" is always fresh); amber for failing or lost and
 * neutral for not checked recently or not checked yet, both linking to /connect-aws. Without a
 * health (a server from before D1) the pill is as before.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardHero } from '../dashboard-hero'
import type { ConnectionHealthState } from '@/lib/services/aws-accounts.service'

function pill(awsHealth: ConnectionHealthState | null | undefined, canConnectAws = true) {
  render(<DashboardHero awsConnection="connected" canConnectAws={canConnectAws} awsHealth={awsHealth} orgName="Org" lastSynced={null} />)
  return screen.getByTestId('provider-pill-aws')
}

describe('the AWS pill by health', () => {
  it.each([['ok'], [null], [undefined]] as const)('health %s: green "AWS" + "connected", not a link (D1 unchanged)', (health) => {
    const aws = pill(health)
    expect(aws).toHaveAttribute('data-state', 'connected')
    expect(aws.textContent).toBe('AWSconnected')
    expect(aws.style.background).toBe('var(--bg-success)')
    expect(aws.closest('a')).toBeNull()
  })

  it.each([
    ['failing', 'AWSconnection failing'],
    ['lost', 'AWSconnection lost'],
  ] as const)('%s: amber, links to /connect-aws, never green (D2)', (health, text) => {
    const aws = pill(health)
    expect(aws.tagName).toBe('A')
    expect(aws).toHaveAttribute('href', '/connect-aws')
    expect(aws).toHaveAttribute('data-state', health)
    expect(aws.textContent).toBe(text)
    expect(aws.querySelector('.sr-only')!.textContent).toBe(text.replace(/^AWS/, ''))
    expect(aws.style.background).toBe('var(--bg-warning)')
    expect(aws.style.borderColor).toBe('var(--border-warning)')
    expect(aws.outerHTML).not.toMatch(/success/)
    expect(aws.textContent).not.toMatch(/connected$/)
  })

  it.each(['not_checked_recently', 'not_checked_yet'] as const)('%s: neutral, links to /connect-aws, never green (D3)', (health) => {
    const aws = pill(health)
    expect(aws.tagName).toBe('A')
    expect(aws).toHaveAttribute('href', '/connect-aws')
    expect(aws).toHaveAttribute('data-state', 'not-checked')
    expect(aws.textContent).toBe('AWSconnection not checked recently')
    expect(aws.className).toContain('text-ink-muted')
    expect(aws.outerHTML).not.toMatch(/success|warning/)
  })

  it.each(['failing', 'lost', 'not_checked_recently'] as const)('%s for a member: the same link (any member can see the connection)', (health) => {
    const aws = pill(health, false)
    expect(aws).toHaveAttribute('href', '/connect-aws')
  })

  it('health is ignored unless connected', () => {
    render(<DashboardHero awsConnection="unconnected" canConnectAws awsHealth="failing" orgName="Org" lastSynced={null} />)
    expect(screen.getByTestId('provider-pill-aws')).toHaveAttribute('data-state', 'not-connected')
  })
})
