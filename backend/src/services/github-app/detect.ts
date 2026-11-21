/**
 * Deploy detection (D8a-2, rulings Q1-Q7, d8a2-build.md §A.1): whether one
 * stored workflow_job / deployment_status event is a deployment, and if so
 * the row's columns. Pure: no I/O, no clock. The quota, the merge stamp and
 * the insert happen afterwards (record.ts).
 *
 * Checks run in this order; the first that applies decides:
 *   1 the organization is the legacy webhook's      -> ignored legacy_webhook_org
 *   2 the repository is not mapped to a service      -> unmapped repository_not_mapped
 *   3 no rule / mode none / unreadable rule          -> ignored no_deploy_rule / deploy_rule_invalid
 *   4 the event is not the rule's mode               -> ignored other_mode
 *   5 job: workflow + job name or branch differ      -> ignored not_deploy_job / branch_not_matched
 *   6 no result (cancelled, skipped, inactive, ...)  -> ignored conclusion_<x> / state_<x>
 *   7 environments: unknown environment name         -> ignored unknown_environment
 * A deployment is written once, at the terminal event, and never updated.
 */
import { DeploymentEnvironment } from '../deployment-status';
import { DeploymentStatusFacts, WorkflowJobFacts } from './contract';
import { DeployRule, environmentFor, readStoredDeployRule } from './deploy-rule';

export interface RepositoryForEvent {
  githubRepoId: number;
  serviceId: string | null;
  defaultBranch: string | null;
  deployRule: unknown;
}

export interface DetectionInput {
  facts: WorkflowJobFacts | DeploymentStatusFacts;
  repository: RepositoryForEvent | null;
  receivedAt: Date;
  /** The organization is GITHUB_WEBHOOK_ORG_ID while that variable is set (ruling Q12). */
  legacyWebhookOrganization: boolean;
}

export interface DeploymentCandidate {
  serviceId: string;
  githubRepoId: number;
  environment: DeploymentEnvironment;
  status: 'success' | 'failed';
  deployedAt: string;
  deployedBy: string;
  awsRegion: string | null;
  /** The unique key on deployments (deployments_github_job_uidx / _deployment_uidx). */
  key: { field: 'github_job_id' | 'github_deployment_id'; value: number };
  headSha: string | null;
}

export type Detection =
  | { kind: 'skip'; status: 'ignored' | 'unmapped'; reason: string }
  | { kind: 'record'; candidate: DeploymentCandidate };

const skip = (status: 'ignored' | 'unmapped', reason: string): Detection => ({ kind: 'skip', status, reason });

/** A token for a reason code ([a-z_]), never free text. */
const code = (value: string | null): string => (value && /^[a-z_]{1,32}$/.test(value) ? value : 'none');

/** workflow_job conclusion -> row status (ruling Q1); null = no result, no row. */
export function jobStatus(conclusion: string | null): 'success' | 'failed' | null {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'failed';
  return null;
}

/** deployment_status state -> row status (ruling Q1); null = no result, no row. */
export function deploymentStatus(state: string | null): 'success' | 'failed' | null {
  if (state === 'success') return 'success';
  if (state === 'failure' || state === 'error') return 'failed';
  return null;
}

function branchMatches(rule: Extract<DeployRule, { mode: 'job' }>, headBranch: string | null, defaultBranch: string | null): boolean {
  if (rule.branch === 'any') return true;
  const wanted = rule.branch === 'named' ? rule.branch_name : defaultBranch;
  return wanted !== null && headBranch !== null && headBranch === wanted;
}

export function detectDeployment(input: DetectionInput): Detection {
  const { facts, repository } = input;
  if (input.legacyWebhookOrganization) return skip('ignored', 'legacy_webhook_org');
  if (!repository || repository.serviceId === null) return skip('unmapped', 'repository_not_mapped');

  const rule = readStoredDeployRule(repository.deployRule);
  if (rule === 'invalid') return skip('ignored', 'deploy_rule_invalid');
  if (rule.mode === 'none') return skip('ignored', 'no_deploy_rule');

  const received = input.receivedAt.toISOString();
  const deployedBy = facts.sender?.login ?? 'github';
  const base = { serviceId: repository.serviceId, githubRepoId: repository.githubRepoId, deployedBy, awsRegion: rule.aws_region };

  if (facts.kind === 'workflow_job') {
    if (rule.mode !== 'job') return skip('ignored', 'other_mode');
    if (facts.workflow_name !== rule.workflow_name || facts.job_name !== rule.job_name) return skip('ignored', 'not_deploy_job');
    const defaultBranch = facts.repository?.default_branch ?? repository.defaultBranch;
    if (!branchMatches(rule, facts.head_branch, defaultBranch)) return skip('ignored', 'branch_not_matched');
    const status = jobStatus(facts.conclusion);
    if (!status) return skip('ignored', `conclusion_${code(facts.conclusion)}`);
    return {
      kind: 'record',
      candidate: {
        ...base,
        environment: rule.environment,
        status,
        deployedAt: facts.completed_at ?? received,
        key: { field: 'github_job_id', value: facts.job_id },
        headSha: facts.head_sha,
      },
    };
  }

  if (rule.mode !== 'github_deployments') return skip('ignored', 'other_mode');
  const status = deploymentStatus(facts.state);
  if (!status) return skip('ignored', `state_${code(facts.state)}`);
  if (facts.deployment_id === null) return skip('ignored', 'no_deployment_id');
  const environment = environmentFor(facts.environment, rule.environment_map);
  if (!environment) return skip('ignored', 'unknown_environment');
  return {
    kind: 'record',
    candidate: {
      ...base,
      environment,
      status,
      deployedAt: facts.created_at ?? received,
      key: { field: 'github_deployment_id', value: facts.deployment_id },
      headSha: facts.sha,
    },
  };
}
