/**
 * Completeness (AI truth PR 2, step1 §4):
 *   - every data source in the inventory (S1-S29) is covered by at least one
 *     evidence provider, or excluded with a reason;
 *   - every table created by database/migrations*\/*.sql is classified: under
 *     a data source, or in EXCLUDED_TABLES. A new table fails here until
 *     someone decides whether the AI may see it;
 *   - every provider's plan entitlement key is in PLAN_ENTITLEMENTS;
 *   - no hard-coded "not supported" or stale status sentence (step1 §1.3)
 *     remains on the AI surfaces or the alerts page.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DATA_SOURCES, EXCLUDED_TABLES } from '../data-sources';
import { createDefaultEvidenceRegistry } from '../providers';
import { PLAN_ENTITLEMENTS } from '../../../../config/plan-entitlements';
import { TWO_SCANS_SECONDS } from '../providers/shared';
import { STALE_AFTER_SECONDS } from '../../../../routes/services-coverage.routes';

const REPO = path.resolve(__dirname, '../../../../../..');
const providers = createDefaultEvidenceRegistry().list();

/** Table names a migration file creates, with SQL comments removed first. */
export function tablesCreatedBy(sql: string): string[] {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const found: string[] = [];
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[A-Za-z0-9_.]+"?)/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(stripped)) !== null) {
    found.push(m[1].replace(/"/g, '').split('.').pop()!.toLowerCase());
  }
  return found;
}

function migrationTables(): Map<string, string> {
  const tables = new Map<string, string>();
  const dbDir = path.join(REPO, 'database');
  for (const dir of fs.readdirSync(dbDir).filter((d) => d.startsWith('migrations'))) {
    const full = path.join(dbDir, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.sql')).sort()) {
      for (const table of tablesCreatedBy(fs.readFileSync(path.join(full, file), 'utf8'))) {
        if (!tables.has(table)) tables.set(table, `${dir}/${file}`);
      }
    }
  }
  return tables;
}

describe('data-source inventory', () => {
  it('lists S1-S29 exactly once each', () => {
    expect(DATA_SOURCES.map((s) => s.id)).toEqual(Array.from({ length: 29 }, (_, i) => `S${i + 1}`));
  });

  it('every source is covered by a provider, or excluded with a reason -- never both, never neither', () => {
    const covered = new Map<string, string[]>();
    for (const p of providers) for (const id of p.dataSourceIds) covered.set(id, [...(covered.get(id) ?? []), p.id]);
    const problems = DATA_SOURCES.flatMap((s) => {
      const by = covered.get(s.id) ?? [];
      if (s.excluded !== undefined && s.excluded.trim().length < 10) return [`${s.id}: exclusion needs a reason`];
      if (s.excluded !== undefined && by.length > 0) return [`${s.id}: excluded but covered by ${by.join(', ')}`];
      if (s.excluded === undefined && by.length === 0) return [`${s.id} (${s.name}): no provider and no exclusion`];
      return [];
    });
    expect(problems).toEqual([]);
  });

  it('every provider names only data sources that exist', () => {
    const known = new Set(DATA_SOURCES.map((s) => s.id));
    expect(providers.flatMap((p) => p.dataSourceIds.filter((id) => !known.has(id)).map((id) => `${p.id}: ${id}`))).toEqual([]);
  });
});

describe('every table created by a migration is classified', () => {
  const tables = migrationTables();
  const classified = new Set([...DATA_SOURCES.flatMap((s) => s.tables), ...Object.keys(EXCLUDED_TABLES)]);

  it('finds the migrations (guards against a wrong path silently passing)', () => {
    expect(tables.size).toBeGreaterThan(40);
    expect(tables.has('account_security_findings')).toBe(true);
  });

  it('has no unclassified table', () => {
    const unclassified = [...tables.entries()].filter(([t]) => !classified.has(t)).map(([t, file]) => `${t} (created in ${file})`);
    expect(unclassified).toEqual([]);
  });

  it('never both lists a table as evidence and excludes it', () => {
    const evidence = new Set(DATA_SOURCES.flatMap((s) => s.tables));
    expect(Object.keys(EXCLUDED_TABLES).filter((t) => evidence.has(t))).toEqual([]);
  });

  it('ignores commented-out CREATE TABLE lines', () => {
    expect(tablesCreatedBy('-- CREATE TABLE ghost (id int);\n/* CREATE TABLE ghost2 () */\nCREATE TABLE IF NOT EXISTS "real_one" (id int);')).toEqual(['real_one']);
  });
});

it('the region-list staleness rule is the Services coverage page\'s (13 hours)', () => {
  expect(TWO_SCANS_SECONDS).toBe(STALE_AFTER_SECONDS);
});

describe('plan entitlements', () => {
  it('every provider entitlementKey exists in config/plan-entitlements.ts', () => {
    const keys = providers.filter((p) => p.entitlementKey !== undefined).map((p) => [p.id, p.entitlementKey!] as const);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys.filter(([, key]) => !(key in PLAN_ENTITLEMENTS))).toEqual([]);
  });

  it('gates DORA, Security Hub, the risk score and custom framework scans by their plan keys (A-D12, A-D14)', () => {
    const keyOf = (id: string) => providers.find((p) => p.id === id)?.entitlementKey;
    expect(keyOf('delivery.dora')).toBe('doraMetrics');
    expect(keyOf('security.security_hub')).toBe('securityHubStatus');
    expect(keyOf('security.risk_score')).toBe('riskScore');
    expect(keyOf('compliance.custom_scans')).toBe('complianceFrameworks');
  });
});

describe('no stale "not supported" constant remains (step1 §1.3)', () => {
  const STALE = [
    /does not yet associate alerts with an organization/i,
    /alert sync does not/i,
    /does not collect EC2 CPU utilization/i,
    /No anomaly detection is connected/i,
    /does not compute a validated security score/i,
    /does not compute a security score/i,
    /Alert data is not part of this (context|evidence)/i,
    /Availability, error-rate, and alert data are not part/i,
    /does not currently evaluate outages/i,
    /Does not include account-level security findings or AWS Security Hub/i,
    /does not yet include CloudWatch alarms/i,
    /Alert counts are not included in this report/i,
    /There is no security score and no earlier security result/i,
  ];
  const FILES = [
    'backend/src/repositories/ai-chat-context.repository.ts',
    'backend/src/services/ai-chat.service.ts',
    'backend/src/services/ai-report-generator.service.ts',
    'backend/src/services/ai-summary.service.ts',
    'backend/src/controllers/ai-summary.controller.ts',
    'backend/src/repositories/weekly-summary.repository.ts',
    'backend/src/services/weekly-summary-content.ts',
    'backend/src/services/nl-query-guard.ts',
    'app/(app)/observability/alerts/page.tsx',
  ];

  it.each(FILES)('%s has none of the stale sentences', (file) => {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8');
    expect(STALE.filter((re) => re.test(text)).map(String)).toEqual([]);
  });

  it('the AI surfaces build no not_supported section of their own: every status comes from a provider', () => {
    for (const file of FILES.filter((f) => f.startsWith('backend/') && !f.includes('nl-query'))) {
      const text = fs.readFileSync(path.join(REPO, file), 'utf8');
      expect([file, /\bnotSupported\s*[<(]/.test(text)]).toEqual([file, false]);
    }
  });
});
