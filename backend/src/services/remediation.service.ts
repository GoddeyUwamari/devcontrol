/**
 * Remediation Service
 * Executes approved remediation actions against real AWS resources.
 *
 * IMPORTANT: This service only runs after explicit human approval.
 * No AWS resource is ever touched without status === 'approved'.
 */

import { Pool } from 'pg';
import { assumeRoleAsPlatform } from './platform-sts';
import { findEligibleAwsAccount, type AwsAccountRow } from '../repositories/aws-accounts.repository';
import { regionFromLocationConstraint } from './s3-bucket-tags.util';
import {
  EC2Client,
  StopInstancesCommand,
  StartInstancesCommand,
  ModifyInstanceAttributeCommand,
  DeleteSnapshotCommand,
  DeleteVolumeCommand,
  CreateSnapshotCommand,
  ReleaseAddressCommand,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';
import {
  S3Client,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import {
  RDSClient,
  ModifyDBInstanceCommand,
} from '@aws-sdk/client-rds';

export type ActionType =
  | 'stop_instance'
  | 'rightsize_instance'
  | 'delete_snapshot'
  | 'delete_unattached_volume'
  | 'enable_s3_lifecycle'
  | 'downgrade_rds_instance'
  | 'delete_unused_elasticip';

export type WorkflowStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

interface WorkflowRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  resource_id: string;
  resource_type: string;
  action_type: ActionType;
  action_params: Record<string, any>;
  estimated_savings: number;
  risk_level: string;
  status: WorkflowStatus;
  approved_by: string | null;
  approved_at: Date | null;
  executed_by: string | null;
  executed_at: Date | null;
  completed_at: Date | null;
  execution_log: string | null;
  rollback_available: boolean;
  rollback_snapshot_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// Actions DevControl will not create, approve, execute, or roll back.
// rightsize_instance stops an EC2 instance, changes its type to a
// caller-supplied target, and restarts it -- and DevControl has no validated
// rightsizing recommendation to base that target on yet. This is "currently
// unavailable", not "no rightsizing opportunity exists". The implementation
// (rightsizeInstance) is kept for when a validated recommendation exists.
// downgrade_rds_instance modifies a DB instance's class, and its only source --
// the oversized-RDS detector -- was retired for having no utilisation data, so
// it is unavailable for the same reason (downgradeRDSInstance is kept likewise).
export const ACTION_UNAVAILABLE_PREFIX = 'ACTION_UNAVAILABLE:';
const UNAVAILABLE_ACTIONS: Partial<Record<ActionType, string>> = {
  rightsize_instance:
    'EC2 rightsizing remediation is currently unavailable. DevControl does not yet have a validated rightsizing recommendation to base an instance-type change on.',
  downgrade_rds_instance:
    'RDS instance downgrade remediation is currently unavailable. DevControl does not yet have a validated, utilisation-based RDS sizing recommendation to base an instance-class change on.',
};

export function assertActionAvailable(actionType: string): void {
  const reason = UNAVAILABLE_ACTIONS[actionType as ActionType];
  if (reason) throw new Error(`${ACTION_UNAVAILABLE_PREFIX} ${reason}`);
}

/**
 * Whether the global kill-switch allows real AWS execution: only the exact
 * string 'true'. Read at call time. The one definition of the setting --
 * the execution guard below and anything that reports it both use this.
 */
export function isAutomatedRemediationEnabled(): boolean {
  return process.env.ENABLE_AUTOMATED_REMEDIATION === 'true';
}

// A workflow has one target: resource_id. Every action handler reads its
// target from action_params.resource_id, while the self-protection guards,
// the rollback and the UI read the workflow's resource_id, so the two must
// never differ. bindActionTarget() makes them equal when a workflow is
// created; assertTargetBound() refuses to act on a stored row where they are
// not (rows written before creation enforced this).
export const TARGET_MISMATCH_PREFIX = 'TARGET_MISMATCH:';

export function bindActionTarget(
  resourceId: string,
  actionParams: Record<string, any>
): Record<string, any> {
  if (actionParams.resource_id !== undefined && actionParams.resource_id !== resourceId) {
    throw new Error(`${TARGET_MISMATCH_PREFIX} actionParams.resource_id must match resourceId`);
  }
  return { ...actionParams, resource_id: resourceId };
}

function assertTargetBound(workflow: { resource_id: string; action_params: Record<string, any> }): void {
  if (workflow.action_params?.resource_id !== workflow.resource_id) {
    throw new Error(
      'REMEDIATION_BLOCKED: Workflow action target does not match its resource_id. No AWS action was taken.'
    );
  }
}

// A workflow acts in its resource's region: action_params.region, taken at
// creation from the discovered resource (or, when the resource is not in the
// inventory, its recommendation). Never the platform's environment region, and
// never a region the caller supplied with nothing to confirm it.
// RemediationService.bindTargetRegion() binds it when a workflow is created and
// refuses a region that contradicts the inventory; resolveTargetRegion() refuses,
// before any AWS call, a stored workflow whose region cannot be established.
export const REGION_MISMATCH_PREFIX = 'REGION_MISMATCH:';

// Execute and rollback refusals for region reasons. The routes answer them with
// 409: the request is valid, the workflow's state does not allow it.
export const REGION_UNKNOWN_MESSAGE =
  "REMEDIATION_BLOCKED: The workflow's resource region is unknown. No AWS action was taken.";
export const REGION_AMBIGUOUS_MESSAGE =
  "REMEDIATION_BLOCKED: The inventory holds the workflow's resource in more than one region. No AWS action was taken.";
export const REGION_INVENTORY_MISMATCH_MESSAGE =
  "REMEDIATION_BLOCKED: The workflow's region does not match the resource's region in the inventory. No AWS action was taken.";

export const REGION_BINDING_CONFLICT_MESSAGE =
  "REMEDIATION_BLOCKED: The workflow's region was bound to a different region by another request. No AWS action was taken.";

export function isRegionBlocked(message: unknown): boolean {
  return (
    message === REGION_UNKNOWN_MESSAGE ||
    message === REGION_BINDING_CONFLICT_MESSAGE ||
    message === REGION_AMBIGUOUS_MESSAGE ||
    message === REGION_INVENTORY_MISMATCH_MESSAGE
  );
}

// Self-protection refusals (see the guards in RemediationService). Their text
// names the check that matched, which is for the server log only: the routes
// answer them with SELF_PROTECTION_PUBLIC_MESSAGE.
export const SELF_PROTECTION_BLOCKED_PREFIX =
  'REMEDIATION_BLOCKED: Cannot execute automated actions against DevControl operational infrastructure';
export const SELF_PROTECTION_UNVERIFIED_PREFIX = 'REMEDIATION_BLOCKED: Unable to verify';
export const SELF_PROTECTION_PUBLIC_MESSAGE = "This action isn't allowed on this resource.";

export function isSelfProtectionRefusal(message: unknown): boolean {
  return (
    typeof message === 'string' &&
    (message.startsWith(SELF_PROTECTION_BLOCKED_PREFIX) || message.startsWith(SELF_PROTECTION_UNVERIFIED_PREFIX))
  );
}

/** An AWS region name, such as us-east-1 or us-gov-west-1. */
const AWS_REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export function isAwsRegion(value: unknown): value is string {
  return typeof value === 'string' && AWS_REGION_PATTERN.test(value);
}

export class RemediationService {
  constructor(private pool: Pool) {}

  // ─── Self-protection guard ──────────────────────────────────────────────
  // DevControl's own operational AWS infrastructure must never be a valid
  // target for automated execution. Checked unconditionally at the top of
  // execute(), independent of and in addition to the ENABLE_AUTOMATED_REMEDIATION
  // kill-switch — a match blocks execution even if the kill-switch is enabled.
  //
  // Layer 1 (below, no AWS call): resource_id and organization_id are compared
  // against env vars rather than hardcoded strings, so the guard survives the
  // instance being redeployed/recreated as long as the var is kept current.
  //
  // Layer 2 (assertNotDevControlInfrastructureByTag, called separately from
  // execute() after credentials are obtained — see there for why): a live
  // tag lookup, since
  // cost_recommendations.metadata does not capture tags and a stale value
  // would be unsafe to trust for a destructive action.
  private assertNotDevControlInfrastructureByIdentifiers(
    organizationId: string,
    resourceId: string
  ): void {
    const reasons: string[] = [];

    const protectedInstanceId = process.env.DEVCONTROL_PROD_INSTANCE_ID;
    if (protectedInstanceId && resourceId === protectedInstanceId) {
      reasons.push('resource_id matches DEVCONTROL_PROD_INSTANCE_ID');
    }

    const protectedOrgId = process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
    if (protectedOrgId && organizationId === protectedOrgId) {
      reasons.push('organization_id matches DEVCONTROL_OPERATIONAL_ORG_ID');
    }

    if (reasons.length > 0) {
      throw new Error(
        `${SELF_PROTECTION_BLOCKED_PREFIX} (${reasons.join('; ')})`
      );
    }
  }

  /**
   * Live tag check — only meaningful for EC2 instance resource IDs. Fails
   * closed: if the lookup can't be completed, we cannot confirm the resource
   * is safe, so execution is blocked rather than proceeding blind.
   */
  private async assertNotDevControlInfrastructureByTag(
    ec2: EC2Client,
    resourceId: string
  ): Promise<void> {
    if (!/^i-[0-9a-f]+$/i.test(resourceId)) return; // not an EC2 instance ID — tag check N/A

    let tags: Array<{ Key?: string; Value?: string }> = [];
    try {
      const desc = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [resourceId] }));
      tags = desc.Reservations?.[0]?.Instances?.[0]?.Tags || [];
    } catch (err: any) {
      throw new Error(
        `${SELF_PROTECTION_UNVERIFIED_PREFIX} ${resourceId} is not DevControl operational infrastructure (tag lookup failed: ${err.message})`
      );
    }

    const isProtected = tags.some((t) => t.Key === 'App' && t.Value === 'DevControl');
    if (isProtected) {
      throw new Error(
        `${SELF_PROTECTION_BLOCKED_PREFIX} (resource tag App=DevControl present)`
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  // Scoped to the caller's organization in the query itself, and again on the
  // row it returns; another organization's workflow is answered exactly like
  // one that does not exist.
  private async getWorkflow(id: string, organizationId: string): Promise<WorkflowRow> {
    const result = await this.pool.query(
      'SELECT * FROM remediation_workflows WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    const workflow = result.rows[0];
    if (!workflow || workflow.organization_id !== organizationId) throw new Error('Workflow not found');
    return workflow;
  }

  // The global kill-switch. Off by default so real AWS execution ships inert
  // until explicitly enabled; applies to rollback as much as to execution.
  private assertAutomatedRemediationEnabled(workflow: WorkflowRow, operation: string): void {
    if (!isAutomatedRemediationEnabled()) {
      console.log(
        `[REMEDIATION BLOCKED] Dry-run mode enabled — workflow ${workflow.id} ` +
        `(${operation} ${workflow.action_type} on ${workflow.resource_id}) not executed. ` +
        `Set ENABLE_AUTOMATED_REMEDIATION=true to enable real AWS execution.`
      );
      throw new Error('DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.');
    }
  }

  private async updateStatus(
    workflowId: string,
    organizationId: string,
    newStatus: WorkflowStatus,
    extras: Record<string, any> = {},
    auditNote?: string,
    changedBy?: string,
    ipAddress?: string
  ): Promise<void> {
    const workflow = await this.getWorkflow(workflowId, organizationId);
    const setFields = ['status = $1', 'updated_at = NOW()'];
    const values: any[] = [newStatus];
    let idx = 2;

    for (const [key, val] of Object.entries(extras)) {
      setFields.push(`${key} = $${idx++}`);
      values.push(val);
    }
    values.push(workflowId, organizationId);

    await this.pool.query(
      `UPDATE remediation_workflows SET ${setFields.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1}`,
      values
    );

    await this.pool.query(
      `INSERT INTO remediation_audit_log
         (workflow_id, old_status, new_status, changed_by, ip_address, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [workflowId, workflow.status, newStatus, changedBy ?? null, ipAddress ?? null, auditNote ?? null]
    );
  }

  private appendLog(existing: string | null, line: string): string {
    const ts = new Date().toISOString();
    return `${existing ? existing + '\n' : ''}[${ts}] ${line}`;
  }

  /**
   * The org's one eligible account, resolved before a workflow's status
   * changes: none is refused, and more than one throws
   * AwsAccountAmbiguousError, before any AWS call.
   */
  private async resolveAccount(organizationId: string): Promise<AwsAccountRow> {
    const account = await findEligibleAwsAccount(this.pool, organizationId);

    if (!account) {
      throw new Error('No active AWS account configured. Connect an AWS account first.');
    }
    return account;
  }

  /**
   * Assume the account's AWS role (the org's one eligible account unless
   * given) and return temporary credentials.
   * Validates the role is still assumable before execution.
   */
  private async getAWSCredentials(organizationId: string, resolved?: AwsAccountRow): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  }> {
    const account = resolved ?? (await this.resolveAccount(organizationId));
    const { role_arn: roleArn, external_id: externalId } = account;

    if (!externalId) {
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} aws_accounts row is missing external_id`);
    }

    // The platform's own identity, from the SDK's default credential chain. The
    // STS endpoint only issues the credentials; every action client is built for
    // the workflow's own region.
    const assumed = await assumeRoleAsPlatform('us-east-1', {
      RoleArn: roleArn,
      RoleSessionName: `devcontrol-remediation-${Date.now()}`,
      ExternalId: externalId,
      DurationSeconds: 900, // 15 minutes — enough for any single action
    }, `RemediationService org ${organizationId}`);

    const creds = assumed.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      throw new Error('Failed to obtain temporary AWS credentials');
    }

    return {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    };
  }

  private makeEC2Client(creds: Awaited<ReturnType<typeof this.getAWSCredentials>>, region: string) {
    return new EC2Client({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  private makeS3Client(creds: Awaited<ReturnType<typeof this.getAWSCredentials>>, region: string) {
    return new S3Client({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  private makeRDSClient(creds: Awaited<ReturnType<typeof this.getAWSCredentials>>, region: string) {
    return new RDSClient({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  // ─── Target region ────────────────────────────────────────────────────────

  /**
   * The regions the inventory holds for this resource id (not terminated). More
   * than one means the id alone does not say which resource is meant.
   */
  private async inventoryRegions(organizationId: string, resourceId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT region FROM aws_resources
       WHERE organization_id = $1 AND resource_id = $2 AND status != 'terminated'`,
      [organizationId, resourceId]
    );
    const regions = result.rows
      .map((row) => row.region)
      .filter((region): region is string => typeof region === 'string')
      .map((region) => regionFromLocationConstraint(region))
      .filter(isAwsRegion);
    return Array.from(new Set(regions));
  }

  /**
   * Sets action_params.region from the resource: the inventory's region for it,
   * or, when the inventory does not hold it, its recommendation's region. A
   * supplied region that contradicts that source, or an inventory that holds
   * the id in more than one region, is refused. A supplied region with no source
   * to confirm it is not stored: the workflow is created without a region, and
   * execute/rollback look it up again (resolveTargetRegion). A recommendation
   * must be this organization's and for this resource.
   */
  private async bindTargetRegion(
    organizationId: string,
    resourceId: string,
    recommendationId: string | undefined,
    actionParams: Record<string, any>
  ): Promise<Record<string, any>> {
    // null is no region supplied (a recommendation with no region passes its own aws_region).
    const { region, ...rest } = actionParams;
    const supplied = region ?? undefined;
    if (supplied !== undefined && !isAwsRegion(supplied)) {
      throw new Error(`${REGION_MISMATCH_PREFIX} actionParams.region must be an AWS region`);
    }

    const inventory = await this.inventoryRegions(organizationId, resourceId);
    if (inventory.length > 1) {
      throw new Error(`${REGION_MISMATCH_PREFIX} the resource is in more than one region; its region cannot be chosen`);
    }

    let known: string | undefined = inventory[0];
    if (recommendationId) {
      const result = await this.pool.query(
        `SELECT resource_id, aws_region FROM cost_recommendations WHERE id = $1 AND organization_id = $2`,
        [recommendationId, organizationId]
      );
      const recommendation = result.rows[0];
      if (!recommendation || recommendation.resource_id !== resourceId) {
        throw new Error(`${TARGET_MISMATCH_PREFIX} recommendationId must be a recommendation for resourceId`);
      }
      if (!known && isAwsRegion(recommendation.aws_region)) known = recommendation.aws_region;
    }

    if (known && supplied !== undefined && supplied !== known) {
      throw new Error(`${REGION_MISMATCH_PREFIX} actionParams.region must be the resource's region (${known})`);
    }
    return known ? { ...rest, region: known } : rest;
  }

  /**
   * Stores `region` on a workflow that has none. The write only applies while
   * the stored region is still missing, so a concurrent request cannot have
   * its binding overwritten. When it applies to no row, the stored region is
   * read back: the same region is accepted, anything else is refused before
   * any AWS call. Success is never reported without a verified write.
   */
  private async bindRegion(workflow: WorkflowRow, organizationId: string, region: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE remediation_workflows
          SET action_params = jsonb_set(action_params, '{region}', to_jsonb($1::text)), updated_at = NOW()
        WHERE id = $2 AND organization_id = $3
          AND ((action_params->>'region') IS NULL OR (action_params->>'region') = '')`,
      [region, workflow.id, organizationId]
    );

    if (result.rowCount !== 1) {
      const { rows } = await this.pool.query(
        `SELECT action_params->>'region' AS region FROM remediation_workflows WHERE id = $1 AND organization_id = $2`,
        [workflow.id, organizationId]
      );
      const stored = rows[0]?.region;
      if (stored !== region) {
        throw new Error(stored ? REGION_BINDING_CONFLICT_MESSAGE : REGION_UNKNOWN_MESSAGE);
      }
    }

    workflow.action_params = { ...workflow.action_params, region };
  }

  /**
   * The region execute and rollback act in, established before any AWS call:
   *
   *   - a stored region must be a region the inventory does not contradict;
   *   - with no stored region, the inventory's one region for the resource is
   *     bound and stored on the workflow; none or more than one is refused.
   *
   * Sets action_params.region on `workflow` so the action handlers use it.
   */
  private async resolveTargetRegion(workflow: WorkflowRow, organizationId: string): Promise<string> {
    const stored = workflow.action_params?.region;
    const inventory = await this.inventoryRegions(organizationId, workflow.resource_id);

    if (stored === undefined || stored === null || stored === '') {
      if (inventory.length === 0) throw new Error(REGION_UNKNOWN_MESSAGE);
      if (inventory.length > 1) throw new Error(REGION_AMBIGUOUS_MESSAGE);
      const region = inventory[0];
      await this.bindRegion(workflow, organizationId, region);
      return region;
    }

    if (!isAwsRegion(stored)) throw new Error(REGION_UNKNOWN_MESSAGE);
    // A workflow created before regions were bound may carry another region.
    if (inventory.length > 0 && (inventory.length > 1 || inventory[0] !== stored)) {
      throw new Error(REGION_INVENTORY_MISMATCH_MESSAGE);
    }
    return stored;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async listWorkflows(organizationId: string, status?: string) {
    const where = status ? `AND status = $2` : '';
    const params: any[] = [organizationId];
    if (status) params.push(status);

    const result = await this.pool.query(
      `SELECT rw.*,
              u_approved.email AS approved_by_email,
              u_executed.email  AS executed_by_email
       FROM remediation_workflows rw
       LEFT JOIN users u_approved ON u_approved.id = rw.approved_by
       LEFT JOIN users u_executed  ON u_executed.id  = rw.executed_by
       WHERE rw.organization_id = $1 ${where}
       ORDER BY rw.created_at DESC`,
      params
    );
    return result.rows;
  }

  async getWorkflowWithAudit(id: string, organizationId: string) {
    const [workflowResult, auditResult] = await Promise.all([
      this.pool.query(
        `SELECT rw.*,
                u_approved.email AS approved_by_email,
                u_approved.full_name AS approved_by_name,
                u_executed.email   AS executed_by_email,
                u_executed.full_name AS executed_by_name
         FROM remediation_workflows rw
         LEFT JOIN users u_approved ON u_approved.id = rw.approved_by
         LEFT JOIN users u_executed  ON u_executed.id  = rw.executed_by
         WHERE rw.id = $1 AND rw.organization_id = $2`,
        [id, organizationId]
      ),
      this.pool.query(
        `SELECT al.*, u.email AS changed_by_email, u.full_name AS changed_by_name
         FROM remediation_audit_log al
         LEFT JOIN users u ON u.id = al.changed_by
         WHERE al.workflow_id = $1
         ORDER BY al.changed_at ASC`,
        [id]
      ),
    ]);

    if (workflowResult.rows.length === 0) return null;
    return {
      ...workflowResult.rows[0],
      auditLog: auditResult.rows,
    };
  }

  async createWorkflow(
    organizationId: string,
    data: {
      recommendationId?: string;
      resourceId: string;
      resourceType: string;
      actionType: ActionType;
      actionParams: Record<string, any>;
      estimatedSavings: number;
      riskLevel: 'low' | 'medium' | 'high';
    },
    createdBy?: string
  ) {
    assertActionAvailable(data.actionType);
    const actionParams = await this.bindTargetRegion(
      organizationId,
      data.resourceId,
      data.recommendationId,
      bindActionTarget(data.resourceId, data.actionParams)
    );

    const result = await this.pool.query(
      `INSERT INTO remediation_workflows
         (organization_id, recommendation_id, resource_id, resource_type,
          action_type, action_params, estimated_savings, risk_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        organizationId,
        data.recommendationId ?? null,
        data.resourceId,
        data.resourceType,
        data.actionType,
        JSON.stringify(actionParams),
        data.estimatedSavings,
        data.riskLevel,
      ]
    );

    const workflow = result.rows[0];

    // Write initial audit entry
    await this.pool.query(
      `INSERT INTO remediation_audit_log (workflow_id, old_status, new_status, changed_by, note)
       VALUES ($1, NULL, 'pending_approval', $2, 'Workflow created')`,
      [workflow.id, createdBy ?? null]
    );

    return workflow;
  }

  async approve(workflowId: string, organizationId: string, approvedBy: string, ipAddress?: string) {
    const workflow = await this.getWorkflow(workflowId, organizationId);
    assertActionAvailable(workflow.action_type);
    if (workflow.status !== 'pending_approval') throw new Error(`Cannot approve workflow in status: ${workflow.status}`);

    await this.updateStatus(
      workflowId,
      organizationId,
      'approved',
      { approved_by: approvedBy, approved_at: new Date() },
      'Workflow approved',
      approvedBy,
      ipAddress
    );

    return this.getWorkflow(workflowId, organizationId);
  }

  async reject(
    workflowId: string,
    organizationId: string,
    rejectedBy: string,
    reason: string,
    ipAddress?: string
  ) {
    const workflow = await this.getWorkflow(workflowId, organizationId);
    if (workflow.status !== 'pending_approval') throw new Error(`Cannot reject workflow in status: ${workflow.status}`);

    await this.updateStatus(
      workflowId,
      organizationId,
      'rejected',
      { rejected_at: new Date(), rejection_reason: reason },
      `Rejected: ${reason}`,
      rejectedBy,
      ipAddress
    );

    return this.getWorkflow(workflowId, organizationId);
  }

  /**
   * Close an approved workflow whose execution was refused before anything
   * ran, so it does not stay approved and executable. 'failed' is the state
   * execute() already gives an attempt that did not complete; executed_by
   * and executed_at stay unset because nothing was executed.
   *
   * The update applies only while the workflow is still approved. If it has
   * already left that state (closed by a repeated call, or moved on by
   * another request), nothing is changed or audited: it is no longer
   * executable either way.
   */
  async closeUnexecuted(
    workflowId: string,
    organizationId: string,
    closedBy: string,
    reason: string,
    ipAddress?: string
  ) {
    const workflow = await this.getWorkflow(workflowId, organizationId);
    const note = `Not executed: ${reason}`;

    const closed = await this.pool.query(
      `UPDATE remediation_workflows SET status = 'failed', execution_log = $1, updated_at = NOW()
        WHERE id = $2 AND organization_id = $3 AND status = 'approved'`,
      [this.appendLog(workflow.execution_log, note), workflowId, organizationId]
    );

    if (closed.rowCount === 1) {
      await this.pool.query(
        `INSERT INTO remediation_audit_log
           (workflow_id, old_status, new_status, changed_by, ip_address, note)
         VALUES ($1, 'approved', 'failed', $2, $3, $4)`,
        [workflowId, closedBy, ipAddress ?? null, note]
      );
    }

    return this.getWorkflow(workflowId, organizationId);
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute(workflowId: string, organizationId: string, executedBy: string, ipAddress?: string) {
    const workflow = await this.getWorkflow(workflowId, organizationId);
    // Before any status change, credential fetch, or AWS call. dispatchAction()
    // repeats the check immediately before the handler (defense in depth).
    assertActionAvailable(workflow.action_type);
    if (workflow.status !== 'approved') {
      throw new Error(`Workflow must be approved before executing. Current status: ${workflow.status}`);
    }

    // Self-protection guard, layer 1 — no AWS call, always runs first, blocks
    // regardless of kill-switch state (see comment on the guard methods above).
    this.assertNotDevControlInfrastructureByIdentifiers(workflow.organization_id, workflow.resource_id);

    // The handlers act on action_params.resource_id; the guards inspect
    // resource_id. Refuse unless they are the same resource.
    assertTargetBound(workflow);

    // Global kill-switch — must be checked before any AWS SDK call fires.
    this.assertAutomatedRemediationEnabled(workflow, 'execute');

    // ...and act in that resource's region, which must be established.
    const region = await this.resolveTargetRegion(workflow, organizationId);

    // The account to act in, resolved before the status changes: a missing or
    // ambiguous account refuses with the workflow left as it was.
    const account = await this.resolveAccount(organizationId);

    // Mark as executing
    await this.updateStatus(
      workflowId,
      organizationId,
      'executing',
      { executed_by: executedBy, executed_at: new Date(), execution_log: '[Starting execution...]' },
      'Execution started',
      executedBy,
      ipAddress
    );

    let log = this.appendLog(null, `Execution started by ${executedBy}`);
    let rollbackSnapshotId: string | undefined;
    let rollbackAvailable = false;

    try {
      const creds = await this.getAWSCredentials(organizationId, account);
      const params = workflow.action_params as Record<string, any>;

      log = this.appendLog(log, `AWS credentials obtained via STS AssumeRole`);

      // Self-protection guard, layer 2 — live tag check. Runs after credentials
      // are obtained (it needs an EC2 client) but strictly before any mutating
      // command below, so a tag match still blocks even though the kill-switch
      // was enabled to get this far.
      await this.assertNotDevControlInfrastructureByTag(this.makeEC2Client(creds, region), workflow.resource_id);

      const result = await this.dispatchAction(workflow.action_type, creds, params, log, workflowId);
      log = result.log;
      rollbackSnapshotId = result.rollbackSnapshotId;
      rollbackAvailable = result.rollbackAvailable ?? false;

      log = this.appendLog(log, 'Execution completed successfully');

      await this.updateStatus(
        workflowId,
        organizationId,
        'completed',
        {
          completed_at: new Date(),
          execution_log: log,
          rollback_available: rollbackAvailable,
          rollback_snapshot_id: rollbackSnapshotId ?? null,
        },
        'Execution completed',
        executedBy,
        ipAddress
      );
    } catch (err: any) {
      log = this.appendLog(log, `ERROR: ${err.message}`);
      await this.updateStatus(
        workflowId,
        organizationId,
        'failed',
        { execution_log: log },
        `Execution failed: ${err.message}`,
        executedBy,
        ipAddress
      );
      throw err;
    }

    return this.getWorkflow(workflowId, organizationId);
  }

  /**
   * The action dispatcher: the single place an approved workflow's action_type
   * becomes a mutating AWS call. Every execution path goes through here.
   */
  private async dispatchAction(
    actionType: ActionType,
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string,
    workflowId: string
  ): Promise<{ log: string; rollbackSnapshotId?: string; rollbackAvailable?: boolean }> {
    switch (actionType) {
      case 'stop_instance':
        return this.stopInstance(creds, params, log, workflowId);
      case 'rightsize_instance':
        assertActionAvailable(actionType); // never reaches rightsizeInstance while unavailable
        return this.rightsizeInstance(creds, params, log, workflowId);
      case 'delete_snapshot':
        return this.deleteSnapshot(creds, params, log);
      case 'delete_unattached_volume':
        return this.deleteUnattachedVolume(creds, params, log, workflowId);
      case 'enable_s3_lifecycle':
        return this.enableS3Lifecycle(creds, params, log);
      case 'downgrade_rds_instance':
        assertActionAvailable(actionType); // never reaches downgradeRDSInstance while unavailable
        return this.downgradeRDSInstance(creds, params, log);
      case 'delete_unused_elasticip':
        return this.deleteUnusedElasticIP(creds, params, log);
      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  async rollback(workflowId: string, organizationId: string, executedBy: string, ipAddress?: string) {
    const workflow = await this.getWorkflow(workflowId, organizationId);
    assertActionAvailable(workflow.action_type);
    if (!workflow.rollback_available) throw new Error('Rollback is not available for this workflow');
    if (workflow.status !== 'completed') throw new Error('Can only rollback completed workflows');

    // The same safety boundary as execute(), in the same order:
    // self-protection layer 1, one target, then the kill-switch -- all before
    // the credential fetch or any AWS call.
    this.assertNotDevControlInfrastructureByIdentifiers(workflow.organization_id, workflow.resource_id);
    assertTargetBound(workflow);
    this.assertAutomatedRemediationEnabled(workflow, 'rollback');
    const region = await this.resolveTargetRegion(workflow, organizationId);

    const account = await this.resolveAccount(organizationId);
    const creds = await this.getAWSCredentials(organizationId, account);
    let log = this.appendLog(workflow.execution_log, `Rollback initiated by ${executedBy}`);

    try {
      // Self-protection layer 2 — live tag check, before any mutating command.
      await this.assertNotDevControlInfrastructureByTag(
        this.makeEC2Client(creds, region),
        workflow.resource_id
      );

      if (workflow.action_type === 'stop_instance') {
        // Rollback: restart the instance
        const ec2 = this.makeEC2Client(creds, region);
        await ec2.send(new StartInstancesCommand({ InstanceIds: [workflow.resource_id] }));
        log = this.appendLog(log, `Instance ${workflow.resource_id} start command issued`);
      } else if (workflow.action_type === 'delete_unattached_volume') {
        // Rollback: inform that snapshot exists but volume recreation is manual
        log = this.appendLog(
          log,
          `Rollback: snapshot ${workflow.rollback_snapshot_id} is available in AWS. ` +
          `Restore by creating a new volume from this snapshot via the AWS Console.`
        );
      }

      await this.updateStatus(
        workflowId,
        organizationId,
        'rolled_back',
        { execution_log: log },
        'Rollback completed',
        executedBy,
        ipAddress
      );
    } catch (err: any) {
      log = this.appendLog(log, `Rollback ERROR: ${err.message}`);
      await this.pool.query(
        'UPDATE remediation_workflows SET execution_log = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3',
        [log, workflowId, organizationId]
      );
      throw err;
    }

    return this.getWorkflow(workflowId, organizationId);
  }

  // ─── Action Implementations ───────────────────────────────────────────────

  private async stopInstance(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string,
    workflowId: string
  ) {
    const ec2 = this.makeEC2Client(creds, params.region);
    const instanceId = params.resource_id;

    // Find root volume for snapshot
    let rollbackSnapshotId: string | undefined;
    let rollbackAvailable = false;

    try {
      const descResult = await ec2.send(new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      }));
      const instance = descResult.Reservations?.[0]?.Instances?.[0];
      const rootVolume = instance?.BlockDeviceMappings?.find(
        (b) => b.DeviceName === instance.RootDeviceName
      );

      if (rootVolume?.Ebs?.VolumeId) {
        log = this.appendLog(log, `Creating pre-stop snapshot of root volume ${rootVolume.Ebs.VolumeId}...`);
        const snapResult = await ec2.send(new CreateSnapshotCommand({
          VolumeId: rootVolume.Ebs.VolumeId,
          Description: `DevControl pre-stop snapshot — ${workflowId}`,
          TagSpecifications: [{
            ResourceType: 'snapshot',
            Tags: [
              { Key: 'CreatedBy', Value: 'DevControl-Remediation' },
              { Key: 'WorkflowId', Value: workflowId },
            ],
          }],
        }));
        rollbackSnapshotId = snapResult.SnapshotId;
        rollbackAvailable = true;
        log = this.appendLog(log, `Snapshot created: ${rollbackSnapshotId} (rollback available)`);
      }
    } catch (snapErr: any) {
      log = this.appendLog(log, `Warning: could not create rollback snapshot: ${snapErr.message}`);
    }

    // Stop the instance
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
    log = this.appendLog(log, `StopInstances command issued for ${instanceId}`);

    return { log, rollbackSnapshotId, rollbackAvailable };
  }

  private async rightsizeInstance(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string,
    workflowId: string
  ) {
    const ec2 = this.makeEC2Client(creds, params.region);
    const instanceId = params.resource_id;
    const targetType = params.target_instance_type;

    if (!targetType) throw new Error('action_params.target_instance_type is required');

    // Step 1: Stop
    log = this.appendLog(log, `Stopping ${instanceId} before resize...`);
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));

    // Step 2: Modify instance type
    // Wait a moment for the stop to propagate (production would use waiters)
    await new Promise((r) => setTimeout(r, 5000));
    log = this.appendLog(log, `Changing instance type to ${targetType}...`);
    await ec2.send(new ModifyInstanceAttributeCommand({
      InstanceId: instanceId,
      InstanceType: { Value: targetType },
    }));

    // Step 3: Start
    log = this.appendLog(log, `Starting ${instanceId} with new instance type...`);
    await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
    log = this.appendLog(log, `Instance ${instanceId} restarted as ${targetType}`);

    return { log };
  }

  private async deleteSnapshot(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string
  ) {
    const ec2 = this.makeEC2Client(creds, params.region);
    const snapshotId = params.resource_id;

    log = this.appendLog(log, `Deleting snapshot ${snapshotId}...`);
    await ec2.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId }));
    log = this.appendLog(log, `Snapshot ${snapshotId} deleted successfully`);

    return { log };
  }

  private async deleteUnattachedVolume(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string,
    workflowId: string
  ) {
    const ec2 = this.makeEC2Client(creds, params.region);
    const volumeId = params.resource_id;

    // Verify volume is truly unattached before deleting
    const descResult = await ec2.send(new DescribeVolumesCommand({ VolumeIds: [volumeId] }));
    const vol = descResult.Volumes?.[0];
    if (!vol) throw new Error(`Volume ${volumeId} not found`);
    if (vol.Attachments && vol.Attachments.length > 0) {
      throw new Error(`Volume ${volumeId} is attached — refusing to delete`);
    }

    // Create snapshot for rollback
    let rollbackSnapshotId: string | undefined;
    let rollbackAvailable = false;

    log = this.appendLog(log, `Creating pre-deletion snapshot of ${volumeId}...`);
    try {
      const snapResult = await ec2.send(new CreateSnapshotCommand({
        VolumeId: volumeId,
        Description: `DevControl pre-deletion snapshot — ${workflowId}`,
        TagSpecifications: [{
          ResourceType: 'snapshot',
          Tags: [
            { Key: 'CreatedBy', Value: 'DevControl-Remediation' },
            { Key: 'WorkflowId', Value: workflowId },
          ],
        }],
      }));
      rollbackSnapshotId = snapResult.SnapshotId;
      rollbackAvailable = true;
      log = this.appendLog(log, `Rollback snapshot created: ${rollbackSnapshotId}`);
    } catch (snapErr: any) {
      log = this.appendLog(log, `Warning: snapshot creation failed: ${snapErr.message}`);
    }

    log = this.appendLog(log, `Deleting volume ${volumeId}...`);
    await ec2.send(new DeleteVolumeCommand({ VolumeId: volumeId }));
    log = this.appendLog(log, `Volume ${volumeId} deleted successfully`);

    return { log, rollbackSnapshotId, rollbackAvailable };
  }

  private async enableS3Lifecycle(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string
  ) {
    const s3 = this.makeS3Client(creds, params.region);
    const bucket = params.resource_id;

    log = this.appendLog(log, `Applying lifecycle policy to bucket ${bucket}...`);
    await s3.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [{
          ID: 'devcontrol-cost-optimization',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          Transitions: [
            { Days: 90, StorageClass: 'GLACIER' },
          ],
          Expiration: { Days: 365 },
        }],
      },
    }));
    log = this.appendLog(log, `Lifecycle policy applied: Glacier transition at 90 days, expiration at 365 days`);

    return { log };
  }

  private async downgradeRDSInstance(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string
  ) {
    const rds = this.makeRDSClient(creds, params.region);
    const dbIdentifier = params.resource_id;
    const targetClass = params.target_instance_class;

    if (!targetClass) throw new Error('action_params.target_instance_class is required');

    log = this.appendLog(log, `Modifying RDS instance ${dbIdentifier} to ${targetClass}...`);
    await rds.send(new ModifyDBInstanceCommand({
      DBInstanceIdentifier: dbIdentifier,
      DBInstanceClass: targetClass,
      ApplyImmediately: false, // Apply during maintenance window
    }));
    log = this.appendLog(
      log,
      `RDS modification queued for ${dbIdentifier} → ${targetClass} (applies at next maintenance window)`
    );

    return { log };
  }

  private async deleteUnusedElasticIP(
    creds: Awaited<ReturnType<typeof this.getAWSCredentials>>,
    params: Record<string, any>,
    log: string
  ) {
    const ec2 = this.makeEC2Client(creds, params.region);
    const allocationId = params.resource_id;

    log = this.appendLog(log, `Releasing Elastic IP allocation ${allocationId}...`);
    await ec2.send(new ReleaseAddressCommand({ AllocationId: allocationId }));
    log = this.appendLog(log, `Elastic IP ${allocationId} released successfully`);

    return { log };
  }
}
