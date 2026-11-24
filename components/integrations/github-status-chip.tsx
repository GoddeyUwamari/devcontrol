'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useGitHubConnection } from '@/lib/hooks/use-github-connection'
import { GITHUB_PAGE_HREF, SURFACE_COPY } from '@/lib/github-connection/copy'
import { githubSurface } from '@/lib/github-connection/surfaces'

const CHIP = 'inline-flex min-h-9 items-center whitespace-nowrap rounded-full border px-3 text-label no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600'

/**
 * Board 7: one chip in the Deployment History header, linking to the GitHub
 * page (D8b-2, R14). Not connected: "Connect →" for owners and admins only.
 * Connected: how many repositories are recording, or "Setup incomplete" when
 * none is. Any installation uninstalled, suspended or with other permissions:
 * "Needs attention". Nothing while loading, on a failed request, while the
 * feature is off, in the demo workspace, or in demo mode (`enabled` false:
 * no request at all).
 */
export function GitHubStatusChip({ enabled = true }: { enabled?: boolean }) {
  const { connection, repositories } = useGitHubConnection({ enabled })
  if (!enabled || !connection.isSuccess) return null
  const surface = githubSurface(connection.data, repositories.isSuccess ? repositories.data : undefined)
  if (!surface || surface.kind === 'off') return null

  let text: string
  let tone: string
  if (surface.kind === 'not_connected') {
    if (!surface.canManage) return null
    text = SURFACE_COPY.chipConnect
    tone = 'border-violet-200 bg-card text-ink-accent hover:bg-violet-50'
  } else if (surface.kind === 'attention') {
    text = SURFACE_COPY.chipAttention
    tone = 'border-amber-200 bg-amber-50 text-ink-warning-strong hover:bg-amber-100'
  } else {
    if (surface.recording === null) return null
    if (surface.recording === 0) {
      text = SURFACE_COPY.chipSetupIncomplete
      tone = 'border-amber-200 bg-amber-50 text-ink-warning-strong hover:bg-amber-100'
    } else {
      text = SURFACE_COPY.chipRecording(surface.recording)
      tone = 'border-green-200 bg-green-50 text-ink-success-strong hover:bg-green-100'
    }
  }
  return <Link href={GITHUB_PAGE_HREF} data-testid="github-status-chip" className={cn(CHIP, tone)}>{text}</Link>
}
