/**
 * Pure rules of the GitHub screen's repository table (D8b-2, board 5 / 8):
 * which rows show, each row's status, the "Use “name”" chip, and the deploy
 * rule options. Everything comes from the server's row; nothing is guessed.
 */
import type { DeployRuleRequest, GitHubRepository, StoredDeployRule } from '../services/github-connection.service'
import { REPO_COPY } from './copy'

export interface ServiceOption {
  id: string
  name: string
}

export type RowStatus = 'recording' | 'waiting_for_service' | 'no_rule' | 'removed'

/**
 * Rows of the table: repositories linked to a current installation (R16: one
 * detached by a disconnect records nothing and is hidden), removed ones last (R8).
 */
export function tableRows(repositories: readonly GitHubRepository[]): GitHubRepository[] {
  const linked = repositories.filter((r) => r.installation_id !== null)
  return [...linked.filter((r) => r.access_state !== 'removed'), ...linked.filter((r) => r.access_state === 'removed')]
}

/** The number in "Repositories (n)": the linked repositories the app still has access to. */
export function repositoryCount(repositories: readonly GitHubRepository[]): number {
  return tableRows(repositories).filter((r) => r.access_state !== 'removed').length
}

/** A stored rule that records something: version 1, mode job (with names) or github_deployments. */
export function hasUsableRule(rule: StoredDeployRule | null): boolean {
  if (!rule || rule.v !== 1) return false
  if (rule.mode === 'job') return typeof rule.workflow_name === 'string' && typeof rule.job_name === 'string'
  return rule.mode === 'github_deployments'
}

export function rowStatus(repository: GitHubRepository): RowStatus {
  if (repository.access_state === 'removed') return 'removed'
  if (repository.service_id === null) return 'waiting_for_service'
  if (!hasUsableRule(repository.deploy_rule)) return 'no_rule'
  return 'recording'
}

/** The repository's own name, without its owner: "acme-inc/web-app" -> "web-app". */
export function repositoryName(fullName: string): string {
  const i = fullName.lastIndexOf('/')
  return i === -1 ? fullName : fullName.slice(i + 1)
}

/**
 * The service the "Use “name”" chip offers: only for a repository without a
 * service, and only a service named exactly like the repository (same case,
 * no trimming, no fuzzy match). Never applied without a click.
 */
export function matchingService(repository: GitHubRepository, services: readonly ServiceOption[]): ServiceOption | null {
  if (repository.service_id !== null || repository.access_state === 'removed') return null
  const name = repositoryName(repository.full_name)
  return services.find((s) => s.name === name) ?? null
}

export interface RuleOption {
  key: string
  label: string
  /** null: the stored rule itself, which this select can't re-send (N3). */
  request: DeployRuleRequest | null
}

const envKey = (name: string) => `env:${name.trim().toLowerCase()}`
const jobKey = (workflow: string, job: string) => `job:${JSON.stringify([workflow, job])}`

/** Job names that appear in more than one workflow: those options name the workflow too (N4). */
function ambiguousJobs(jobs: readonly { workflow_name: string; job_name: string }[]): Set<string> {
  const workflowsByJob = new Map<string, Set<string>>()
  for (const j of jobs) workflowsByJob.set(j.job_name, (workflowsByJob.get(j.job_name) ?? new Set()).add(j.workflow_name))
  return new Set([...workflowsByJob].filter(([, w]) => w.size > 1).map(([job]) => job))
}

/** The key of the stored rule among the options, or null when there is no usable rule. */
export function currentRuleKey(rule: StoredDeployRule | null): string | null {
  if (!rule || !hasUsableRule(rule)) return null
  if (rule.mode === 'job') {
    return (rule.branch ?? 'default') === 'default' ? jobKey(rule.workflow_name!, rule.job_name!) : 'current'
  }
  return typeof rule.environment_name === 'string' ? envKey(rule.environment_name) : 'current'
}

/** The label of a stored rule (the selected option, or the members' read-only text). */
export function ruleLabel(rule: StoredDeployRule | null, jobsSeen: readonly { workflow_name: string; job_name: string }[] = []): string | null {
  if (!rule || !hasUsableRule(rule)) return null
  if (rule.mode === 'job') {
    const job = rule.job_name!
    if (rule.branch === 'any') return REPO_COPY.ruleJobAnyBranch(job)
    if (rule.branch === 'named' && rule.branch_name) return REPO_COPY.ruleJobNamedBranch(job, rule.branch_name)
    const ambiguous = ambiguousJobs([...jobsSeen, { workflow_name: rule.workflow_name!, job_name: job }])
    return ambiguous.has(job) ? REPO_COPY.ruleJobInWorkflow(rule.workflow_name!, job) : REPO_COPY.ruleJob(job)
  }
  return typeof rule.environment_name === 'string' ? REPO_COPY.ruleEnvironment(rule.environment_name) : REPO_COPY.ruleAnyEnvironment
}

/**
 * The deploy rule options: each environment and each job DevControl has seen
 * for the repository (R7), plus the stored rule when it isn't one of them.
 * New rules use the server's defaults (job: default branch, production; R3).
 */
export function ruleOptions(repository: GitHubRepository): RuleOption[] {
  const options: RuleOption[] = repository.environments_seen.map((name) => ({
    key: envKey(name),
    label: REPO_COPY.ruleEnvironment(name),
    request: { mode: 'github_deployments', environment_name: name },
  }))
  const ambiguous = ambiguousJobs(repository.jobs_seen)
  for (const j of repository.jobs_seen) {
    options.push({
      key: jobKey(j.workflow_name, j.job_name),
      label: ambiguous.has(j.job_name) ? REPO_COPY.ruleJobInWorkflow(j.workflow_name, j.job_name) : REPO_COPY.ruleJob(j.job_name),
      request: { mode: 'job', workflow_name: j.workflow_name, job_name: j.job_name },
    })
  }
  const current = currentRuleKey(repository.deploy_rule)
  if (current !== null && !options.some((o) => o.key === current)) {
    const rule = repository.deploy_rule!
    const request: DeployRuleRequest | null = current === 'current' ? null
      : rule.mode === 'job' ? { mode: 'job', workflow_name: rule.workflow_name!, job_name: rule.job_name! }
        : { mode: 'github_deployments', environment_name: rule.environment_name! }
    options.unshift({ key: current, label: ruleLabel(rule, repository.jobs_seen)!, request })
  }
  return options
}

/** "Seen: environments … · jobs …" (distinct job names), or null when nothing was seen. */
export function seenLine(repository: GitHubRepository): string | null {
  const jobs = [...new Set(repository.jobs_seen.map((j) => j.job_name))]
  if (repository.environments_seen.length === 0 && jobs.length === 0) return null
  return REPO_COPY.seen(repository.environments_seen, jobs)
}
