/**
 * OnboardingService
 * Manages onboarding progress tracking for organizations
 * Computes status from real data (services, deployments, AWS credentials)
 */

import { pool } from '../config/database';
import { PoolClient } from 'pg';

// Simple error class
class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

// =====================================================
// TYPES
// =====================================================

export interface OnboardingStage {
  id: string;
  name: string;
  title: string;
  description: string;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null; // User who completed this step
  order: number;
}

export interface OnboardingStatus {
  currentStage: string;
  progress: number; // 0-100
  completedStages: string[];
  stages: OnboardingStage[];
  isCompleted: boolean;
  isDismissed: boolean;
  dismissedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  nextStep: {
    action: string;
    cta: string;
    route?: string;
  } | null;
}

interface DataStatus {
  hasServices: boolean;
  hasDeployments: boolean;
  hasAwsConnected: boolean;
  servicesCount: number;
  deploymentsCount: number;
}

// =====================================================
// SERVICE CLASS
// =====================================================

export class OnboardingService {
  /**
   * Get or create onboarding status for organization
   * This is the main entry point - computes status from real data
   * Uses a dedicated client to ensure RLS context is set correctly
   */
  async getStatus(organizationId: string, userId: string): Promise<OnboardingStatus> {
    const client = await pool.connect();
    try {
      // Set RLS context for this client connection
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );

      // 1. Get or create onboarding_progress record
      let progress = await this.getProgressRecordWithClient(client, organizationId, userId);

      // 2. Compute actual completion from real data
      const dataStatus = await this.computeFromDataWithClient(client, organizationId);

      // 3. Update onboarding_progress if data changed
      progress = await this.syncProgressWithClient(client, progress, dataStatus);

      // 4. Build response with all stage details
      return this.buildStatus(progress, dataStatus);
    } catch (error) {
      console.error('Error getting onboarding status:', error);
      throw new AppError('Failed to get onboarding status', 500);
    } finally {
      client.release();
    }
  }

  /**
   * Get or create the onboarding_progress record
   */
  private async getProgressRecord(organizationId: string, userId: string) {
    return this.getProgressRecordWithClient(pool, organizationId, userId);
  }

  /**
   * Get or create the onboarding_progress record using a specific client
   */
  private async getProgressRecordWithClient(client: PoolClient | typeof pool, organizationId: string, userId: string) {
    const result = await client.query(
      `SELECT * FROM onboarding_progress WHERE organization_id = $1`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      // Create new record (shouldn't happen due to trigger, but just in case)
      const insert = await client.query(
        `INSERT INTO onboarding_progress (organization_id, user_id, current_stage)
         VALUES ($1, $2, 'welcome')
         RETURNING *`,
        [organizationId, userId]
      );
      return insert.rows[0];
    }

    return result.rows[0];
  }

  /**
   * Compute completion status from real data
   * This is the "source of truth" - what actually exists in the database
   */
  private async computeFromData(organizationId: string): Promise<DataStatus> {
    return this.computeFromDataWithClient(pool, organizationId);
  }

  /**
   * Compute completion status from real data using a specific client
   */
  private async computeFromDataWithClient(client: PoolClient | typeof pool, organizationId: string): Promise<DataStatus> {
    const [servicesCount, deploymentsCount, awsCredentials] = await Promise.all([
      this.getServicesCountWithClient(client, organizationId),
      this.getDeploymentsCountWithClient(client, organizationId),
      this.getAwsCredentialsWithClient(client, organizationId),
    ]);

    return {
      hasServices: servicesCount > 0,
      hasDeployments: deploymentsCount > 0,
      hasAwsConnected: !!awsCredentials,
      servicesCount,
      deploymentsCount,
    };
  }

  /**
   * Sync onboarding_progress with actual data
   * Auto-completes steps based on what exists
   */
  private async syncProgress(progress: any, dataStatus: DataStatus) {
    return this.syncProgressWithClient(pool, progress, dataStatus);
  }

  /**
   * Sync onboarding_progress with actual data using a specific client
   */
  private async syncProgressWithClient(client: PoolClient | typeof pool, progress: any, dataStatus: DataStatus) {
    const setters: string[] = [];
    const values: any[] = [progress.organization_id];
    let paramIndex = 2;

    // Auto-complete stages based on real data
    if (dataStatus.hasServices && !progress.first_service_created_at) {
      setters.push(`first_service_created_at = $${paramIndex++}`);
      values.push(new Date());
    }

    if (dataStatus.hasDeployments && !progress.first_deployment_created_at) {
      setters.push(`first_deployment_created_at = $${paramIndex++}`);
      values.push(new Date());
    }

    if (dataStatus.hasAwsConnected && !progress.aws_connected_at) {
      setters.push(`aws_connected_at = $${paramIndex++}`);
      values.push(new Date());
    }

    // Update current_stage based on progress
    const newStage = this.calculateCurrentStage(progress, dataStatus);
    if (newStage !== progress.current_stage) {
      setters.push(`current_stage = $${paramIndex++}`);
      values.push(newStage);
    }

    // Update completed_stages array
    const completedStages = this.getCompletedStages(progress, dataStatus);
    setters.push(`completed_stages = $${paramIndex++}`);
    values.push(JSON.stringify(completedStages));

    // Check if fully completed
    if (completedStages.length === 5 && !progress.completed_at) {
      setters.push(`completed_at = $${paramIndex++}`);
      values.push(new Date());
    }

    // Apply updates if any
    if (setters.length > 0) {
      setters.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE onboarding_progress
         SET ${setters.join(', ')}
         WHERE organization_id = $1
         RETURNING *`,
        values
      );

      return result.rows[0];
    }

    return progress;
  }

  /**
   * Calculate current stage based on what's completed
   */
  private calculateCurrentStage(progress: any, dataStatus: DataStatus): string {
    if (progress.dismissed_at) return 'completed';
    if (!progress.welcome_completed_at) return 'welcome';
    if (!dataStatus.hasServices) return 'create_service';
    if (!dataStatus.hasDeployments) return 'log_deployment';
    if (!dataStatus.hasAwsConnected) return 'connect_aws';
    if (!progress.resources_discovered_at) return 'discover_resources';
    return 'completed';
  }

  /**
   * Get array of completed stage IDs
   */
  private getCompletedStages(progress: any, dataStatus: DataStatus): string[] {
    const stages = [];
    if (progress.welcome_completed_at) stages.push('welcome');
    if (dataStatus.hasServices) stages.push('create_service');
    if (dataStatus.hasDeployments) stages.push('log_deployment');
    if (dataStatus.hasAwsConnected) stages.push('connect_aws');
    if (progress.resources_discovered_at) stages.push('discover_resources');
    return stages;
  }

  /**
   * Build complete OnboardingStatus response
   */
  private buildStatus(progress: any, dataStatus: DataStatus): OnboardingStatus {
    const stages: OnboardingStage[] = [
      {
        id: 'welcome',
        name: 'Welcome',
        title: 'Get Started',
        description: 'Learn about DevControl',
        completed: !!progress.welcome_completed_at,
        completedAt: progress.welcome_completed_at,
        completedBy: null, // Could track this if needed
        order: 1,
      },
      {
        id: 'create_service',
        name: 'Create Service',
        title: 'Add Your First Service',
        description: 'Register a microservice to track',
        completed: dataStatus.hasServices,
        completedAt: progress.first_service_created_at,
        completedBy: null,
        order: 2,
      },
      {
        id: 'log_deployment',
        name: 'Log Deployment',
        title: 'Record a Deployment',
        description: 'Track when code ships to production',
        completed: dataStatus.hasDeployments,
        completedAt: progress.first_deployment_created_at,
        completedBy: null,
        order: 3,
      },
      {
        id: 'connect_aws',
        name: 'Connect AWS',
        title: 'Sync AWS Costs',
        description: 'See real-time infrastructure spend',
        completed: dataStatus.hasAwsConnected,
        completedAt: progress.aws_connected_at,
        completedBy: null,
        order: 4,
      },
      {
        id: 'discover_resources',
        name: 'Discover Resources',
        title: 'Scan AWS Resources',
        description: 'Auto-discover EC2, RDS, S3, and more',
        completed: !!progress.resources_discovered_at,
        completedAt: progress.resources_discovered_at,
        completedBy: null,
        order: 5,
      },
    ];

    const completedCount = stages.filter(s => s.completed).length;
    const progressPercent = Math.round((completedCount / stages.length) * 100);
    const isCompleted = !!progress.completed_at || progressPercent === 100;
    const isDismissed = !!progress.dismissed_at;

    return {
      currentStage: progress.current_stage,
      progress: progressPercent,
      completedStages: stages.filter(s => s.completed).map(s => s.id),
      stages,
      isCompleted,
      isDismissed,
      dismissedAt: progress.dismissed_at,
      startedAt: progress.started_at,
      completedAt: progress.completed_at,
      nextStep: this.getNextStep(progress.current_stage),
    };
  }

  /**
   * Get the next action/CTA for current stage
   */
  private getNextStep(currentStage: string) {
    const nextSteps: Record<string, any> = {
      welcome: {
        action: 'dismiss_welcome',
        cta: 'Get Started',
        route: '/dashboard',
      },
      create_service: {
        action: 'open_create_service_modal',
        cta: 'Create First Service',
      },
      log_deployment: {
        action: 'navigate_to_deployments',
        cta: 'Log First Deployment',
        route: '/deployments',
      },
      connect_aws: {
        action: 'navigate_to_aws_settings',
        cta: 'Connect AWS Account',
        route: '/settings/organization?tab=aws',
      },
      discover_resources: {
        action: 'trigger_aws_discovery',
        cta: 'Discover Resources',
        route: '/aws-resources',
      },
    };

    return nextSteps[currentStage] || null;
  }

  // =====================================================
  // PUBLIC METHODS - Called by API routes
  // =====================================================

  /**
   * Mark a specific step as complete
   * Only for manual steps (welcome, discover_resources)
   * Other steps auto-complete from data
   */
  async markStepComplete(organizationId: string, step: string): Promise<void> {
    const fieldMap: Record<string, string> = {
      welcome: 'welcome_completed_at',
      discover_resources: 'resources_discovered_at',
    };

    const field = fieldMap[step];
    if (!field) {
      // Step auto-completes from data, nothing to do
      return;
    }

    await pool.query(
      `UPDATE onboarding_progress
       SET ${field} = NOW(), updated_at = NOW()
       WHERE organization_id = $1 AND ${field} IS NULL`,
      [organizationId]
    );
  }

  /**
   * Dismiss onboarding (user clicks "Skip" or "Dismiss")
   */
  async dismiss(organizationId: string): Promise<void> {
    await pool.query(
      `UPDATE onboarding_progress
       SET dismissed_at = NOW(),
           current_stage = 'completed',
           updated_at = NOW()
       WHERE organization_id = $1`,
      [organizationId]
    );
  }

  /**
   * Re-enable onboarding if user dismissed it
   */
  async reEnable(organizationId: string): Promise<void> {
    await pool.query(
      `UPDATE onboarding_progress
       SET dismissed_at = NULL,
           updated_at = NOW()
       WHERE organization_id = $1`,
      [organizationId]
    );
  }

  // =====================================================
  // HELPER QUERIES
  // =====================================================

  private async getServicesCount(organizationId: string): Promise<number> {
    return this.getServicesCountWithClient(pool, organizationId);
  }

  private async getServicesCountWithClient(client: PoolClient | typeof pool, organizationId: string): Promise<number> {
    const result = await client.query(
      `SELECT COUNT(*) as count FROM services WHERE organization_id = $1`,
      [organizationId]
    );
    return parseInt(result.rows[0].count);
  }

  private async getDeploymentsCount(organizationId: string): Promise<number> {
    return this.getDeploymentsCountWithClient(pool, organizationId);
  }

  private async getDeploymentsCountWithClient(client: PoolClient | typeof pool, organizationId: string): Promise<number> {
    const result = await client.query(
      `SELECT COUNT(*) as count FROM deployments WHERE organization_id = $1`,
      [organizationId]
    );
    return parseInt(result.rows[0].count);
  }

  private async getAwsCredentials(organizationId: string): Promise<any> {
    return this.getAwsCredentialsWithClient(pool, organizationId);
  }

  private async getAwsCredentialsWithClient(client: PoolClient | typeof pool, organizationId: string): Promise<any> {
    const result = await client.query(
      `SELECT aws_credentials_encrypted
       FROM organizations
       WHERE id = $1
         AND aws_credentials_encrypted IS NOT NULL
         AND aws_credentials_encrypted != ''
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0];
  }

  // =====================================================
  // ANALYTICS HELPERS
  // =====================================================

  /**
   * Get onboarding metrics for all organizations
   * Used for analytics dashboard
   */
  async getMetrics() {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_orgs,
        COUNT(*) FILTER (WHERE current_stage = 'completed') as completed_orgs,
        COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL) as dismissed_orgs,
        ROUND(AVG(jsonb_array_length(completed_stages))::numeric, 2) as avg_stages_completed,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE current_stage = 'completed') / COUNT(*),
          2
        ) as completion_rate_pct,
        ROUND(
          EXTRACT(EPOCH FROM AVG(completed_at - started_at)) / 3600,
          2
        ) as avg_hours_to_complete
      FROM onboarding_progress
      WHERE completed_at IS NOT NULL
    `);

    return result.rows[0];
  }

  /**
   * Get funnel conversion rates
   */
  async getFunnelMetrics() {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_started,
        COUNT(*) FILTER (WHERE welcome_completed_at IS NOT NULL) as completed_welcome,
        COUNT(*) FILTER (WHERE first_service_created_at IS NOT NULL) as completed_service,
        COUNT(*) FILTER (WHERE first_deployment_created_at IS NOT NULL) as completed_deployment,
        COUNT(*) FILTER (WHERE aws_connected_at IS NOT NULL) as completed_aws,
        COUNT(*) FILTER (WHERE resources_discovered_at IS NOT NULL) as completed_discovery,
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL) as completed_all
      FROM onboarding_progress
    `);

    const data = result.rows[0];
    const total = parseInt(data.total_started);

    return {
      total_started: total,
      funnel: [
        { stage: 'welcome', count: parseInt(data.completed_welcome), rate: Math.round(100 * data.completed_welcome / total) },
        { stage: 'create_service', count: parseInt(data.completed_service), rate: Math.round(100 * data.completed_service / total) },
        { stage: 'log_deployment', count: parseInt(data.completed_deployment), rate: Math.round(100 * data.completed_deployment / total) },
        { stage: 'connect_aws', count: parseInt(data.completed_aws), rate: Math.round(100 * data.completed_aws / total) },
        { stage: 'discover_resources', count: parseInt(data.completed_discovery), rate: Math.round(100 * data.completed_discovery / total) },
        { stage: 'completed', count: parseInt(data.completed_all), rate: Math.round(100 * data.completed_all / total) },
      ],
    };
  }
}

// Export singleton instance
export const onboardingService = new OnboardingService();
