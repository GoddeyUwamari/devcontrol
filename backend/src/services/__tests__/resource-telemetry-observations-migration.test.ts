/**
 * database/migrations-admin/202610281200_create_resource_telemetry_observations.sql
 * and its paired rollback, executed from disk against a database bootstrapped
 * by .github/scripts/ci-bootstrap-schema.js (which applied the migration).
 *
 * The round trip runs in ONE transaction that is always rolled back, so the
 * bootstrapped tables are back afterwards. Placeholders only.
 */
import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getMigrationFiles } = require('../../../../database/migrate.js')

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin')
const MIGRATION_FILE = '202610281200_create_resource_telemetry_observations.sql'
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8')
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, '202610281200_create_resource_telemetry_observations_rollback.sql'), 'utf8')

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  }
}

/** The SQL with comments removed, for static checks. */
const statements = (sql: string) => sql.replace(/--[^\n]*/g, '')

describe('202610281200_create_resource_telemetry_observations', () => {
  it('is additive: it creates two tables and never alters, drops or deletes anything that exists', () => {
    const sql = statements(MIGRATION_SQL)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(?!resource_telemetry_observations\b|observability_collection_scopes\b)/i)
    expect(sql).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+\w+\s+SET\b/i)
    expect(sql.match(/\bCREATE TABLE\s+(\w+)/gi)).toEqual([
      'CREATE TABLE resource_telemetry_observations',
      'CREATE TABLE observability_collection_scopes',
    ])
  })

  it('is administrative: invisible to the ordinary path, after 202610191200, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE)
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR)
    expect(adminFiles).toContain(MIGRATION_FILE)
    expect(adminFiles).not.toContain('202610281200_create_resource_telemetry_observations_rollback.sql')
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202610191200_create_multi_region_scan_foundation.sql'))
  })

  it('every non-key column is nullable', async () => {
    const client = new Client(dbConfig())
    await client.connect()
    try {
      const { rows } = await client.query(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns
          WHERE table_name IN ('resource_telemetry_observations', 'observability_collection_scopes')
            AND column_name NOT IN ('organization_id', 'aws_account_id', 'region', 'resource_id', 'updated_at')
          ORDER BY table_name, column_name`
      )
      expect(rows.length).toBe(5)
      expect(rows.every((r) => r.is_nullable === 'YES')).toBe(true)
    } finally {
      await client.end()
    }
  })

  it('rollback drops exactly its tables and ledger row; the migration then re-applies; a second run refuses', async () => {
    const client = new Client(dbConfig())
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE])

      await client.query(ROLLBACK_SQL)
      const gone = await client.query(`SELECT to_regclass('resource_telemetry_observations') AS a, to_regclass('observability_collection_scopes') AS b`)
      expect(gone.rows[0]).toEqual({ a: null, b: null })
      const ledger = await client.query(`SELECT 1 FROM schema_migrations WHERE migration_name = $1`, [MIGRATION_FILE])
      expect(ledger.rowCount).toBe(0)
      expect((await client.query(`SELECT to_regclass('aws_resources') AS t`)).rows[0].t).toBe('aws_resources')

      await client.query(MIGRATION_SQL)
      const back = await client.query(
        `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('resource_telemetry_observations', 'observability_collection_scopes') ORDER BY relname`
      )
      expect(back.rows).toEqual([
        { relname: 'observability_collection_scopes', relforcerowsecurity: true },
        { relname: 'resource_telemetry_observations', relforcerowsecurity: true },
      ])

      await client.query('SAVEPOINT again')
      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(/already exists -- this migration creates them and refuses to proceed/)
      await client.query('ROLLBACK TO SAVEPOINT again')

    } finally {
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  })

  it('rejects an observation with neither timestamp, and a malformed account id', async () => {
    const client = new Client(dbConfig())
    await client.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(`INSERT INTO organizations (name, slug, display_name) VALUES ('mig-check', 'mig-check', 'mig-check') RETURNING id`)
      const org = rows[0].id
      const { rows: res } = await client.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region) VALUES ($1, 'arn:aws:ec2:us-east-1:111122223333:instance/i-1234567890abcdef0', 'i-1234567890abcdef0', 'ec2', 'us-east-1') RETURNING id`,
        [org]
      )
      await client.query('SAVEPOINT a')
      await expect(
        client.query(`INSERT INTO resource_telemetry_observations (organization_id, aws_account_id, region, resource_id) VALUES ($1, '111122223333', 'us-east-1', $2)`, [org, res[0].id])
      ).rejects.toThrow(/resource_telemetry_observations_has_observation/)
      await client.query('ROLLBACK TO SAVEPOINT a')
      await expect(
        client.query(`INSERT INTO resource_telemetry_observations (organization_id, aws_account_id, region, resource_id, last_datapoint_at) VALUES ($1, 'acct-1', 'us-east-1', $2, NOW())`, [org, res[0].id])
      ).rejects.toThrow(/check constraint/)
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  })
})
