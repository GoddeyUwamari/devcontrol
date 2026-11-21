/**
 * D8a repositories: every statement on a GitHub App tenant table names the
 * organization explicitly (defence in depth under row level security).
 *
 * Static: each SQL text in the three repository files that touches
 * github_installations, github_install_states, pipeline_repositories or
 * pipeline_events carries an organization_id predicate (or column, for an
 * INSERT). The only other statements allowed are the SECURITY DEFINER calls.
 *
 * Behaviour: the read functions run on a superuser connection (row level
 * security bypassed), so only the explicit predicate stands between one
 * organization and another's rows.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { listRepositories, setRepositoryService } from '../pipeline-repositories.repository';
import { listInstallations } from '../github-installations.repository';
import { findUnprocessedEvents, lastEventReceivedAt } from '../pipeline-events.repository';
import { dbConfig } from '../../services/github-app/__tests__/fixtures/db';

const FILES = ['github-installations.repository.ts', 'pipeline-repositories.repository.ts', 'pipeline-events.repository.ts'];
const TENANT_TABLES = /\b(github_installations|github_install_states|pipeline_repositories|pipeline_events)\b/;
const DEFINER_CALL = /^\s*SELECT github_(installation_org|hold_delivery|installer_of|release_held_deliveries)\(/;

function sqlTexts(file: string): string[] {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  return [...source.matchAll(/(`[\s\S]*?`|'(?:SELECT|INSERT|UPDATE|DELETE)[^'\n]*')/g)]
    .map((m) => m[1].slice(1, -1))
    .filter((t) => /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(t));
}

describe('D8a repositories: explicit organization predicates (static)', () => {
  it.each(FILES)('%s: every tenant-table statement names organization_id', (file) => {
    const texts = sqlTexts(file);
    expect(texts.length).toBeGreaterThan(2);
    const offenders = texts
      .filter((t) => TENANT_TABLES.test(t) && !DEFINER_CALL.test(t))
      .filter((t) => !/organization_id\s*=\s*\$1\b/.test(t) && !/^\s*INSERT INTO \w+[\s\S]*\(\s*[\s\S]*organization_id/i.test(t));
    expect(offenders).toEqual([]);
  });
});

describe('D8a repositories: reads under a bypassed RLS still return one organization', () => {
  const admin = new Pool({ ...dbConfig(), max: 2 });
  const orgs: string[] = [];
  const inst = 8_900_000_000 + Math.floor(Math.random() * 1e8);
  let svcB = '';
  let repoB = '';

  beforeAll(async () => {
    for (const n of ['a', 'b']) {
      const label = `d8a-scope-${n}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      orgs.push((await admin.query(`INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
        VALUES ($1, $1, $1, 'free', 'free') RETURNING id::text AS id`, [label])).rows[0].id);
    }
    const [, b] = orgs;
    await admin.query(`INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
      permissions_state, installer_github_user_id, claimed_by_github_user_id) VALUES ($1, $2, 1, 'b', 'Organization', 'all', 'expected', 1, 1)`, [inst, b]);
    repoB = (await admin.query(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name) VALUES ($1, 77, $2, 'b/b') RETURNING id::text AS id`, [b, inst])).rows[0].id;
    await admin.query(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, normalizer_version, facts)
      VALUES (gen_random_uuid(), $1, $2, 'installation', 'created', 1, '{}')`, [b, inst]);
    svcB = (await admin.query(`INSERT INTO services (name, template, owner, status, organization_id) VALUES ('b', 'api', 'o', 'active', $1) RETURNING id::text AS id`, [b])).rows[0].id;
  });

  afterAll(async () => {
    await admin.query('DELETE FROM pipeline_events WHERE organization_id = ANY($1::uuid[])', [orgs]);
    await admin.query('DELETE FROM pipeline_repositories WHERE organization_id = ANY($1::uuid[])', [orgs]);
    await admin.query('DELETE FROM github_installations WHERE organization_id = ANY($1::uuid[])', [orgs]);
    await admin.query('DELETE FROM services WHERE organization_id = ANY($1::uuid[])', [orgs]);
    await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgs]);
    await admin.end();
  });

  it('organization A sees none of B\'s installations, repositories or events, and cannot map B\'s repository', async () => {
    const [a] = orgs;
    const c = await admin.connect();
    try {
      expect(await listInstallations(c, a)).toEqual([]);
      expect(await listRepositories(c, a)).toEqual([]);
      expect(await lastEventReceivedAt(c, a)).toBeNull();
      expect(await findUnprocessedEvents(c, a, inst)).toEqual([]);
      expect(await setRepositoryService(c, a, repoB, null)).toBe(false);
      expect(await setRepositoryService(c, a, repoB, svcB)).toBe(false);
      expect((await listRepositories(c, orgs[1])).map((r) => r.id)).toEqual([repoB]);
    } finally {
      c.release();
    }
  });
});
