import { useQuery } from '@tanstack/react-query'
import { githubConnectionService } from '@/lib/services/github-connection.service'

export const GITHUB_CONNECTION_KEY = ['github-connection'] as const
export const GITHUB_REPOSITORIES_KEY = ['github-connection', 'repositories'] as const

/**
 * GET /api/integrations/github, and its repositories once there is something
 * to list: never while the feature is off (the route answers 503), in the
 * demo workspace (its screen is a fixed sample, Q9) or with nothing connected.
 * The app's QueryClient is reset on every identity or organization change, so
 * one organization's answer never shows in another.
 */
export function useGitHubConnection() {
  const connection = useQuery({
    queryKey: GITHUB_CONNECTION_KEY,
    queryFn: githubConnectionService.get,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const data = connection.data
  const wantsRepositories = data?.configured === true && !data.demo && data.installations.length > 0
  const repositories = useQuery({
    queryKey: GITHUB_REPOSITORIES_KEY,
    queryFn: githubConnectionService.repositories,
    enabled: wantsRepositories,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  return { connection, repositories, wantsRepositories }
}
