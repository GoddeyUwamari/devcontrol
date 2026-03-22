/**
 * Remediation Service
 * Executes approved remediation actions against real AWS resources.
 *
 * IMPORTANT: This service only runs after explicit human approval.
 * No AWS resource is ever touched without status === 'approved'.
 */

import { Pool } from 'pg';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
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

export class RemediationService {
  constructor(private pool: Pool) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getWorkflow(id: string): Promise<WorkflowRow> {
    const result = await this.pool.query(
      'SELECT * FROM remediation_workflows WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) throw new Error(`Workflow ${id} not found`);
    return result.rows[0];
  }

  private async updateStatus(
    workflowId: string,
    newStatus: WorkflowStatus,
    extras: Record<string, any> = {},
    auditNote?: string,
    changedBy?: string,
    ipAddress?: string
  ): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    const setFields = ['status = $1', 'updated_at = NOW()'];
    const values: any[] = [newStatus];
    let idx = 2;

    for (const [key, val] of Object.entries(extras)) {
      setFields.push(`${key} = $${idx++}`);
      values.push(val);
    }
    values.push(workflowId);

    await this.pool.query(
      `UPDATE remediation_workflows SET ${setFields.join(', ')} WHERE id = $${idx}`,
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
   * Assume the org's AWS role and return temporary credentials.
   * Validates the role is still assumable before execution.
   */
  private async getAWSCredentials(organizationId: string): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    region: string;
  }> {
    // Fetch first active AWS account for this org
    // (In production, aws_accounts would be scoped per org)
    const result = await this.pool.query(
      `SELECT role_arn, account_id FROM aws_accounts WHERE status = 'active' LIMIT 1`
    );

    if (result.rows.length === 0) {
      throw new Error('No active AWS account configured. Connect an AWS account first.');
    }

    const { role_arn: roleArn } = result.rows[0];
    const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';

    const sts = new STSClient({ region });
    const assumed = await sts.send(new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `devcontrol-remediation-${Date.now()}`,
      DurationSeconds: 900, // 15 minutes — enough for any single action
    }));

    const creds = assumed.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      throw new Error('Failed to obtain temporary AWS credentials');
    }

    return {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
      region,
    };
  }

  private makeEC2Client(creds: Awaited<ReturnType<typeof this.getAWSCredentials>>, region?: string) {
    return new EC2Client({
      region: region || creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  private makeS3Client(creds: Awaited<ReturnType<typeof this.getAWSCredentials>>) {
    return new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  private makeRDSClient(creds: Awaited<ReturnType<typeof this.getAWSCredentials>>, region?: string) {
    return new RDSClient({
      region: region || creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
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
        JSON.stringify(data.actionParams),
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
    const workflow = await this.getWorkflow(workflowId);
    if (workflow.organization_id !== organizationId) throw new Error('Workflow not found');
    if (workflow.status !== 'pending_approval') throw new Error(`Cannot approve workflow in status: ${workflow.status}`);

    await this.updateStatus(
      workflowId,
      'approved',
      { approved_by: approvedBy, approved_at: new Date() },
      'Workflow approved',
      approvedBy,
      ipAddress
    );

    return this.getWorkflow(workflowId);
  }

  async reject(
    workflowId: string,
    organizationId: string,
    rejectedBy: string,
    reason: string,
    ipAddress?: string
  ) {
    const workflow = await this.getWorkflow(workflowId);
    if (workflow.organization_id !== organizationId) throw new Error('Workflow not found');
    if (workflow.status !== 'pending_approval') throw new Error(`Cannot reject workflow in status: ${workflow.status}`);

    await this.updateStatus(
      workflowId,
      'rejected',
      { rejected_at: new Date(), rejection_reason: reason },
      `Rejected: ${reason}`,
      rejectedBy,
      ipAddress
    );

    return this.getWorkflow(workflowId);
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute(workflowId: string, organizationId: string, executedBy: string, ipAddress?: string) {
    const workflow = await this.getWorkflow(workflowId);
    if (workflow.organization_id !== organizationId) throw new Error('Workflow not found');
    if (workflow.status !== 'approved') {
      throw new Error(`Workflow must be approved before executing. Current status: ${workflow.status}`);
    }

    // Mark as executing
    await this.updateStatus(
      workflowId,
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
      const creds = await this.getAWSCredentials(organizationId);
      const params = workflow.action_params as Record<string, any>;
      const region = params.region || creds.region;

      log = this.appendLog(log, `AWS credentials obtained via STS AssumeRole`);

      switch (workflow.action_type) {
        case 'stop_instance':
          ({ log, rollbackSnapshotId, rollbackAvailable } =
            await this.stopInstance(creds, params, log, workflowId));
          break;
        case 'rightsize_instance':
          ({ log } = await this.rightsizeInstance(creds, params, log, workflowId));
          break;
        case 'delete_snapshot':
          ({ log } = await this.deleteSnapshot(creds, params, log));
          break;
        case 'delete_unattached_volume':
          ({ log, rollbackSnapshotId, rollbackAvailable } =
            await this.deleteUnattachedVolume(creds, params, log, workflowId));
          break;
        case 'enable_s3_lifecycle':
          ({ log } = await this.enableS3Lifecycle(creds, params, log));
          break;
        case 'downgrade_rds_instance':
          ({ log } = await this.downgradeRDSInstance(creds, params, log));
          break;
        case 'delete_unused_elasticip':
          ({ log } = await this.deleteUnusedElasticIP(creds, params, log));
          break;
        default:
          throw new Error(`Unknown action type: ${workflow.action_type}`);
      }

      log = this.appendLog(log, 'Execution completed successfully');

      await this.updateStatus(
        workflowId,
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
        'failed',
        { execution_log: log },
        `Execution failed: ${err.message}`,
        executedBy,
        ipAddress
      );
      throw err;
    }

    return this.getWorkflow(workflowId);
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  async rollback(workflowId: string, organizationId: string, executedBy: string, ipAddress?: string) {
    const workflow = await this.getWorkflow(workflowId);
    if (workflow.organization_id !== organizationId) throw new Error('Workflow not found');
    if (!workflow.rollback_available) throw new Error('Rollback is not available for this workflow');
    if (workflow.status !== 'completed') throw new Error('Can only rollback completed workflows');

    const creds = await this.getAWSCredentials(organizationId);
    const params = workflow.action_params as Record<string, any>;
    let log = this.appendLog(workflow.execution_log, `Rollback initiated by ${executedBy}`);

    try {
      if (workflow.action_type === 'stop_instance') {
        // Rollback: restart the instance
        const ec2 = this.makeEC2Client(creds, params.region);
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
        'rolled_back',
        { execution_log: log },
        'Rollback completed',
        executedBy,
        ipAddress
      );
    } catch (err: any) {
      log = this.appendLog(log, `Rollback ERROR: ${err.message}`);
      await this.pool.query(
        'UPDATE remediation_workflows SET execution_log = $1, updated_at = NOW() WHERE id = $2',
        [log, workflowId]
      );
      throw err;
    }

    return this.getWorkflow(workflowId);
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
    const s3 = this.makeS3Client(creds);
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
