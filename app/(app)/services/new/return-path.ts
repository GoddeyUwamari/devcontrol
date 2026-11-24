import { safeReturnPath } from '@/lib/safe-return-path'

/**
 * Where /services/new goes once the service is created: a safe, same-site
 * `returnTo` (D8b-2: "Create a service →" on the GitHub page sends
 * /settings/integrations/github), else the Services list. Read at submit
 * time, so the page needs no Suspense boundary for the search params.
 */
export function returnPathAfterCreate(search: string = typeof window === 'undefined' ? '' : window.location.search): string {
  const returnTo = new URLSearchParams(search).get('returnTo')
  return (returnTo && safeReturnPath(returnTo)) || '/services'
}
