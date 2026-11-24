import type { GitHubRepository } from '@/lib/services/github-connection.service'

/**
 * The demo workspace's fixed sample of board 5 (Q9, board 6: "Selects, Use
 * “web-app”, Create a service and Disconnect are shown but disabled"). The
 * page labels it "Demo data"; it is never shown for a real workspace and is
 * never a fallback when a request fails.
 */
export const DEMO_SERVICES = [
  { id: 'demo-svc-payments-api', name: 'payments-api' },
  { id: 'demo-svc-web-app', name: 'web-app' },
  { id: 'demo-svc-worker', name: 'worker' },
  { id: 'demo-svc-mobile-api', name: 'mobile-api' },
]

const row = (over: Partial<GitHubRepository> & Pick<GitHubRepository, 'id' | 'full_name'>): GitHubRepository => ({
  github_repo_id: '0',
  installation_id: '0',
  service_id: null,
  service_name: null,
  deploy_rule: null,
  access_state: 'accessible',
  removed_at: null,
  last_event_at: null,
  held_events: 0,
  environments_seen: [],
  jobs_seen: [],
  last_deployment_at: null,
  over_limit_this_month: 0,
  ...over,
})

export function DEMO_REPOSITORIES(now: number): GitHubRepository[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  return [
    row({
      id: 'demo-repo-1', full_name: 'acme-inc/payments-api', service_id: 'demo-svc-payments-api', service_name: 'payments-api',
      deploy_rule: { v: 1, mode: 'github_deployments', environment_name: 'production' },
      environments_seen: ['production'], last_deployment_at: ago(120),
    }),
    row({ id: 'demo-repo-2', full_name: 'acme-inc/web-app', held_events: 12 }),
    row({
      id: 'demo-repo-3', full_name: 'acme-inc/worker', service_id: 'demo-svc-worker', service_name: 'worker', held_events: 3,
      environments_seen: ['production', 'staging'],
      jobs_seen: [{ workflow_name: 'Deploy', job_name: 'deploy' }, { workflow_name: 'Release', job_name: 'release' }],
    }),
    row({
      id: 'demo-repo-4', full_name: 'acme-inc/mobile-api', service_id: 'demo-svc-mobile-api', service_name: 'mobile-api',
      deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy-prod', branch: 'default' },
      jobs_seen: [{ workflow_name: 'CI', job_name: 'deploy-prod' }], last_deployment_at: ago(60 * 26), over_limit_this_month: 2,
    }),
  ]
}
