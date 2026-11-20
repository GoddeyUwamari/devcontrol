/**
 * Database fixtures for the D8a DB suites. `admin` is the test database's
 * superuser (setup and inspection only: it bypasses row level security).
 * `app` connects as the real devcontrol role, so row level security, the
 * grants and the definer functions apply exactly as in production.
 */
import { Pool } from 'pg';
import { installTenantTagReset } from '../../../../config/database';
import { GitHubAppConfigResult } from '../../../../config/github-app';

export function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

export const WEBHOOK_SECRET = 'planted-webhook-secret-do-not-log-0001';
export const CLIENT_SECRET = 'planted-client-secret-do-not-log-0001';

export const enabledConfig = (): GitHubAppConfigResult => ({
  enabled: true,
  config: {
    appId: '123456',
    slug: 'devcontrol-test',
    clientId: 'Iv1.placeholder0000',
    clientSecret: CLIENT_SECRET,
    privateKey: '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----',
    webhookSecrets: [WEBHOOK_SECRET],
  },
});

export function createFixtures(label: string) {
  const admin = new Pool({ ...dbConfig(), max: 3 });
  const app = installTenantTagReset(new Pool({ ...dbConfig(), max: 4, options: '-c role=devcontrol' }));
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const installationIds: number[] = [];
  const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function org(): Promise<string> {
    const s = suffix();
    const { rows } = await admin.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $1, $1, 'enterprise', 'active') RETURNING id::text AS id`,
      [`${label}-${s}`]
    );
    orgIds.push(rows[0].id);
    return rows[0].id;
  }

  async function user(orgId: string, role = 'owner'): Promise<string> {
    const { rows } = await admin.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'D8a Test') RETURNING id::text AS id`,
      [`${label}-${suffix()}@example.com`]
    );
    userIds.push(rows[0].id);
    await admin.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, $3, NOW(), true)`,
      [orgId, rows[0].id, role]
    );
    return rows[0].id;
  }

  async function service(orgId: string, name: string): Promise<string> {
    const { rows } = await admin.query(
      `INSERT INTO services (name, template, owner, status, organization_id) VALUES ($1, 'api', 'd8a-test', 'active', $2) RETURNING id::text AS id`,
      [name, orgId]
    );
    return rows[0].id;
  }

  /** A unique installation id, remembered for cleanup of held rows. */
  function installationId(): number {
    const id = 8_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    installationIds.push(id);
    return id;
  }

  /** A claim row written directly (the claim flow has its own suite). */
  async function claim(orgId: string, instId: number): Promise<void> {
    await admin.query(
      `INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
         permissions_state, installer_github_user_id, claimed_by_github_user_id)
       VALUES ($1, $2, 777, 'acme', 'Organization', 'selected', 'expected', 8123, 8123)`,
      [instId, orgId]
    );
  }

  /**
   * Production's devcontrol reads services (every service route does); the
   * CI-built database grants devcontrol only what admin migrations grant.
   * Retried: a concurrent GRANT on the same table can fail with "tuple
   * concurrently updated".
   */
  async function grantAppReads(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await admin.query('GRANT SELECT ON services TO devcontrol');
        return;
      } catch (error) {
        if (attempt >= 5) throw error;
        await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
  }

  async function close(): Promise<void> {
    await admin.query('DELETE FROM github_held_deliveries WHERE installation_id = ANY($1::bigint[])', [installationIds]);
    await admin.query('DELETE FROM pipeline_events WHERE organization_id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM pipeline_repositories WHERE organization_id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM github_installations WHERE organization_id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM github_install_states WHERE organization_id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM services WHERE organization_id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM audit_logs WHERE organization_id = ANY($1::uuid[])', [orgIds]).catch(() => undefined);
    await admin.query('DELETE FROM analytics_events WHERE organization_id = ANY($1::uuid[])', [orgIds]).catch(() => undefined);
    await admin.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgIds]);
    await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await app.end();
    await admin.end();
  }

  return { admin, app, org, user, service, installationId, claim, grantAppReads, close };
}
