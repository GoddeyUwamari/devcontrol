/**
 * Writes the deployment row for a detected candidate (D8a-2), inside the
 * event's tenant-tagged processing transaction:
 *
 *   1 per-organization quota lock (pg_advisory_xact_lock): concurrent
 *     deliveries and replays of one organization run this one at a time, so
 *     count-then-insert cannot overshoot the monthly limit
 *   2 a row exists for the same job / deployment id:
 *       with the same status                       -> processed already_recorded
 *       with a different status                    -> processed later_final_status
 *   3 over the monthly limit for the row's month   -> over_limit monthly_deployment_limit
 *   4 merge stamp from a stored merged pull request (D6, at insert only)
 *   5 insert; a concurrent duplicate                -> as in 2
 *            the service is gone                     -> unmapped service_missing
 *
 * Never a 402 to GitHub and never a dropped event: the outcome is only the
 * event's processing status.
 *
 * Rows are insert-only, so the first final status wins (ruling 6). A later
 * final status that disagrees with the row (failure after success, success
 * after error, a reused job id) is kept, linked to the row, as
 * later_final_status, so D7 can find it by reason (review N-1). A redelivery,
 * a replay of the same event, or the legacy route's row for the same job
 * carries the row's own status and stays already_recorded.
 */
import { PoolClient } from 'pg';
import { deploymentMonthlyLimit } from '../../middleware/subscription.middleware';
import {
  countDeploymentsInMonthOf,
  findPipelineDeployment,
  PipelineDeploymentRef,
  insertPipelineDeployment,
} from '../../repositories/deployments.repository';
import { linkDeployment, PipelineEventsReader, ProcessingStatus } from '../../repositories/pipeline-events.repository';
import { DeploymentStatusFacts, PullRequestFacts, WorkflowJobFacts } from './contract';
import { buildEnvironmentMetadata, buildJobMetadata } from './deployment-metadata';
import { DeploymentCandidate } from './detect';

export interface RecordOutcome {
  status: ProcessingStatus;
  reason: string | null;
  deploymentId: string | null;
}

/** The outcome for an event whose job or deployment already has a row. */
async function existingRowOutcome(
  client: PoolClient,
  organizationId: string,
  eventId: string,
  row: PipelineDeploymentRef,
  candidate: DeploymentCandidate
): Promise<RecordOutcome> {
  await linkDeployment(client, organizationId, eventId, row.id);
  const reason = row.status === candidate.status ? 'already_recorded' : 'later_final_status';
  return { status: 'processed', reason, deploymentId: row.id };
}

const QUOTA_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('deployments_quota:' || $1::text, 0))";

/** The earliest merged pull request of the repository whose merge commit is `sha`, or null. */
async function mergedPullRequestFor(client: PoolClient, organizationId: string, githubRepoId: number, sha: string | null): Promise<PullRequestFacts | null> {
  if (!sha) return null;
  const found = await PipelineEventsReader.findMergedPullRequestsOn(client, organizationId, githubRepoId, [sha]);
  return found[0]?.facts ?? null;
}

export async function recordDeployment(
  client: PoolClient,
  organizationId: string,
  eventId: string,
  facts: WorkflowJobFacts | DeploymentStatusFacts,
  candidate: DeploymentCandidate
): Promise<RecordOutcome> {
  await client.query(QUOTA_LOCK_SQL, [organizationId]);

  const existing = await findPipelineDeployment(client, organizationId, candidate.key.field, candidate.key.value);
  if (existing) return existingRowOutcome(client, organizationId, eventId, existing, candidate);

  const limit = await deploymentMonthlyLimit(client, organizationId);
  if (limit !== -1) {
    const used = await countDeploymentsInMonthOf(client, organizationId, candidate.deployedAt);
    if (used + 1 > limit) return { status: 'over_limit', reason: 'monthly_deployment_limit', deploymentId: null };
  }

  const pr = await mergedPullRequestFor(client, organizationId, candidate.githubRepoId, candidate.headSha);
  const metadata = facts.kind === 'workflow_job'
    ? buildJobMetadata(facts, candidate.githubRepoId, pr)
    : buildEnvironmentMetadata({ ...facts, deployment_id: candidate.key.value }, candidate.githubRepoId, pr);

  const inserted = await insertPipelineDeployment(client, {
    organizationId,
    serviceId: candidate.serviceId,
    environment: candidate.environment,
    awsRegion: candidate.awsRegion,
    status: candidate.status,
    deployedBy: candidate.deployedBy,
    deployedAt: candidate.deployedAt,
    metadata: metadata as unknown as Record<string, unknown>,
  });
  if (inserted) {
    await linkDeployment(client, organizationId, eventId, inserted);
    return { status: 'processed', reason: null, deploymentId: inserted };
  }

  const raced = await findPipelineDeployment(client, organizationId, candidate.key.field, candidate.key.value);
  if (raced) return existingRowOutcome(client, organizationId, eventId, raced, candidate);
  return { status: 'unmapped', reason: 'service_missing', deploymentId: null };
}
