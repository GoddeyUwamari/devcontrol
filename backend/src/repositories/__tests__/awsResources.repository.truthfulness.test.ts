/**
 * Security Truthfulness #40/#41: regression coverage proving unencrypted_count/
 * missing_backup_count correctly exclude a genuine SQL NULL (unknown/unavailable
 * evidence) rather than folding it into the negative count -- both via the existing
 * `= false` queries (AWSResourcesRepository.getStats, already correct by SQL's own
 * three-valued-logic semantics, verified here rather than assumed) and via
 * ComplianceEngineService.getInfraSnapshot's now-fixed queries (previously had an
 * explicit `OR is_encrypted IS NULL` / `OR has_backup IS NULL` clause that actively
 * counted unknown resources as confirmed negative findings).
 *
 * Real local Postgres, matching this repo's established convention for anything that
 * depends on real WHERE-clause/three-valued-logic semantics.
 */
import { Pool } from 'pg';
import { AWSResourcesRepository } from '../awsResources.repository';
import { ComplianceEngineService } from '../../services/compliance-engine.service';
import { pool as appPool } from '../../config/database';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

describe('unencrypted_count / missing_backup_count correctly exclude NULL (Security Truthfulness #40/#41)', () => {
  const pool = new Pool(dbConfig());
  const repository = new AWSResourcesRepository(pool);
  const complianceEngine = new ComplianceEngineService(pool);

  let orgId: string;
  const createdOrgIds: string[] = [];

  async function insertResource(overrides: { resource_id: string; resource_type: string; is_encrypted: boolean | null; has_backup: boolean | null }) {
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, is_encrypted, has_backup)
       VALUES ($1, $2, $3, $3, $4, 'us-east-1', 'active', $5, $6)`,
      [orgId, `arn:aws:${overrides.resource_type}:us-east-1:*:${overrides.resource_id}`, overrides.resource_id, overrides.resource_type, overrides.is_encrypted, overrides.has_backup]
    );
  }

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`truthfulness-stats-test-${Date.now()}`]
    );
    orgId = rows[0].id;
    createdOrgIds.push(orgId);

    // One confirmed-true, one confirmed-false, one genuinely unknown (NULL) -- for both
    // is_encrypted (any type) and has_backup (ec2/rds, matching getStats' own scope).
    await insertResource({ resource_id: 'i-encrypted', resource_type: 'ec2', is_encrypted: true, has_backup: true });
    await insertResource({ resource_id: 'i-unencrypted', resource_type: 'ec2', is_encrypted: false, has_backup: false });
    await insertResource({ resource_id: 'i-unknown', resource_type: 'ec2', is_encrypted: null, has_backup: null });
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await pool.query(`DELETE FROM aws_resources WHERE organization_id = ANY($1)`, [createdOrgIds]);
      await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [createdOrgIds]);
    }
    await pool.end();
    await appPool.end();
  }, 20000);

  it('AWSResourcesRepository.getStats: unencrypted_count counts only the confirmed-false resource, not the unknown one', async () => {
    const stats = await repository.getStats(orgId);
    expect(stats.unencrypted_count).toBe(1);
    expect(stats.total_resources).toBe(3); // the unknown resource is still counted as a real resource
  });

  it('AWSResourcesRepository.getStats: missing_backup_count counts only the confirmed-false resource, not the unknown one', async () => {
    const stats = await repository.getStats(orgId);
    expect(stats.missing_backup_count).toBe(1);
  });

  it('ComplianceEngineService.getInfraSnapshot: unencryptedCount no longer folds NULL into the negative count (the fixed OR IS NULL bug)', async () => {
    const snapshot = await (complianceEngine as any).getInfraSnapshot(orgId);
    expect(snapshot.unencryptedCount).toBe(1);
    expect(snapshot.encryptedCount).toBe(1);
    expect(snapshot.totalResources).toBe(3);
  });

  it('ComplianceEngineService.getInfraSnapshot: noBackupCount no longer folds NULL into the negative count (the fixed OR IS NULL bug)', async () => {
    const snapshot = await (complianceEngine as any).getInfraSnapshot(orgId);
    expect(snapshot.noBackupCount).toBe(1);
    expect(snapshot.backupCount).toBe(1);
  });
});
