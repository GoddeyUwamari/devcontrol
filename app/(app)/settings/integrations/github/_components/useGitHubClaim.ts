'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/contexts/auth-context'
import { githubConnectionService, type GitHubConnection } from '@/lib/services/github-connection.service'
import { clearInstallStart, readInstallStart, saveInstallStart, takeParkedCallback } from '@/lib/github-connection/pending-claim'
import { claimOutcome, MAX_RETRIES, RETRY_INTERVAL_MS, type ClaimOutcome } from '@/lib/github-connection/model'
import { GITHUB_CONNECTION_KEY, GITHUB_REPOSITORIES_KEY } from '@/lib/hooks/use-github-connection'
import { goToGitHub } from '@/lib/github-connection/navigate'

const GITHUB_INSTALL_URL = /^https:\/\/github\.com\/apps\/[A-Za-z0-9-]+\/installations\/new\?state=[A-Za-z0-9_-]{43}$/

export type InstallProblem = 'failed' | null

/**
 * The claim the GitHub page finishes (D8b-1, board 4), and Connect GitHub.
 *
 * Once the connection's GET / has answered, the callback values parked by
 * /auth/github/callback are taken (single use) and claimed with the state:
 * the one GitHub echoed, else the one saved when Connect was clicked (V1).
 * Both present and different: the link is treated as expired, with no call.
 * So is a Connect started in another workspace than the current one.
 * Nothing is claimed while the feature is off, in the demo workspace, or for
 * someone who may not connect (they see "Only owners and admins").
 *
 * 202 waiting_for_github: POST /claim/retry every 3 s, never more than the
 * server's 10 retries. A 502 after that keeps the state for Try again
 * (RC-O2); a 502 before it spent the state, so Try again answers "expired".
 */
export function useGitHubClaim(connection: GitHubConnection | undefined) {
  const queryClient = useQueryClient()
  const { organization } = useAuth()
  const organizationId = organization?.id ?? null
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null)
  const [installProblem, setInstallProblem] = useState<InstallProblem>(null)
  const [starting, setStarting] = useState(false)
  const started = useRef(false)
  const stateRef = useRef<string | null>(null)
  const retriesLeft = useRef(MAX_RETRIES)
  const waited = useRef(false)
  const alive = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GITHUB_CONNECTION_KEY })
    void queryClient.invalidateQueries({ queryKey: GITHUB_REPOSITORIES_KEY })
  }, [queryClient])

  const settle = useCallback((next: ClaimOutcome) => {
    if (!alive.current) return
    if (next.kind === 'waiting') waited.current = true
    setOutcome(next)
    if (next.kind === 'connected' || next.kind === 'already_connected') refresh()
    // The state is spent (or never needed again) unless a retry can still use it.
    const keepState = next.kind === 'waiting' || (next.kind === 'no_response' && waited.current)
    if (!keepState) stateRef.current = null
  }, [refresh])

  // The next poll runs the latest retry through a ref, so retry never refers to itself.
  const retryRef = useRef<() => Promise<void>>(async () => undefined)
  const scheduleRetry = useCallback(() => {
    if (alive.current) timer.current = setTimeout(() => void retryRef.current(), RETRY_INTERVAL_MS)
  }, [])

  const retry = useCallback(async (): Promise<void> => {
    const state = stateRef.current
    if (!state) {
      settle({ kind: 'expired' })
      return
    }
    if (retriesLeft.current <= 0) {
      settle({ kind: 'no_response', canRetry: false })
      return
    }
    retriesLeft.current -= 1
    const next = claimOutcome(await githubConnectionService.retryClaim(state), waited.current)
    settle(next)
    if (next.kind === 'waiting') scheduleRetry()
  }, [settle, scheduleRetry])

  useEffect(() => {
    retryRef.current = retry
  }, [retry])

  useEffect(() => {
    if (started.current || !connection) return
    started.current = true
    const parked = takeParkedCallback()
    if (!parked) return
    if (!connection.configured || connection.demo) {
      clearInstallStart()
      return
    }
    const stored = readInstallStart()
    clearInstallStart()
    void (async () => {
      await Promise.resolve()
      if (!connection.can_manage) {
        settle({ kind: 'not_allowed' })
        return
      }
      // Connect was started in another workspace (the tab switched since): nothing is sent (D8b-1 fix N-3).
      if (stored && stored.organizationId !== organizationId) {
        settle({ kind: 'expired' })
        return
      }
      if (parked.state && stored && parked.state !== stored.state) {
        settle({ kind: 'expired' })
        return
      }
      const state = parked.state ?? stored?.state ?? null
      if (!state) {
        settle({ kind: 'expired' })
        return
      }
      stateRef.current = state
      setOutcome({ kind: 'waiting' })
      const answer = await githubConnectionService.claim({
        state,
        ...(parked.code ? { code: parked.code } : {}),
        ...(parked.installationId ? { installation_id: parked.installationId } : {}),
        ...(parked.setupAction ? { setup_action: parked.setupAction } : {}),
      })
      const next = claimOutcome(answer, false)
      settle(next)
      if (next.kind === 'waiting') scheduleRetry()
    })()
  }, [connection, organizationId, settle, scheduleRetry])

  /** Try again on "GitHub didn't respond": the retry route, with the state this tab still holds. */
  const tryAgain = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setOutcome({ kind: 'waiting' })
    void retry()
  }, [retry])

  /** Connect GitHub: POST /install, keep the state for this tab, then go to GitHub in the same tab. */
  const connect = useCallback(async () => {
    setInstallProblem(null)
    setStarting(true)
    const answer = await githubConnectionService.startInstall()
    const data = (answer.body?.data ?? {}) as { install_url?: unknown; state?: unknown }
    if (answer.status === 200 && typeof data.install_url === 'string' && GITHUB_INSTALL_URL.test(data.install_url) && typeof data.state === 'string' && organizationId) {
      saveInstallStart(data.state, organizationId)
      goToGitHub(data.install_url)
      return
    }
    setStarting(false)
    const mapped = claimOutcome(answer, false)
    if (mapped.kind === 'not_allowed' || mapped.kind === 'demo' || mapped.kind === 'off') {
      setOutcome(mapped)
      if (mapped.kind !== 'not_allowed') refresh()
      return
    }
    setInstallProblem('failed')
  }, [organizationId, refresh])

  const dismiss = useCallback(() => setOutcome(null), [])

  return { outcome, tryAgain, connect, starting, installProblem, dismiss }
}
