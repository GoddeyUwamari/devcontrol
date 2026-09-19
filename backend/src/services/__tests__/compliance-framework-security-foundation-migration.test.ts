/**
 * Live-Postgres coverage for
 * database/migrations-admin/202609191430_compliance_framework_security_foundation.sql
 * -- the Phase 1 security-foundation migration for Custom Compliance
 * Frameworks V1. Executes the actual migration file's SQL (read from disk,
 * not reimplemented) against a disposable fixture shaped like the real
 * production tables, in an isolated schema. Same isolated-schema technique
 * as anomaly-rules-rls-migration.test.ts and migrate-runner.test.ts.
 *
 * Unlike that precedent (and every other "RLS test" in this codebase), this
 * file does not stop at proving the migration's policies *exist* in
 * pg_policies -- the connecting role for every test in this suite (and in
 * CI/local dev generally, per database/migrations-admin/README.md) is
 * `postgres`, a superuser, and PostgreSQL RLS never restricts a superuser
 * regardless of policies or FORCE ROW LEVEL SECURITY. So the "organization
 * isolation" describe block below creates its own throwaway, genuinely
 * non-superuser, non-owner, NOBYPASSRLS role for the duration of each test
 * and `SET ROLE`s into it before every RLS-sensitive query -- the same
 * technique a superuser session uses to legitimately test as a lesser role,
 * requiring no new credential or production access. This is what actually
 * proves cross-tenant denial by execution, not just by policy metadata.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_SQL = fs.readFileSync(
  path.join(
    __dirname,
    '../../../../database/migrations-admin/202609191430_compliance_framework_security_foundation.sql'
  ),
  'utf8'
);

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

async function newIsolatedClient(schemaName: string): Promise<Client> {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.end();

  const client = new Client(dbConfig());
  await client.connect();
  // Deliberately schema-only, no ", public" fallback: this suite's fixture
  // creates its own organizations/compliance_* tables inside the isolated
  // schema, and every function this migration relies on (gen_random_uuid(),
  // etc.) lives in pg_catalog, which is always on the search_path regardless.
  // A "public" fallback would risk this schema's checks (especially "does
  // the table exist yet") silently resolving against real tables of the
  // same name in the actual public schema -- exactly the kind of
  // cross-environment contamination this isolated-schema technique exists
  // to avoid.
  await client.query(`SET search_path TO ${schemaName}`);
  return client;
}

async function dropSchema(schemaName: string) {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
}

/** Mirrors 014_create_compliance_frameworks.sql's exact production shape. */
async function createRealisticFixture(client: Client) {
  await client.query(`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE compliance_frameworks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      framework_type VARCHAR(50) NOT NULL CHECK (framework_type IN ('built_in', 'custom')),
      enabled BOOLEAN DEFAULT true,
      is_default BOOLEAN DEFAULT false,
      standard_name VARCHAR(100),
      version VARCHAR(50),
      created_by UUID,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT unique_org_framework_name UNIQUE (organization_id, name)
    )
  `);
  await client.query(`
    CREATE TABLE compliance_framework_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      framework_id UUID NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
      rule_code VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      category VARCHAR(50) NOT NULL CHECK (category IN ('encryption', 'backups', 'public_access', 'tagging', 'iam', 'networking', 'custom')),
      rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('property_check', 'tag_required', 'tag_pattern', 'metadata_check', 'relationship_check', 'custom_script')),
      conditions JSONB NOT NULL,
      resource_types TEXT[] DEFAULT ARRAY[]::TEXT[],
      recommendation TEXT NOT NULL,
      remediation_url TEXT,
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT unique_framework_rule_code UNIQUE (framework_id, rule_code)
    )
  `);
  await client.query(`
    CREATE TABLE compliance_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      framework_id UUID NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
      scan_type VARCHAR(50) NOT NULL CHECK (scan_type IN ('manual', 'scheduled', 'continuous')),
      status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      resource_filters JSONB DEFAULT '{}'::jsonb,
      total_resources INTEGER DEFAULT 0,
      compliant_resources INTEGER DEFAULT 0,
      non_compliant_resources INTEGER DEFAULT 0,
      resources_scanned INTEGER DEFAULT 0,
      critical_issues INTEGER DEFAULT 0,
      high_issues INTEGER DEFAULT 0,
      medium_issues INTEGER DEFAULT 0,
      low_issues INTEGER DEFAULT 0,
      compliance_score DECIMAL(5,2),
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      duration_seconds INTEGER,
      error_message TEXT,
      results JSONB,
      triggered_by UUID,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE compliance_scan_findings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scan_id UUID NOT NULL REFERENCES compliance_scans(id) ON DELETE CASCADE,
      rule_id UUID NOT NULL REFERENCES compliance_framework_rules(id) ON DELETE CASCADE,
      resource_id VARCHAR(255) NOT NULL,
      resource_arn TEXT NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      resource_name VARCHAR(255),
      status VARCHAR(20) NOT NULL CHECK (status IN ('pass', 'fail', 'error', 'skip')),
      severity VARCHAR(20) NOT NULL,
      category VARCHAR(50) NOT NULL,
      issue TEXT,
      recommendation TEXT,
      remediated BOOLEAN DEFAULT false,
      remediated_at TIMESTAMP,
      remediated_by UUID,
      remediation_notes TEXT,
      detected_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT idx_scan_resource UNIQUE (scan_id, resource_id, rule_id)
    )
  `);
}

async function insertOrg(client: Client, name: string): Promise<string> {
  const { rows } = await client.query(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [name]);
  return rows[0].id as string;
}

async function insertFramework(client: Client, orgId: string, name: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
    [orgId, name]
  );
  return rows[0].id as string;
}

describe('202609191430_compliance_framework_security_foundation.sql', () => {
  let schemaCounter = 0;
  const schemas: string[] = [];

  function nextSchema() {
    const name = `compliance_sec_mig_test_${Date.now()}_${schemaCounter++}`;
    schemas.push(name);
    return name;
  }

  afterAll(async () => {
    for (const s of schemas) await dropSchema(s);
  });

  it('(1) adds organization_id (NOT NULL, backfilled correctly) to both child tables', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      const orgA = await insertOrg(client, 'Org A');
      const fwId = await insertFramework(client, orgA, 'Framework A');
      const { rows: ruleRows } = await client.query(
        `INSERT INTO compliance_framework_rules (framework_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
         VALUES ($1, 'CUSTOM-001', 'Encryption required', 'high', 'encryption', 'property_check', '{"property":"is_encrypted","operator":"equals","value":true}', 'Enable encryption')
         RETURNING id`,
        [fwId]
      );
      const { rows: scanRows } = await client.query(
        `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status, compliance_score, critical_issues, high_issues)
         VALUES ($1, $2, 'manual', 'completed', 91, 0, 1) RETURNING id`,
        [orgA, fwId]
      );
      await client.query(
        `INSERT INTO compliance_scan_findings (scan_id, rule_id, resource_id, resource_arn, resource_type, status, severity, category)
         VALUES ($1, $2, 'res-1', 'arn:aws:s3:::bucket', 's3', 'fail', 'high', 'encryption')`,
        [scanRows[0].id, ruleRows[0].id]
      );

      await client.query(MIGRATION_SQL);

      const { rows: ruleOrg } = await client.query(
        `SELECT organization_id FROM compliance_framework_rules WHERE id = $1`,
        [ruleRows[0].id]
      );
      expect(ruleOrg[0].organization_id).toBe(orgA);

      const { rows: findingOrg } = await client.query(
        `SELECT organization_id FROM compliance_scan_findings WHERE scan_id = $1`,
        [scanRows[0].id]
      );
      expect(findingOrg[0].organization_id).toBe(orgA);

      const { rows: cols } = await client.query(
        `SELECT table_name, is_nullable FROM information_schema.columns
         WHERE table_schema = $1 AND column_name = 'organization_id'
         AND table_name IN ('compliance_framework_rules', 'compliance_scan_findings')`,
        [schemaName]
      );
      expect(cols).toHaveLength(2);
      for (const row of cols) expect(row.is_nullable).toBe('NO');
    } finally {
      await client.end();
    }
  });

  it('(2) enables RLS and creates both policies on all four tables', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      await client.query(MIGRATION_SQL);

      const { rows: rls } = await client.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname LIKE 'compliance_%' AND c.relkind = 'r'
         ORDER BY relname`,
        [schemaName]
      );
      expect(rls).toHaveLength(4);
      for (const row of rls) {
        expect(row.relrowsecurity).toBe(true);
        // FORCE ROW LEVEL SECURITY is deliberately NOT set -- see the
        // migration's own header comment. It only matters for restricting
        // the table owner's own queries, and the application never connects
        // as the owner (devcontrol is confirmed non-owner in production).
        expect(row.relforcerowsecurity).toBe(false);
      }

      const { rows: policies } = await client.query(
        `SELECT tablename, policyname FROM pg_policies WHERE schemaname = $1 ORDER BY tablename, policyname`,
        [schemaName]
      );
      expect(policies.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([
        'compliance_framework_rules.compliance_framework_rules_insert_policy',
        'compliance_framework_rules.compliance_framework_rules_isolation_policy',
        'compliance_frameworks.compliance_frameworks_insert_policy',
        'compliance_frameworks.compliance_frameworks_isolation_policy',
        'compliance_scan_findings.compliance_scan_findings_insert_policy',
        'compliance_scan_findings.compliance_scan_findings_isolation_policy',
        'compliance_scans.compliance_scans_insert_policy',
        'compliance_scans.compliance_scans_isolation_policy',
      ]);
    } finally {
      await client.end();
    }
  });

  it('(3) replaces the rule_type CHECK constraint with the V1-only vocabulary', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      await client.query(MIGRATION_SQL);

      const { rows } = await client.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid = 'compliance_framework_rules'::regclass AND conname = 'compliance_framework_rules_rule_type_check'`
      );
      expect(rows[0].def).toContain('property_check');
      expect(rows[0].def).toContain('tag_required');
      expect(rows[0].def).toContain('tag_pattern');
      expect(rows[0].def).toContain('metadata_check');
      expect(rows[0].def).not.toContain('custom_script');
      expect(rows[0].def).not.toContain('relationship_check');

      const orgA = await insertOrg(client, 'Org A');
      const fwId = await insertFramework(client, orgA, 'Framework A');
      await expect(
        client.query(
          `INSERT INTO compliance_framework_rules (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
           VALUES ($1, $2, 'BAD-1', 'bad', 'high', 'custom', 'custom_script', '{}', 'x')`,
          [fwId, orgA]
        )
      ).rejects.toThrow(/violates check constraint/);
    } finally {
      await client.end();
    }
  });

  it('(4) composite foreign keys reject a rule/scan/finding claiming a different organization than its parent', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      await client.query(MIGRATION_SQL);

      const orgA = await insertOrg(client, 'Org A');
      const orgB = await insertOrg(client, 'Org B');
      const fwId = await insertFramework(client, orgA, 'Framework A');

      await expect(
        client.query(
          `INSERT INTO compliance_framework_rules (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
           VALUES ($1, $2, 'BAD-2', 'bad', 'high', 'custom', 'property_check', '{}', 'x')`,
          [fwId, orgB]
        )
      ).rejects.toThrow(/violates foreign key constraint/);

      await expect(
        client.query(
          `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status)
           VALUES ($1, $2, 'manual', 'pending')`,
          [orgB, fwId]
        )
      ).rejects.toThrow(/violates foreign key constraint/);

      // A correctly-scoped rule/scan pair, to prove the equivalent scan_id/organization_id
      // composite FK on findings using a mismatched org is also rejected.
      const { rows: ruleRows } = await client.query(
        `INSERT INTO compliance_framework_rules (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
         VALUES ($1, $2, 'GOOD-1', 'good', 'high', 'custom', 'property_check', '{}', 'x') RETURNING id`,
        [fwId, orgA]
      );
      const { rows: scanRows } = await client.query(
        `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status) VALUES ($1, $2, 'manual', 'pending') RETURNING id`,
        [orgA, fwId]
      );
      await expect(
        client.query(
          `INSERT INTO compliance_scan_findings (scan_id, organization_id, rule_id, resource_id, resource_arn, resource_type, status, severity, category)
           VALUES ($1, $2, $3, 'res-1', 'arn', 's3', 'fail', 'high', 'encryption')`,
          [scanRows[0].id, orgB, ruleRows[0].id]
        )
      ).rejects.toThrow(/violates foreign key constraint/);
    } finally {
      await client.end();
    }
  });

  it('(5) is safe to re-run (idempotent)', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      await client.query(MIGRATION_SQL);
      await expect(client.query(MIGRATION_SQL)).resolves.toBeDefined();
    } finally {
      await client.end();
    }
  });

  it('(6) fails loudly and modifies nothing when an existing rule uses an unsupported rule_type', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      const orgA = await insertOrg(client, 'Org A');
      const fwId = await insertFramework(client, orgA, 'Framework A');
      await client.query(
        `INSERT INTO compliance_framework_rules (framework_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
         VALUES ($1, 'LEGACY-1', 'legacy', 'high', 'custom', 'custom_script', '{"script":"return true"}', 'x')`,
        [fwId]
      );

      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(
        /existing compliance_framework_rules row\(s\) using a rule_type outside the V1 vocabulary/
      );

      // Refused before any DDL took effect -- no organization_id column, no RLS.
      const { rows: cols } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'compliance_framework_rules' AND column_name = 'organization_id'`,
        [schemaName]
      );
      expect(cols).toHaveLength(0);

      const { rows: rls } = await client.query(
        `SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = 'compliance_framework_rules'`,
        [schemaName]
      );
      expect(rls[0].relrowsecurity).toBe(false);

      // And the offending row is still there, untouched.
      const { rows: stillThere } = await client.query(
        `SELECT rule_type FROM compliance_framework_rules WHERE rule_code = 'LEGACY-1'`
      );
      expect(stillThere).toHaveLength(1);
      expect(stillThere[0].rule_type).toBe('custom_script');
    } finally {
      await client.end();
    }
  });

  it('(7) fails loudly and creates nothing when the tables do not exist', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(/does not exist -- refusing to proceed/);
    } finally {
      await client.end();
    }
  });

  it('(8) classification: this administrative migration is invisible to the ordinary migration path', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMigrationFiles, MIGRATIONS_DIR } = require('../../../../database/migrate.js');

    const ordinaryFiles = getMigrationFiles(MIGRATIONS_DIR);
    expect(ordinaryFiles).not.toContain('202609191430_compliance_framework_security_foundation.sql');

    const adminDir = path.join(MIGRATIONS_DIR, '..', 'migrations-admin');
    expect(fs.existsSync(path.join(adminDir, '202609191430_compliance_framework_security_foundation.sql'))).toBe(true);
  });

  describe('organization isolation -- proven by real execution as a non-superuser, non-owner role', () => {
    /**
     * Every query in this describe block runs as `postgres` by default, a
     * superuser that PostgreSQL RLS never restricts. `SET ROLE` into a
     * throwaway NOSUPERUSER/NOBYPASSRLS role (created and dropped per test)
     * before each RLS-sensitive query, so what's actually being proven is
     * enforcement against a real non-owner, non-superuser session -- the
     * same category of role production's `devcontrol` is confirmed to be.
     */
    // DROP ROLE refuses ("cannot be dropped because some objects depend on
    // it") while the role still holds any GRANT, anywhere in the database --
    // DROP OWNED BY revokes all of those first. Guarded by existence because
    // DROP OWNED BY itself (unlike DROP ROLE IF EXISTS) errors on a role that
    // doesn't exist.
    async function dropTestRole(client: Client, roleName: string) {
      const { rows } = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [roleName]);
      if (rows.length > 0) {
        await client.query(`DROP OWNED BY ${roleName}`);
        await client.query(`DROP ROLE ${roleName}`);
      }
    }

    async function withTestRole<T>(client: Client, schemaName: string, fn: () => Promise<T>): Promise<T> {
      const roleName = `${schemaName}_role`;
      await dropTestRole(client, roleName);
      await client.query(`CREATE ROLE ${roleName} NOSUPERUSER NOBYPASSRLS`);
      await client.query(`GRANT USAGE ON SCHEMA ${schemaName} TO ${roleName}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaName} TO ${roleName}`);
      try {
        return await fn();
      } finally {
        // Every call site already RESETs ROLE back to postgres before this
        // callback returns (even on the error paths asserted with
        // `.rejects.toThrow`), so the session is never still "acting as"
        // roleName here -- a real ("permission denied to drop role") failure
        // mode this suite hit and fixed during development.
        await dropTestRole(client, roleName);
      }
    }

    async function asOrg(client: Client, roleName: string, orgId: string | null) {
      await client.query(`SET ROLE ${roleName}`);
      await client.query(`SELECT set_config('app.current_organization_id', $1, false)`, [orgId ?? '']);
    }

    async function resetToSuperuser(client: Client) {
      await client.query(`RESET ROLE`);
    }

    it('a framework created for org A is invisible when read as org B, and missing context denies rather than leaks', async () => {
      const schemaName = nextSchema();
      const client = await newIsolatedClient(schemaName);
      const roleName = `${schemaName}_role`;
      try {
        await createRealisticFixture(client);
        await client.query(MIGRATION_SQL);
        const orgA = await insertOrg(client, 'Org A');
        const orgB = await insertOrg(client, 'Org B');
        await insertFramework(client, orgA, 'Framework A');

        await withTestRole(client, schemaName, async () => {
          await asOrg(client, roleName, orgB);
          const asB = await client.query(`SELECT count(*)::int AS n FROM compliance_frameworks`);
          expect(asB.rows[0].n).toBe(0);
          await resetToSuperuser(client);

          await asOrg(client, roleName, orgA);
          const asA = await client.query(`SELECT count(*)::int AS n FROM compliance_frameworks`);
          expect(asA.rows[0].n).toBe(1);
          await resetToSuperuser(client);

          // Missing/empty context -- must deny (see empty), never leak.
          await asOrg(client, roleName, null);
          const asMissing = await client.query(`SELECT count(*)::int AS n FROM compliance_frameworks`);
          expect(asMissing.rows[0].n).toBe(0);
          await resetToSuperuser(client);
        });
      } finally {
        // withTestRole's own finally already drops roleName (see dropTestRole).
        await client.end();
      }
    });

    it('org B cannot insert a row claiming org A, and org A cannot move its own row to org B', async () => {
      const schemaName = nextSchema();
      const client = await newIsolatedClient(schemaName);
      const roleName = `${schemaName}_role`;
      try {
        await createRealisticFixture(client);
        await client.query(MIGRATION_SQL);
        const orgA = await insertOrg(client, 'Org A');
        const orgB = await insertOrg(client, 'Org B');
        const fwId = await insertFramework(client, orgA, 'Framework A');

        await withTestRole(client, schemaName, async () => {
          await asOrg(client, roleName, orgB);
          await expect(
            client.query(
              `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, 'Sneaky', 'custom')`,
              [orgA]
            )
          ).rejects.toThrow(/row-level security/);
          await resetToSuperuser(client);

          await asOrg(client, roleName, orgA);
          await expect(
            client.query(`UPDATE compliance_frameworks SET organization_id = $1 WHERE id = $2`, [orgB, fwId])
          ).rejects.toThrow(/row-level security/);
          await resetToSuperuser(client);
        });
      } finally {
        // withTestRole's own finally already drops roleName (see dropTestRole).
        await client.end();
      }
    });

    it('org B cannot UPDATE or DELETE a row belonging to org A (both silently affect zero rows, per RLS semantics)', async () => {
      const schemaName = nextSchema();
      const client = await newIsolatedClient(schemaName);
      const roleName = `${schemaName}_role`;
      try {
        await createRealisticFixture(client);
        await client.query(MIGRATION_SQL);
        const orgA = await insertOrg(client, 'Org A');
        const orgB = await insertOrg(client, 'Org B');
        const fwId = await insertFramework(client, orgA, 'Framework A');

        await withTestRole(client, schemaName, async () => {
          await asOrg(client, roleName, orgB);
          const updateResult = await client.query(`UPDATE compliance_frameworks SET name = 'Hijacked' WHERE id = $1`, [fwId]);
          expect(updateResult.rowCount).toBe(0);
          const deleteResult = await client.query(`DELETE FROM compliance_frameworks WHERE id = $1`, [fwId]);
          expect(deleteResult.rowCount).toBe(0);
          await resetToSuperuser(client);

          await asOrg(client, roleName, orgA);
          const stillThere = await client.query(`SELECT name FROM compliance_frameworks WHERE id = $1`, [fwId]);
          expect(stillThere.rows).toHaveLength(1);
          expect(stillThere.rows[0].name).toBe('Framework A');
          await resetToSuperuser(client);
        });
      } finally {
        // withTestRole's own finally already drops roleName (see dropTestRole).
        await client.end();
      }
    });

    it('scan findings remain organization-scoped: org B cannot see org A findings', async () => {
      const schemaName = nextSchema();
      const client = await newIsolatedClient(schemaName);
      const roleName = `${schemaName}_role`;
      try {
        await createRealisticFixture(client);
        const orgA = await insertOrg(client, 'Org A');
        await insertOrg(client, 'Org B'); // referenced only via id below
        const orgB = (await client.query(`SELECT id FROM organizations WHERE name = 'Org B'`)).rows[0].id;
        const fwId = await insertFramework(client, orgA, 'Framework A');
        const { rows: ruleRows } = await client.query(
          `INSERT INTO compliance_framework_rules (framework_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
           VALUES ($1, 'CUSTOM-001', 'Encryption required', 'high', 'encryption', 'property_check', '{}', 'x') RETURNING id`,
          [fwId]
        );
        const { rows: scanRows } = await client.query(
          `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status) VALUES ($1, $2, 'manual', 'completed') RETURNING id`,
          [orgA, fwId]
        );
        await client.query(
          `INSERT INTO compliance_scan_findings (scan_id, rule_id, resource_id, resource_arn, resource_type, status, severity, category)
           VALUES ($1, $2, 'res-1', 'arn', 's3', 'fail', 'high', 'encryption')`,
          [scanRows[0].id, ruleRows[0].id]
        );

        await client.query(MIGRATION_SQL);

        await withTestRole(client, schemaName, async () => {
          await asOrg(client, roleName, orgB);
          const asB = await client.query(`SELECT count(*)::int AS n FROM compliance_scan_findings`);
          expect(asB.rows[0].n).toBe(0);
          await resetToSuperuser(client);

          await asOrg(client, roleName, orgA);
          const asA = await client.query(`SELECT count(*)::int AS n FROM compliance_scan_findings`);
          expect(asA.rows[0].n).toBe(1);
          await resetToSuperuser(client);
        });
      } finally {
        // withTestRole's own finally already drops roleName (see dropTestRole).
        await client.end();
      }
    });
  });
});
