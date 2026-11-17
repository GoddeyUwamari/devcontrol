'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import awsAccountsService, { HomeRegionRequestError, type HomeRegionChangeResult } from '@/lib/services/aws-accounts.service'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { HOME_REGION_COPY, HOME_REGION_ERROR_CODES, changedText, connectionAccountId, homeRegionBanner, type DialogMode } from './homeRegionModel'
import { homeRegionOf, multiRegionOf, scanIsRunning } from './redesignModel'
import { HomeRegionBanner } from './HomeRegionBanner'
import { HomeRegionDialog } from './HomeRegionDialog'
import { SURFACE, TONE } from './redesignTone'
import { REDESIGN_COPY } from './redesignModel'

/**
 * The Services page's home-region pieces (multi-region PR 3c), for the
 * redesign only: the banner (proposal or split, from the server's state), the
 * change dialog, the success line, and the owner-only "Change" handler for the
 * coverage card. Reads the page's GET /api/aws/accounts query (same key, same
 * cache) and the coverage response. Writes only through the three home-region
 * routes; after a change or a dismiss, failed or not, it invalidates accounts,
 * coverage, stats, attention and the list, and never edits a cache by hand (no optimistic UI).
 */
export function useHomeRegion({ orgId, realMode, coverage }: { orgId: string | null; realMode: boolean; coverage: ServicesCoverage | undefined }) {
  const queryClient = useQueryClient()
  const accountsQuery = useQuery({
    queryKey: ['services-aws-accounts', orgId],
    queryFn: () => awsAccountsService.getAccountsAndConnection(),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })
  const [dialog, setDialog] = useState<{ mode: DialogMode; preselect: string | null } | null>(null)
  const [changed, setChanged] = useState<string | null>(null)
  const [keeping, setKeeping] = useState(false)
  const [keepError, setKeepError] = useState<string | null>(null)
  // A prompt the server said is no longer open (409 NO_OPEN_PROPOSAL), hidden while the refetch runs.
  const [closedPrompt, setClosedPrompt] = useState<string | null>(null)

  const view = accountsQuery.data?.homeRegion
  const connected = !!coverage?.account.connected
  const canChange = connected && view?.canChangeHomeRegion === true
  const proposal = view?.proposal ?? null
  const promptKey = proposal ? `${proposal.state}:${proposal.region ?? ''}:${proposal.period?.start ?? ''}` : null
  const banner = connected && coverage && promptKey !== closedPrompt
    ? homeRegionBanner(proposal, {
      canChange, scanRunning: scanIsRunning(coverage), home: homeRegionOf(coverage),
      multiRegion: !!multiRegionOf(coverage), accountId: connectionAccountId(accountsQuery.data?.accounts ?? []),
    })
    : null

  const invalidateAll = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['services-aws-accounts', orgId] }),
    queryClient.invalidateQueries({ queryKey: ['services-coverage', orgId] }),
    queryClient.invalidateQueries({ queryKey: ['services-stats', orgId] }),
    queryClient.invalidateQueries({ queryKey: ['services-attention', orgId] }),
    queryClient.invalidateQueries({ queryKey: ['services-list', orgId] }),
  ])

  async function keep() {
    setKeeping(true)
    setKeepError(null)
    try {
      await awsAccountsService.dismissHomeRegionProposal()
      setClosedPrompt(promptKey)
      await invalidateAll()
    } catch (err: unknown) {
      // 409 NO_OPEN_PROPOSAL: nothing open any more: refetch and hide. Any other failure:
      // the founder's line (decision f), the banner stays, and everything is refetched.
      if (err instanceof HomeRegionRequestError && err.code === HOME_REGION_ERROR_CODES.noOpenProposal) setClosedPrompt(promptKey)
      else setKeepError(HOME_REGION_COPY.keepFailed)
      await invalidateAll()
    } finally {
      setKeeping(false)
    }
  }

  function onChanged(result: HomeRegionChangeResult) {
    setDialog(null)
    setChanged(changedText(result.to, result.scan_started))
    void invalidateAll()
  }

  const bannerNode = (
    <>
      {changed && (
        <div role="status" data-testid="home-region-changed" className={cn('mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-ui', SURFACE.success)}>
          <p className={cn('m-0 min-w-0 flex-1', TONE.success)}>{changed}</p>
          <button type="button" aria-label={REDESIGN_COPY.dismiss} onClick={() => setChanged(null)} className={cn('-m-1 shrink-0 rounded p-1', TONE.muted, TONE.focus)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {banner && (
        <HomeRegionBanner
          view={banner}
          busy={keeping}
          error={keepError}
          onPrimary={() => setDialog(banner.kind === 'proposal' ? { mode: 'proposal', preselect: banner.region } : { mode: 'split', preselect: null })}
          onKeep={() => { void keep() }}
        />
      )}
    </>
  )

  const dialogNode = dialog && orgId && canChange ? (
    <HomeRegionDialog
      orgId={orgId}
      mode={dialog.mode}
      preselect={dialog.preselect}
      evidence={proposal && (proposal.state === 'proposed' || proposal.state === 'split') ? proposal : null}
      scanInProgress={!!coverage?.scan_in_progress}
      onClose={() => setDialog(null)}
      onChanged={onChanged}
      // L-3: a failed change refetches the same five queries as a success (a change may have
      // committed before its response was lost).
      onFailed={invalidateAll}
    />
  ) : null

  return {
    bannerNode,
    dialogNode,
    /** The owner-only "Change" after HR-S8; null for everyone else. */
    onChange: canChange ? () => setDialog({ mode: 'change', preselect: null }) : null,
    /** For tests and the static check: the copy used. */
    copy: HOME_REGION_COPY,
  }
}
