import { useQuery } from '@tanstack/react-query'
import { githubConnectionService, type GitHubRepositoryList } from '@/lib/services/github-connection.service'

export const GITHUB_CONNECTION_KEY = ['github-connection'] as const
export const GITHUB_REPOSITORIES_KEY = ['github-connection', 'repositories'] as const

/**
 * GET /api/integrations/github, and its repositories once there is something
 * to list: never while the feature is off (the route answers 503), in the
 * demo workspace (its screen is a fixed sample, Q9) or with nothing connected.
 * The app's QueryClient is reset on every identity or organization change, so
 * one organization's answer never shows in another. `enabled: false` (demo
 * mode on other pages) sends nothing.
 */
export function useGitHubConnection({ enabled = true }: { enabled?: boolean } = {}) {
  const connection = useQuery({
    queryKey: GITHUB_CONNECTION_KEY,
    queryFn: githubConnectionService.get,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const data = connection.data
  const wantsRepositories = enabled && data?.configured === true && !data.demo && data.installations.length > 0
  const repositoryList = useQuery({
    queryKey: GITHUB_REPOSITORIES_KEY,
    queryFn: githubConnectionService.repositories,
    enabled: wantsRepositories,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  // One request, one cache entry; `repositories` keeps D8b-1's shape (the list).
  const repositories = useQuery({
    queryKey: GITHUB_REPOSITORIES_KEY,
    queryFn: githubConnectionService.repositories,
    enabled: wantsRepositories,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    select: (d: GitHubRepositoryList) => d.repositories,
  })
  return { connection, repositories, heldEventDays: repositoryList.data?.held_event_days ?? null, wantsRepositories }
}
