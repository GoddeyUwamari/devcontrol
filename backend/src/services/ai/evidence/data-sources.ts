/**
 * The authoritative inventory of data DevControl holds (step1 §1.2, S1-S29),
 * and every database table's place in it.
 *
 * Each source is either covered by at least one evidence provider (by the
 * provider's dataSourceIds) or excluded with a reason. Every table created by
 * database/migrations*\/*.sql is listed under a source or in EXCLUDED_TABLES,
 * so a new table fails the completeness test (__tests__/completeness.test.ts)
 * until someone decides whether the AI may see it.
 */

export interface DataSource {
  id: string;
  name: string;
  /** Tables this source is stored in (none for live AWS reads and calculations). */
  tables: string[];
  /** Present when no provider covers the source, with the reason. */
  excluded?: string;
}

export const DATA_SOURCES: readonly DataSource[] = [
  { id: 'S1', name: 'Cloud spend month-to-date and by service (AWS Cost Explorer, cached)', tables: [] },
  { id: 'S2', name: 'Daily cost trend and the month-over-month comparison', tables: [] },
  { id: 'S3', name: 'Inventory list-price cost estimates', tables: ['aws_resources'] },
  { id: 'S4', name: 'Resource inventory and discovery runs', tables: ['aws_resources', 'resource_discovery_jobs'] },
  { id: 'S5', name: 'Account region list and per-region scan status', tables: ['aws_account_regions', 'aws_scan_leases'] },
  { id: 'S6', name: 'Cost findings: savings basis, lifecycle, customer decisions', tables: ['cost_recommendations', 'cost_finding_detections', 'cost_analysis_runs'] },
  { id: 'S7', name: 'Account security findings with dispositions', tables: ['account_security_findings'] },
  { id: 'S8', name: 'Configuration checks on discovered resources', tables: ['aws_resources'] },
  { id: 'S9', name: 'Custom compliance frameworks and their scans', tables: ['compliance_frameworks', 'compliance_framework_rules', 'compliance_scans', 'compliance_scan_findings'] },
  { id: 'S10', name: 'Framework evaluations (applicability, persisted)', tables: ['compliance_check_evaluations', 'framework_evaluation_runs', 'framework_evaluation_reconciliations'] },
  { id: 'S11', name: 'Top Risk (selected from S7)', tables: [] },
  { id: 'S12', name: 'AWS Security Hub state and findings', tables: ['organization_security_hub_state', 'security_hub_findings'] },
  { id: 'S13', name: 'CloudWatch alarms (live read, 60-second cache)', tables: [] },
  { id: 'S14', name: 'Telemetry collection: newest datapoint and last check per resource', tables: ['resource_telemetry_observations', 'observability_collection_scopes'] },
  { id: 'S15', name: 'Idle-instance CPU evidence (stored with the S6 finding)', tables: [] },
  {
    id: 'S16',
    name: 'Operational Health resource checks',
    // The evaluation tables exist (schema only, no writer yet); the provider reads the evaluator's cached result.
    tables: ['resource_health_evaluation_runs', 'resource_health_evaluation_results'],
  },
  { id: 'S17', name: 'Deployments and DORA metrics', tables: ['deployments'] },
  { id: 'S18', name: 'Security posture score and its daily history', tables: ['risk_score_history'] },
  { id: 'S19', name: 'System Intelligence composite score', tables: [] },
  { id: 'S20', name: 'Cost anomalies', tables: ['anomaly_detections'] },
  { id: 'S21', name: 'Alert history (Prometheus sync, no organization)', tables: ['alert_history'] },
  {
    id: 'S22',
    name: 'Remediation workflows and executions',
    tables: ['remediation_executions', 'remediation_step_claims'],
    excluded: 'actions, not evidence: what DevControl can do is the capability registry (AI truth PR 3)',
  },
  {
    id: 'S23',
    name: 'Services catalogue and dependencies',
    tables: ['services', 'service_dependencies'],
    excluded: 'a customer-authored catalogue with no PR 2 question; deployments (S17) join it for organization scope only',
  },
  {
    id: 'S24',
    name: 'SLOs',
    tables: ['slo_definitions'],
    excluded: 'an Enterprise feature with no plan entitlement key yet; deferred until it has one',
  },
  {
    id: 'S25',
    name: 'Cost forecast',
    tables: [],
    excluded: 'a projection with its own Forecast page and AI analysis; projections are not evidence of what happened',
  },
  { id: 'S26', name: 'Connected AWS account and connection state', tables: [] },
  {
    id: 'S27',
    name: 'SOC 2 evidence and customer evidence',
    tables: ['soc2_control_evaluations', 'soc2_evidence_observations', 'customer_evidence'],
    excluded: 'an Enterprise evidence product with customer-uploaded material; deferred until it has a plan entitlement key and an untrusted-text review',
  },
  {
    id: 'S28',
    name: 'Custom anomaly rules and optimization-rule settings',
    tables: ['custom_anomaly_rules', 'organization_optimization_rule_configs'],
    excluded: 'configuration, not evidence; the detectors that use it report through S6 and S20',
  },
  {
    id: 'S29',
    name: 'Audit logs',
    tables: ['audit_logs'],
    excluded: 'kept out of AI by design (who did what is not infrastructure evidence)',
  },
];

/** Tables that are not AI evidence by design, with why. */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  organizations: 'tenant record; its plan is read only through plan-entitlements.ts',
  users: 'identity',
  sessions: 'authentication',
  organization_memberships: 'identity and roles',
  organization_invitations: 'identity',
  platform_staff: 'internal staff access',
  role_permissions: 'authorization configuration',
  teams: 'workspace configuration',
  onboarding_progress: 'product onboarding state',
  organization_feature_flags: 'product configuration',
  stripe_webhook_events: 'billing integration',
  refunds: 'billing',
  saml_request_ids: 'authentication',
  job_leases: 'job coordination',
  analytics_events: 'product analytics',
  generated_reports: 'AI output, never AI input',
  scheduled_reports: 'report scheduling configuration',
  scheduled_report_executions: 'report scheduling',
  infrastructure_resources: 'legacy table, superseded by aws_resources',
  cost_optimizations: 'legacy table, superseded by cost_recommendations',
  services_backup_20251228: 'one-off migration backup',
  aws_org_external_ids: 'connection setup material, never evidence',
  aws_preserved_customer_decisions: 'decisions kept across a reconnect; they reach AI through S6 and S7 once restored',
};
