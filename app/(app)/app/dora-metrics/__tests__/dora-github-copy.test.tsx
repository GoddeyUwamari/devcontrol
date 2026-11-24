/**
 * Board 7 (D8b-2, R15) on Engineering Intelligence: the no-data banner and the
 * method sentence follow the GitHub connection only while it is switched on;
 * off, unknown or the demo workspace keep today's copy, "coming soon" included.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoDataBanner } from '../_components/HeaderParts'
import { COPY, isGitHubAppRow, methodSourceSentence } from '../_lib/dora-page'
import type { RecordedDeployment } from '@/lib/deployments/status'

const TODAY_BODY = 'Connecting your CI/CD pipeline is coming soon. Until then, you can record deployments by hand and mark each one succeeded or failed.'

describe('NoDataBanner', () => {
  it('off or unknown: today\'s title and body, Record a deployment only', () => {
    render(<NoDataBanner github={null} />)
    const banner = screen.getByTestId('dora-no-data-banner')
    expect(banner).toHaveTextContent(COPY.bannerTitle)
    expect(banner).toHaveTextContent(TODAY_BODY)
    expect(screen.queryByTestId('dora-banner-connect')).toBeNull()
    expect(screen.getByRole('link', { name: 'Record a deployment →' })).toBeInTheDocument()
  })

  it('switched on, not connected: the board 7 sentence; "Connect GitHub →" for owners and admins only', () => {
    const { unmount } = render(<NoDataBanner github={{ kind: 'not_connected', canManage: true }} />)
    expect(screen.getByTestId('dora-no-data-banner')).toHaveTextContent('Connect GitHub to record deployments from GitHub Actions. You can also record them by hand.')
    expect(screen.getByTestId('dora-no-data-banner')).not.toHaveTextContent('coming soon')
    expect(screen.getByTestId('dora-banner-connect')).toHaveAttribute('href', '/settings/integrations/github')
    expect(screen.getByTestId('dora-banner-connect')).toHaveTextContent('Connect GitHub →')
    unmount()
    render(<NoDataBanner github={{ kind: 'not_connected', canManage: false }} />)
    expect(screen.queryByTestId('dora-banner-connect')).toBeNull()
  })

  it('switched on, connected, nothing recorded: the board 7 sentence, never "isn\'t connected"', () => {
    render(<NoDataBanner github={{ kind: 'connected', recording: 0 }} />)
    const banner = screen.getByTestId('dora-no-data-banner')
    expect(screen.getByTestId('dora-banner-connected')).toHaveTextContent("GitHub is connected. Deployments appear here after the next deploy that matches a repository's deploy rule.")
    expect(banner).not.toHaveTextContent("isn't connected")
    expect(banner).not.toHaveTextContent('coming soon')
  })
})

describe('method sentence (R15)', () => {
  const app = { metadata: { source: 'github_actions', connection: 'github_app' } } as unknown as RecordedDeployment
  const legacy = { metadata: { source: 'github_actions', workflow_name: 'deploy' } } as unknown as RecordedDeployment

  it('App-backed records while switched on: names the DevControl Deployments app', () => {
    expect(methodSourceSentence('github_actions', false, true)).toBe(
      'Measured from your deployment records: from GitHub Actions through the DevControl Deployments app, and from any deployments recorded by hand.')
  })

  it('legacy webhook records, or switched off: today\'s sentence', () => {
    expect(methodSourceSentence('github_actions', false, false)).toBe(
      'Records come from your pipeline (GitHub Actions, via webhook) and from deployments recorded by hand on the Deployments page.')
    expect(methodSourceSentence('github_actions', false)).toContain('via webhook')
    expect(methodSourceSentence('manual', false, true)).toBe('Records come from deployments recorded by hand on the Deployments page.')
    expect(methodSourceSentence('github_actions', true, true)).toBe('Demo data: a fixed example, not records from your workspace.')
  })

  it('isGitHubAppRow reads the stored connection only', () => {
    expect(isGitHubAppRow(app)).toBe(true)
    expect(isGitHubAppRow(legacy)).toBe(false)
    expect(isGitHubAppRow(null)).toBe(false)
  })
})
