'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'
import { takeUrlCredentials } from '@/lib/url-credentials'
import { loginPathReturningTo } from '@/lib/login-redirect'
import { parkCallback } from '@/lib/github-connection/pending-claim'
import { COPY, GITHUB_PAGE_HREF } from '@/lib/github-connection/copy'

/** What GitHub sends back after an install (the App's Callback URL, Q1). */
const GITHUB_CALLBACK_PARAMS = ['code', 'installation_id', 'setup_action', 'state'] as const

/**
 * /auth/github/callback (D8b-1, Q1): outside the signed-in app, so AuthGate
 * never copies GitHub's OAuth code into /login?from= (F4). A sign-in page:
 * styled like the others (the app's own tokens apply inside the app only).
 *
 * First, before anything else runs: the values are taken out of the URL and
 * its history entry (GitHub sends them in the query), checked against the
 * shapes the server accepts, and parked for this tab only. Then the GitHub
 * page, a clean URL, runs the claim. Signed out (the session ended while on
 * GitHub): sign in first; the GitHub page then finds the parked values.
 * Nothing usable (no code, no request): straight to the GitHub page.
 */
function GitHubCallbackContent() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()
  const taken = useRef(false)

  // Declared first, so in the first commit it runs before the navigation below.
  useEffect(() => {
    if (taken.current) return
    taken.current = true
    const values = takeUrlCredentials(GITHUB_CALLBACK_PARAMS, { legacyQuery: GITHUB_CALLBACK_PARAMS })
    parkCallback(values)
  }, [])

  useEffect(() => {
    if (taken.current && !isLoading && isAuthenticated) router.replace(GITHUB_PAGE_HREF)
  }, [isAuthenticated, isLoading, router])

  if (!isLoading && !isAuthenticated) {
    return (
      <CallbackCard testId="github-callback-sign-in" title={COPY.signInTitle} body={COPY.signInBody}>
        <a
          href={loginPathReturningTo(GITHUB_PAGE_HREF)}
          data-testid="github-callback-sign-in-link"
          className="inline-flex min-h-11 items-center justify-center self-start rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white no-underline hover:bg-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
        >
          {COPY.signIn}
        </a>
      </CallbackCard>
    )
  }
  return <CallbackCard testId="github-callback-finishing" title={COPY.finishingTitle} body={COPY.finishingBody} live />
}

function CallbackCard({ testId, title, body, live, children }: { testId: string; title: string; body: string; live?: boolean; children?: React.ReactNode }) {
  return (
    <section data-testid={testId} aria-live={live ? 'polite' : undefined} className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 className="m-0 text-lg font-semibold">{title}</h1>
      <p className="m-0 text-sm text-muted-foreground">{body}</p>
      {children}
    </section>
  )
}

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={null}>
      <GitHubCallbackContent />
    </Suspense>
  )
}
