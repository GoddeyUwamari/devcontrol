/**
 * CAT-3 (CAT-D7, C3-D3/D4/D5): API keys and webhooks are "Coming soon". The
 * page makes no request for them, offers no action that would fail, and no
 * integration tile can be "connected" by a click unless it really connects
 * (only AWS). Every tile stays listed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const demo = vi.hoisted(() => ({ on: false }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo.on }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true, isEnterprise: false }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/services/developers.service', () => ({
  default: {
    getKeys: vi.fn(async () => []),
    generateKey: vi.fn(),
    revokeKey: vi.fn(),
    getWebhooks: vi.fn(async () => []),
    addWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
  },
}))

import DevelopersPage from '../page'
import developersService from '@/lib/services/developers.service'

const ALL_TILES = ['AWS', 'Kubernetes', 'Terraform', 'CloudWatch', 'Datadog', 'Grafana', 'Prometheus', 'New Relic', 'Slack', 'PagerDuty', 'OpsGenie', 'Email', 'GitHub', 'Jira', 'GitLab', 'Linear']
const COMING_SOON_TILES = ['Kubernetes', 'Terraform', 'Datadog', 'Grafana', 'Prometheus', 'New Relic', 'PagerDuty', 'OpsGenie', 'GitHub', 'Jira', 'GitLab', 'Linear']

const tile = (name: string) => screen.getByText(name, { selector: 'p.text-sm' }).closest('div.rounded-xl') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  demo.on = false
})

describe.each([false, true])('/developers (demo mode %s)', (demoOn) => {
  beforeEach(() => { demo.on = demoOn })

  it('makes no request for keys or webhooks', () => {
    render(<DevelopersPage />)
    for (const fn of Object.values(developersService)) expect(fn).not.toHaveBeenCalled()
  })

  it('shows API keys and webhooks as "Coming soon", with no button or modal', () => {
    render(<DevelopersPage />)
    const keys = screen.getByTestId('api-keys-coming-soon')
    expect(keys.textContent).toContain('API keys')
    expect(keys.textContent).toContain('Coming soon')
    expect(keys.textContent).toContain('Programmatic read access to DevControl is being built. It will be on the Optimization Engine plan.')
    const hooks = screen.getByTestId('webhooks-coming-soon')
    expect(hooks.textContent).toContain('Webhooks')
    expect(hooks.textContent).toContain('Coming soon')
    expect(hooks.textContent).toContain('Send DevControl events to your own systems. Up to 5 endpoints on Optimization Engine.')
    expect(within(keys).queryByRole('button')).toBeNull()
    expect(within(hooks).queryByRole('button')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Generate (API )?Key|Add Endpoint|No API keys yet|No webhooks configured|requests this month|Upgrade to Enterprise for unlimited webhooks/)
  })

  it('every integration tile is still listed', () => {
    render(<DevelopersPage />)
    for (const name of ALL_TILES) expect(tile(name)).toBeInTheDocument()
  })

  it('tiles that do not exist yet say "Coming soon" and have no button', () => {
    render(<DevelopersPage />)
    for (const name of COMING_SOON_TILES) {
      expect(tile(name).textContent).toContain('Coming soon')
      expect(within(tile(name)).queryByRole('button')).toBeNull()
      expect(tile(name).textContent).not.toMatch(/Connected|Recommended/)
    }
  })

  it('CloudWatch is included with AWS; Slack and email are test-only with a link to alert settings', () => {
    render(<DevelopersPage />)
    expect(tile('CloudWatch').textContent).toContain('Included with AWS')
    expect(tile('CloudWatch').textContent).toContain('Metrics are read through your AWS connection.')
    expect(within(tile('CloudWatch')).queryByRole('button')).toBeNull()
    for (const name of ['Slack', 'Email']) {
      expect(tile(name).textContent).toContain('Test messages only. Alert delivery is coming soon.')
      expect(tile(name).textContent).toContain('Coming soon')
      expect(within(tile(name)).queryByRole('button')).toBeNull()
      expect(within(tile(name)).getByText('Alert settings →').getAttribute('href')).toBe('/settings/alerts')
    }
  })

  it('no click anywhere produces a fake "Connected"', () => {
    render(<DevelopersPage />)
    const connectedBefore = screen.queryAllByText('Connected').length
    for (const button of screen.getAllByRole('button')) {
      if (within(tile('AWS')).queryAllByRole('button').includes(button)) continue
      fireEvent.click(button)
    }
    expect(screen.queryAllByText('Connected')).toHaveLength(connectedBefore)
    for (const name of ALL_TILES.filter((n) => n !== 'AWS')) expect(tile(name).textContent).not.toContain('Connected')
  })

  it('the setup steps: observability is "Coming soon" (not a button); alert channels open alert settings', () => {
    render(<DevelopersPage />)
    expect(document.body.textContent).toContain('Datadog, Grafana and others are coming soon.')
    expect(screen.queryByRole('button', { name: /Connect Datadog|Connect Slack/ })).toBeNull()
    expect(document.body.textContent).toContain('Set up email and Slack and send a test message. Alert delivery is coming soon.')
    fireEvent.click(screen.getByRole('button', { name: 'Open alert settings →' }))
    expect(push).toHaveBeenCalledWith('/settings/alerts')
  })

  it('the subtitle says only AWS connects today', () => {
    render(<DevelopersPage />)
    expect(document.body.textContent).toContain('Connect AWS today. API keys, webhooks and more integrations are coming soon.')
    expect(document.body.textContent).not.toMatch(/real-time/i)
  })
})

describe('AWS stays a real connection', () => {
  it('not connected: "Connect →" opens /connect-aws', () => {
    render(<DevelopersPage />)
    fireEvent.click(within(tile('AWS')).getByRole('button', { name: 'Connect →' }))
    expect(push).toHaveBeenCalledWith('/connect-aws')
  })

  it('demo: only AWS shows as connected', () => {
    demo.on = true
    render(<DevelopersPage />)
    expect(tile('AWS').textContent).toContain('Connected')
    expect(screen.getAllByText('Connected')).toHaveLength(1)
  })
})
