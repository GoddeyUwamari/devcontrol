/**
 * A database fixture for the evidence suites (not a test file).
 *
 * Two synthetic organizations, each with the data every evidence provider
 * reads, seeded by the superuser. Queries can run as either:
 *   - a throwaway NOSUPERUSER NOBYPASSRLS role (the category of role
 *     production's application user is), through a pool whose query() follows
 *     the request context exactly as config/database.ts's pool does, with
 *     installTenantTagReset() hygiene: RLS and explicit predicates together;
 *   - the table owner (the superuser), which RLS does not restrict: only the
 *     explicit organization predicates isolate tenants.
 * Everything is clearly fixture data: names start with "fixture-".
 */
import { Pool, PoolClient } from 'pg';
import { installTenantTagReset, requestContext } from '../../../../config/database';
import { ensureSharedFixtureTable } from '../../../../routes/__tests__/shared-fixture-tables';

export function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/** A pool that behaves like production's: query() runs on the request's client when there is one. */
export function requestAwarePool(base: Pool): Pool {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (...args: unknown[]) => {
          const client = requestContext.getStore();
          return ((client ?? target).query as (...a: unknown[]) => unknown)(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export interface OrgSeed {
  id: string;
  label: string;
  /** The 12-digit account id of the org's aws_accounts row (fixture placeholder digits). */
  accountId: string;
  resourceDbIds: string[];
  markers: string[];
}

export class EvidenceDb {
  readonly suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  readonly role = `tenant_reset_test_${this.suffix}`;
  readonly admin = new Pool(dbConfig());
  rolePool!: Pool;
  roleApp!: Pool;
  ownerPool!: Pool;
  ownerApp!: Pool;
  private orgIds: string[] = [];
  private accountIds: string[] = [];

  async setUp(): Promise<void> {
    await ensureSharedFixtureTable(this.admin, 'aws_accounts');
    await this.admin.query(`CREATE ROLE ${this.role} NOSUPERUSER NOBYPASSRLS`);
    await this.admin.query(`GRANT USAGE ON SCHEMA public TO ${this.role}`);
    await this.admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${this.role}`);
    await this.admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${this.role}`);
    this.rolePool = installTenantTagReset(new Pool({ ...dbConfig(), max: 6, options: `-c role=${this.role}` }));
    this.roleApp = requestAwarePool(this.rolePool);
    this.ownerPool = installTenantTagReset(new Pool({ ...dbConfig(), max: 6 }));
    this.ownerApp = requestAwarePool(this.ownerPool);
  }

  async tearDown(): Promise<void> {
    await this.rolePool?.end();
    await this.ownerPool?.end();
    if (this.accountIds.length > 0) await this.admin.query('DELETE FROM aws_accounts WHERE account_id = ANY($1)', [this.accountIds]);
    if (this.orgIds.length > 0) await this.admin.query('DELETE FROM organizations WHERE id = ANY($1)', [this.orgIds]);
    await this.admin.query(`DROP OWNED BY ${this.role}`);
    await this.admin.query(`DROP ROLE IF EXISTS ${this.role}`);
    await this.admin.end();
  }

  /** Runs fn inside a request whose connection is tagged for orgId, as authenticate does. */
  async asRequest<T>(pool: Pool, orgId: string, fn: () => Promise<T>): Promise<T> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      return await requestContext.run(client, fn);
    } finally {
      client.release();
    }
  }

  /**
   * One organization with: a connected account and its region list, a
   * completed discovery run, resources (one EC2 with a configuration-check
   * finding), account security findings (one accepted risk), an idle-instance
   * cost finding with CPU evidence, a custom framework scan, telemetry
   * collection rows, and deployments. `count` scales how many of each it has,
   * so two organizations' figures differ.
   */
  async seedOrg(label: string, count: number, accountDigit: string): Promise<OrgSeed> {
    const s = `${label}-${this.suffix}`;
    const markers: string[] = [];
    const { rows } = await this.admin.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
      [`Evidence ${s}`, `evidence-${s}`]
    );
    const id = rows[0].id as string;
    this.orgIds.push(id);
    const accountId = accountDigit.repeat(12);
    this.accountIds.push(accountId);

    await this.admin.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
       VALUES ($1, $2, $3, 'fixture-external-id', 'us-east-1', NOW(), 'active')`,
      [id, `arn:aws:iam::${accountId}:role/fixture-devcontrol`, accountId]
    );
    // One statement, so both regions belong to the same (latest) region list.
    await this.admin.query(
      `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled, last_listed_at, last_scan_status, last_scan_finished_at, last_success_at)
       VALUES ($1, $2, 'us-east-1', true, NOW(), 'ok', NOW(), NOW()), ($1, $2, 'eu-west-1', true, NOW(), 'never_scanned', NULL, NULL)`,
      [id, accountId]
    );
    await this.admin.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, compliance_scan_completed)
       VALUES ($1, 'completed', NOW() - interval '5 minutes', NOW(), true)`,
      [id]
    );

    const resourceDbIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = `fixture-${label}-web-${i}`;
      markers.push(name);
      const issues = i === 0
        ? JSON.stringify([{ category: 'encryption', severity: 'high', issue: `fixture ${label} storage not encrypted` }])
        : '[]';
      const r = await this.admin.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, resource_name, region, status, estimated_monthly_cost, compliance_issues)
         VALUES ($1, $2, $3, 'ec2', $4, 'us-east-1', 'running', $5, $6::jsonb) RETURNING id`,
        [id, `arn:aws:ec2:us-east-1:${accountId}:instance/fixture-${label}-${i}-${this.suffix}`, `i-fixture${label}${i}`, name, 10 * (i + 1), issues]
      );
      resourceDbIds.push(r.rows[0].id);
      markers.push(`i-fixture${label}${i}`);
    }

    for (let i = 0; i < count; i++) {
      const title = `fixture ${label} security group open ${i}`;
      markers.push(title);
      await this.admin.query(
        `INSERT INTO account_security_findings (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, status, disposition)
         VALUES ($1, $2, 'networking', $3, $4, 'fixture recommendation', $5, 'active', $6)`,
        [id, `fixture-${label}-${i}-${this.suffix}`, i === 0 ? 'high' : 'critical', title, `sg-fixture${label}${i}`, i === 0 ? 'accepted_risk' : null]
      );
    }

    await this.admin.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, potential_savings, severity, status, aws_region, metadata)
       VALUES ($1, $2, $3, 'EC2', 'Idle EC2 Instance', $4, 'MEDIUM', 'ACTIVE', 'us-east-1', $5::jsonb)`,
      [id, `i-fixture${label}0`, `fixture-${label}-web-0`, 12.5 * count, JSON.stringify({
        price_source: 'list_table',
        average_cpu: 1.25 * count,
        days_analyzed: 7,
        cpu_evidence: { datapoints_observed: 160, datapoints_expected: 168, window_end: new Date().toISOString() },
        savings_basis: 'estimated: compute cost from DevControl\'s list-price table',
      })]
    );

    const fw = await this.admin.query(
      `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
      [id, `fixture-${label}-framework`]
    );
    markers.push(`fixture-${label}-framework`);
    await this.admin.query(
      `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status, resources_scanned, non_compliant_resources, high_issues, compliance_score, completed_at)
       VALUES ($1, $2, 'manual', 'completed', $3, $4, $4, 50, NOW())`,
      [id, fw.rows[0].id, count, count]
    );

    for (const dbId of resourceDbIds) {
      await this.admin.query(
        `INSERT INTO resource_telemetry_observations (organization_id, aws_account_id, region, resource_id, last_datapoint_at, last_successful_check_at)
         VALUES ($1, $2, 'us-east-1', $3, NOW(), NOW())`,
        [id, accountId, dbId]
      );
    }

    const svc = await this.admin.query(
      `INSERT INTO services (organization_id, name, template, owner) VALUES ($1, $2, 'fixture', 'fixture') RETURNING id`,
      [id, `fixture-${label}-service`]
    );
    for (let i = 0; i < count; i++) {
      await this.admin.query(
        `INSERT INTO deployments (organization_id, service_id, environment, aws_region, status, deployed_by, deployed_at)
         VALUES ($1, $2, 'production', 'us-east-1', $3, 'fixture', NOW() - make_interval(hours => $4))`,
        [id, svc.rows[0].id, i === 0 ? 'failed' : 'success', i + 1]
      );
    }

    // AWS Security Hub: a completed sync and `count` active findings.
    await this.admin.query(
      `INSERT INTO organization_security_hub_state (organization_id, capability_status, last_sync_status, last_sync_started_at, last_sync_completed_at)
       VALUES ($1, 'ENABLED', 'COMPLETED', NOW() - interval '10 minutes', NOW() - interval '5 minutes')`,
      [id]
    );
    for (let i = 0; i < count; i++) {
      const title = `fixture ${label} hub finding ${i}`;
      markers.push(title);
      await this.admin.query(
        `INSERT INTO security_hub_findings (organization_id, finding_id, product_arn, title, severity, compliance_status, security_hub_created_at, security_hub_updated_at)
         VALUES ($1, $2, 'arn:aws:securityhub:us-east-1::product/aws/securityhub', $3, 'high', 'FAILED', NOW(), NOW())`,
        [id, `fixture-${label}-hub-${i}-${this.suffix}`, title]
      );
    }

    // A finished framework evaluation run with one failed check per resource.
    const framework = `fixture-${label}`;
    markers.push(framework);
    // generation is an identity column: the database assigns it.
    const run = await this.admin.query(
      `INSERT INTO framework_evaluation_runs (organization_id, framework, applicability, applicability_reason_code, status, started_at, heartbeat_at, finished_at, evaluator_version, resources_in_scope, resources_persisted, resources_failed)
       VALUES ($1, $2, 'enabled', 'fixture_reason', 'complete', NOW() - interval '1 hour', NOW(), NOW() - interval '30 minutes', 'fixture-1', $3, $3, 0)
       RETURNING generation`,
      [id, framework, count]
    );
    const generation = run.rows[0].generation;
    for (const [i, dbId] of resourceDbIds.entries()) {
      await this.admin.query(
        `INSERT INTO compliance_check_evaluations (organization_id, resource_id, source_kind, source_key, check_key, evaluation_state, severity, evidence_basis, reason_code, run_generation, evaluator_version)
         VALUES ($1, $2, 'framework', $3, $4, 'failed', 'high', 'config', 'fixture_reason', $5, 'fixture-1')`,
        [id, dbId, framework, `fixture.check.${i}`, generation]
      );
    }

    // Daily posture-score history: `count + 1` snapshots.
    for (let d = 0; d <= count; d++) {
      await this.admin.query(
        `INSERT INTO risk_score_history (organization_id, snapshot_date, overall_score, grade, encryption_score, public_access_score, backup_score, compliance_score, resource_management_score)
         VALUES ($1, CURRENT_DATE - $2::int, $3, 'C', 70, 70, 70, 70, 70)`,
        [id, d, 60 + d]
      );
    }

    return { id, label, accountId, resourceDbIds, markers };
  }
}
