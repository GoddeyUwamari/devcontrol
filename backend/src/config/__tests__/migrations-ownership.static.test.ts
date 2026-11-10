/**
 * New tables (and every other schema object) come from database/migrations-admin/
 * only (AWS connect C-G, CG-Q4).
 *
 * Ordinary migrations in database/migrations/ run as the application role
 * devcontrol in production. Since 202611091300_harden_database_ownership.sql
 * that role has no CREATE on the database or schema public, and since
 * 202611101200_transfer_tenant_table_ownership.sql it owns none of the tenant
 * tables with row level security: an ordinary migration can no longer create,
 * alter or drop schema objects or change privileges. Worse, before C-G0 a
 * table it created was owned by devcontrol, which bypasses its own row level
 * security. So any DDL or GRANT/REVOKE in an ordinary migration fails this
 * test, except in the files below that predate the rule (already applied;
 * the checksum ledger forbids editing them).
 */
import * as fs from 'fs';
import * as path from 'path';

const ORDINARY_DIR = path.join(__dirname, '../../../../database/migrations');

/** Ordinary migrations that already contained DDL when the rule was introduced (2026-11-10). */
const GRANDFATHERED = [
  '001_create_platform_tables.sql', '002_create_cost_recommendations.sql', '003_create_alert_history.sql',
  '007_rename_services_professional.sql', '012_create_risk_score_history.sql', '013_create_scheduled_reports.sql',
  '014_create_compliance_frameworks.sql', '017_cost_optimizations.sql', '018_anomaly_detections.sql',
  '019_add_anomaly_unique_constraint.sql', '024_drop_security_scores.sql', '025_fix_onboarding_tracking_triggers_created_by.sql',
  '026_api_keys_org_scoping.sql', '027_webhook_endpoints_org_scoping.sql', '030_fix_tracking_trigger_uuid_type_mismatch.sql',
  '202608221112_create_custom_anomaly_rules.sql', '202608231400_create_organization_invitations.sql',
  '202608272013_create_generated_reports.sql', '202608311500_create_refunds.sql', '202608312200_create_stripe_webhook_events.sql',
  '202609051200_create_platform_staff.sql', '202609060900_create_cost_analysis_runs.sql', '202609121200_create_slo_definitions.sql',
  '202609122100_create_organization_optimization_rule_configs.sql', '202609141500_create_security_hub_foundation_tables.sql',
  '202609150900_add_security_hub_findings_related_requirements.sql', '202609180900_create_soc2_evidence_tables.sql',
  '202609181200_create_customer_evidence.sql', '202609281200_create_saml_request_ids.sql',
];

const DDL =
  /\b(?:(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|FUNCTION|PROCEDURE|TRIGGER|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|TYPE|SCHEMA|POLICY|EXTENSION|RULE|DOMAIN)\b|GRANT\s|REVOKE\s)/i;

/** The SQL with -- comments and block comments removed. */
const statements = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');

const files = fs.readdirSync(ORDINARY_DIR).filter((f) => f.endsWith('.sql'));

describe('ordinary migrations hold no schema DDL or privilege changes', () => {
  it('no ordinary migration outside the grandfathered list contains DDL or GRANT/REVOKE (put it in database/migrations-admin/)', () => {
    const offenders = files
      .filter((f) => !GRANDFATHERED.includes(f))
      .filter((f) => DDL.test(statements(fs.readFileSync(path.join(ORDINARY_DIR, f), 'utf8'))))
      .map((f) => `${f}: move to database/migrations-admin/ (runs as postgres); see its README`);
    expect(offenders).toEqual([]);
  });

  it('every grandfathered file exists and does contain DDL (the list never grows)', () => {
    expect(GRANDFATHERED.filter((f) => !files.includes(f))).toEqual([]);
    expect(GRANDFATHERED.filter((f) => !DDL.test(statements(fs.readFileSync(path.join(ORDINARY_DIR, f), 'utf8'))))).toEqual([]);
  });

  it('the rule catches the statements it is meant to catch, and ignores comments and data changes', () => {
    for (const sql of [
      'CREATE TABLE x (id int);', 'create index i on x (id);', 'ALTER TABLE refunds ADD COLUMN y int;', 'CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ $$ LANGUAGE sql;',
      'CREATE POLICY p ON x USING (true);', 'GRANT SELECT ON x TO devcontrol;', 'REVOKE ALL ON x FROM PUBLIC;', 'DROP TABLE x;',
    ]) {
      expect(DDL.test(statements(sql))).toBe(true);
    }
    for (const sql of ['-- CREATE TABLE x (id int);', '/* ALTER TABLE x */ UPDATE users SET is_active = false WHERE id = 1;', "INSERT INTO t VALUES ('create table');"]) {
      expect(DDL.test(statements(sql.replace(/'[^']*'/g, "''")))).toBe(false);
    }
  });
});
