/**
 * Dashboard UI polish: provider pills, the card arrow button, the info
 * button's tooltip and panel heading, and the compact Engineering Health
 * empty state. Presentation only -- every state comes from props.
 */
import { describe, it, expect } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { DashboardHero } from '../dashboard-hero'
import { CardArrowLink } from '../card-arrow-link'
import { EvidenceInfo } from '../evidence-info'
import { EngineeringHealthCard } from '../engineering-health-card'

describe('provider pills', () => {
  it('connected: a green-tint "AWS" pill with a dot, not a link', () => {
    render(<DashboardHero awsConnection="connected" canConnectAws orgName="Org" lastSynced={null} />)
    const aws = screen.getByTestId('provider-pill-aws')
    expect(aws).toHaveAttribute('data-state', 'connected')
    expect(aws.textContent).toBe('AWSconnected') // visible "AWS" + screen-reader "connected"
    expect(aws.style.background).toBe('var(--bg-success)')
    expect(aws.closest('a')).toBeNull()
  })

  it('not connected: an outlined accent "Connect AWS" pill with a plug icon, linking to /connect-aws', () => {
    render(<DashboardHero awsConnection="unconnected" canConnectAws orgName="Org" lastSynced={null} />)
    const aws = screen.getByRole('link', { name: 'Connect AWS' })
    expect(aws).toHaveAttribute('href', '/connect-aws')
    expect(aws).toHaveAttribute('data-state', 'not-connected')
    expect(aws.style.borderColor).toBe('var(--border-accent)')
    expect(aws.querySelector('svg.lucide-plug')).not.toBeNull()
  })

  it.each(['connected', 'unconnected', 'unknown', 'loading'] as const)('GCP and Azure are static "soon" pills with dashed borders (AWS: %s)', (awsConnection) => {
    render(<DashboardHero awsConnection={awsConnection} canConnectAws orgName="Org" lastSynced={null} />)
    for (const [id, text] of [['gcp', 'GCP soon'], ['azure', 'Azure soon']]) {
      const pill = screen.getByTestId(`provider-pill-${id}`)
      expect(pill).toHaveTextContent(text)
      expect(pill.className).toContain('border-dashed')
      expect(pill.className).toContain('bg-transparent')
      expect(pill.tagName).toBe('SPAN')
      expect(pill.closest('a, button')).toBeNull()
    }
  })

  it('not connected, not an owner: a neutral "AWS not connected" pill as plain text -- no link, not focusable, no hover or focus styling', () => {
    render(<DashboardHero awsConnection="unconnected" canConnectAws={false} orgName="Org" lastSynced={null} />)
    const aws = screen.getByTestId('provider-pill-aws')
    expect(aws).toHaveAttribute('data-state', 'not-connected')
    expect(aws.textContent).toBe('AWS not connected')
    expect(aws.querySelector('svg.lucide-plug')).toHaveAttribute('aria-hidden', 'true')
    expect(aws.className).toContain('text-[var(--text-secondary)]')
    expect(aws.className).toContain('border-border')
    expect(aws.tagName).toBe('SPAN')
    expect(screen.queryByText('Connect AWS')).not.toBeInTheDocument()
    expect(aws.closest('a, button')).toBeNull()
    expect(aws.querySelector('a, button')).toBeNull()
    expect(aws).not.toHaveAttribute('href')
    expect(aws).not.toHaveAttribute('tabindex')
    expect(aws).not.toHaveAttribute('role')
    expect(aws.className).not.toMatch(/hover:|focus|cursor-pointer/)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/connect-aws"]')).toBeNull()
    // The other pills, and the row, are as for an owner.
    expect([...screen.getByTestId('provider-pills').children].map((pill) => pill.textContent)).toEqual(['AWS not connected', 'GCP soon', 'Azure soon'])
  })

  it.each(['connected', 'unknown', 'loading'] as const)('%s: being an owner or not changes nothing in the pills', (awsConnection) => {
    const owner = render(<DashboardHero awsConnection={awsConnection} canConnectAws orgName="Org" lastSynced={null} />)
    const ownerHtml = owner.getByTestId('provider-pills').outerHTML
    owner.unmount()
    render(<DashboardHero awsConnection={awsConnection} canConnectAws={false} orgName="Org" lastSynced={null} />)
    expect(screen.getByTestId('provider-pills').outerHTML).toBe(ownerHtml)
  })

  it.each(['connected', 'unconnected'] as const)('no "AWS Account Connected" badge, no provider tiles, and one non-wrapping row (AWS: %s)', (awsConnection) => {
    const { container } = render(<DashboardHero awsConnection={awsConnection} canConnectAws orgName="Org" lastSynced={null} />)
    expect(container.textContent).not.toMatch(/AWS Account (Not )?Connected|Coming soon|Google Cloud|Not connected/)
    const row = screen.getByTestId('provider-pills')
    expect(row.children).toHaveLength(3)
    expect(row.className).toContain('flex-nowrap')
    for (const pill of [...row.children]) expect(pill.className).toContain('whitespace-nowrap')
  })

  it.each(['unknown', 'loading'] as const)('%s: no AWS pill at all, and nothing that says connected or not connected', (awsConnection) => {
    const { container } = render(<DashboardHero awsConnection={awsConnection} canConnectAws orgName="Org" lastSynced={null} />)
    expect(screen.queryByTestId('provider-pill-aws')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Connect AWS' })).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Connect your AWS account|Connect AWS/)
    // Only the two "soon" pills remain.
    expect([...screen.getByTestId('provider-pills').children].map((pill) => pill.textContent)).toEqual(['GCP soon', 'Azure soon'])
  })

  it.each(['connected', 'unconnected', 'unknown', 'loading'] as const)('%s: the sub-copy is the organization name, with no invitation to connect and no setup-time claim', (awsConnection) => {
    const { container } = render(<DashboardHero awsConnection={awsConnection} canConnectAws orgName="Org Name" lastSynced={null} />)
    expect(screen.getByText('Org Name')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Connect your AWS account|to get started|Setup takes|2 minutes/i)
  })

  it('there is no syncing pill (the page cannot tell that no discovery has ever completed)', () => {
    const { container } = render(<DashboardHero awsConnection="connected" canConnectAws orgName="Org" lastSynced={null} />)
    expect(container.textContent).not.toMatch(/syncing/i)
  })

  it('keeps the page title and subtitle', () => {
    render(<DashboardHero awsConnection="connected" canConnectAws orgName="Org" lastSynced={null} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI-Powered Cloud Operations & Infrastructure Intelligence')
    expect(screen.getByText(/^Operational visibility across cloud costs, security, observability, and infrastructure efficiency/)).toBeInTheDocument()
  })
})

describe('card arrow button', () => {
  it('a 28px circle with a 0.5px border and an accent arrow; the hit area grows to 44px on touch only', () => {
    render(<CardArrowLink href="/costs" label="Open costs" />)
    const link = screen.getByRole('link', { name: 'Open costs' })
    expect(link).toHaveAttribute('href', '/costs')
    expect(link.className).toMatch(/\bw-7\b/)
    expect(link.className).toMatch(/\bh-7\b/)
    expect(link.className).toContain('border-[0.5px]')
    expect(link.className).toContain('rounded-full')
    expect(link.className).toContain('hover:bg-[var(--bg-accent)]')
    expect(link.className).toContain('focus-visible:bg-[var(--bg-accent)]')
    // 28px + 2 x 8px invisible ::before = 44px on coarse pointers
    expect(link.className).toContain('pointer-coarse:before:-inset-2')
    const icon = link.querySelector('svg.lucide-arrow-right') as SVGElement
    expect(icon.style.color).toBe('var(--text-accent)')
  })
})

describe('info button', () => {
  const info = (props: Partial<Parameters<typeof EvidenceInfo>[0]> = {}) =>
    render(<EvidenceInfo about="Month-to-Date Spend" {...props}><p>Body</p></EvidenceInfo>)

  it('"About <card>" label, pointer cursor, 44px hit area, and it is a button, never a link', () => {
    info()
    const button = screen.getByRole('button', { name: 'About Month-to-Date Spend' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('href')
    expect(button.closest('a')).toBeNull()
    expect(button.className).toMatch(/\bw-11\b/)
    expect(button.className).toMatch(/\bh-11\b/)
    expect(button.className).toContain('cursor-pointer')
    expect(button.querySelector('span')!.className).toContain('group-hover:bg-[var(--surface-1)]')
    expect(button.className).toContain('text-[var(--text-secondary)]')
  })

  it('focus shows the one-line tooltip; the panel opens only on click, with the new heading and the card name beneath it', async () => {
    info()
    const button = screen.getByRole('button', { name: 'About Month-to-Date Spend' })
    await act(async () => { fireEvent.focus(button) })
    expect((await screen.findAllByText('How this number is calculated')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'How this is calculated' })
    expect(within(dialog).getByTestId('evidence-info-subject')).toHaveTextContent('Month-to-Date Spend')
    expect(dialog).toHaveTextContent('Body')
  })

  it('Resource checks wording: tooltip and heading "How these checks work"', async () => {
    info({ about: 'Resource checks', heading: 'How these checks work', tooltip: 'How these checks work' })
    const button = screen.getByRole('button', { name: 'About Resource checks' })
    await act(async () => { fireEvent.focus(button) })
    expect((await screen.findAllByText('How these checks work')).length).toBeGreaterThan(0)
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'How these checks work' })).toHaveTextContent('Resource checks')
  })
})

describe('Engineering Health empty state', () => {
  it('is compact: one line plus its link, its own height (not stretched to Recent Activity)', () => {
    render(<EngineeringHealthCard isDemoActive={false} doraRows={[]} />)
    const card = screen.getByTestId('engineering-health-card')
    expect(card.className).toContain('self-start')
    expect(card.className).not.toContain('h-full')
    expect(screen.getByTestId('engineering-health-empty')).toHaveTextContent(/^DORA metrics are not summarized on the dashboard yet\.$/)
    expect(card.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByText('View details →').closest('a')).toHaveAttribute('href', '/app/dora-metrics')
    expect(card.innerHTML).not.toMatch(/\bpy-4\b/)
  })

  it('demo mode still fills the row', () => {
    render(<EngineeringHealthCard isDemoActive doraRows={[{ label: 'Deploys', value: '3' }]} />)
    expect(screen.getByTestId('engineering-health-card').className).toContain('h-full')
  })
})
