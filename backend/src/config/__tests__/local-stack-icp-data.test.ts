/**
 * dev/local/icp-data.js: the demo workspace is deterministic, shaped like the
 * ICP (US Series A SaaS, ~$15K-$50K/month of AWS, no DevOps team) and made
 * only of placeholders -- the repository is public and the demo is shown to
 * people.
 */
import path from 'path';
import { S3_STANDARD_PER_GB_MONTH_USD, S3_STANDARD_IA_PER_GB_MONTH_USD } from '../aws-pricing';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const icp = require(path.join(__dirname, '..', '..', '..', '..', 'dev', 'local', 'icp-data.js'));

const ANCHOR = new Date('2026-10-17T15:30:00Z');
const data = icp.generateIcpData({ anchor: ANCHOR });

type Row = Record<string, unknown>;
const resources: Row[] = data.resources;
const countBy = (rows: Row[], key: (row: Row) => string) =>
  rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [key(row)]: (acc[key(row)] || 0) + 1 }), {});

describe('determinism', () => {
  it('the same seed and day give identical data', () => {
    expect(icp.generateIcpData({ anchor: new Date('2026-10-17T01:00:00Z') })).toEqual(data);
  });

  it('a different seed gives different data', () => {
    const other = icp.generateIcpData({ seed: 'another-seed', anchor: ANCHOR });
    expect(other.organization.id).not.toBe(data.organization.id);
    expect(other.resources.map((r: Row) => r.tags)).not.toEqual(resources.map((r) => r.tags));
  });

  it('nothing is dated after the anchor day began', () => {
    const midnight = Date.UTC(2026, 9, 17);
    const dates = JSON.stringify(data).match(/"\d{4}-\d{2}-\d{2}T[^"]+"/g) ?? [];
    expect(dates.length).toBeGreaterThan(100);
    for (const date of dates) expect(Date.parse(JSON.parse(date))).toBeLessThanOrEqual(midnight);
  });

  it('refuses an invalid anchor', () => {
    expect(() => icp.generateIcpData({ anchor: new Date('nope') })).toThrow('anchor must be a Date');
  });
});

describe('ICP shape', () => {
  it('has ~40 services in 6 teams, 4 with no owner, 2 with no resources', () => {
    expect(data.teams).toHaveLength(6);
    expect(data.services).toHaveLength(40);
    const noOwner = data.services.filter((s: Row) => s.team_id === null);
    expect(noOwner.map((s: Row) => s.owner)).toEqual(['', '', '', '']);
    const withResources = new Set(resources.map((r) => r.service_id).filter(Boolean));
    expect(data.services.filter((s: Row) => !withResources.has(s.id)).map((s: Row) => s.name)).toEqual(['ab-testing', 'temp-migration-tool']);
  });

  it('has 300+ resources across 2 accounts and 3 regions', () => {
    expect(resources.length).toBeGreaterThanOrEqual(300);
    expect(resources.length).toBeLessThanOrEqual(360);
    expect(Object.keys(countBy(resources, (r) => String(r.account))).sort()).toEqual(['000000000001', '000000000002']);
    expect(Object.keys(countBy(resources, (r) => String(r.region))).sort()).toEqual(['eu-west-1', 'us-east-1', 'us-west-2']);
  });

  it('spends inside the ICP band, with plausible per-resource costs', () => {
    const monthly = resources.reduce((sum, r) => sum + Number(r.estimated_monthly_cost), 0);
    expect(monthly).toBeGreaterThan(25000);
    expect(monthly).toBeLessThan(40000);
    for (const r of resources) {
      expect(Number(r.estimated_monthly_cost)).toBeGreaterThanOrEqual(0);
      expect(Number(r.estimated_monthly_cost)).toBeLessThan(2000);
    }
    // Compute and databases lead the bill, as they do for this kind of company.
    const byType = resources.reduce<Record<string, number>>((acc, r) => ({ ...acc, [String(r.resource_type)]: (acc[String(r.resource_type)] || 0) + Number(r.estimated_monthly_cost) }), {});
    const ranked = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type]) => type);
    expect(ranked.slice(0, 2).sort()).toEqual(['ec2', 'rds']);
  });

  it('exercises every Services state, with a meaningful share unassigned', () => {
    const states = countBy(resources, (r) => String(r.state));
    expect(Object.keys(states).sort()).toEqual(['assigned', 'shared', 'suggested', 'untagged']);
    expect(states.assigned / resources.length).toBeGreaterThan(0.45);
    expect(states.assigned / resources.length).toBeLessThan(0.7);
    for (const state of ['suggested', 'shared', 'untagged']) expect(states[state]).toBeGreaterThanOrEqual(20);
    for (const r of resources) {
      expect(r.service_id !== null).toBe(r.state === 'assigned');
    }
  });

  it('stores each type\'s status as discovery does (resourceLifecycle.ts, mapCloudFrontStatus)', () => {
    const allowed: Record<string, string[]> = {
      ec2: ['running', 'stopped'],
      ebs: ['in-use', 'available'],
      rds: ['available'],
      lambda: ['Active'],
      'load-balancer': ['active'],
      cloudfront: ['active'],
      s3: ['not_applicable'],
      sns: ['not_applicable'],
      ecs: ['unknown'],
      elasticache: ['unknown'],
      sqs: ['unknown'],
      dynamodb: ['unknown'],
    };
    for (const r of resources) expect(allowed[String(r.resource_type)]).toContain(r.status);
  });

  it('collects no tags for S3 and CloudFront, as discovery does', () => {
    for (const r of resources.filter((x) => x.resource_type === 's3' || x.resource_type === 'cloudfront')) {
      expect(r.tags).toEqual({});
      expect(['assigned', 'untagged']).toContain(r.state);
    }
  });

  it('writes EC2 and EBS ARNs the way discovery does (account `*`), the rest with a placeholder account', () => {
    for (const r of resources) {
      const account = String(r.resource_arn).split(':')[4];
      if (r.resource_type === 'ec2' || r.resource_type === 'ebs') expect(account).toBe('*');
      else if (r.resource_type === 's3') expect(account).toBe('');
      else expect(account).toBe(r.account);
    }
  });

  it('has unique ARNs and ids', () => {
    expect(new Set(resources.map((r) => r.resource_arn)).size).toBe(resources.length);
    const ids = [data.organization, ...data.users, ...data.memberships, ...data.teams, ...data.services, ...resources, ...data.recommendations, ...data.findings, ...data.discoveryJobs].map((r: Row) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('messy tags', () => {
  const tagSets = resources.map((r) => r.tags as Record<string, string>);
  const keys = tagSets.flatMap((tags) => Object.keys(tags));
  const values = tagSets.flatMap((tags) => Object.values(tags));

  it('uses inconsistent key case and synonyms for the same idea', () => {
    for (const key of ['team', 'Team', 'TEAM', 'Squad', 'service', 'Service', 'app', 'env', 'Environment', 'stage']) {
      expect(keys).toContain(key);
    }
    expect(keys.some((key) => key !== key.trim())).toBe(true);
  });

  it('carries typos, re-cased and padded values', () => {
    const typos = icp.SERVICES.map((s: unknown[]) => s[3]).filter(Boolean).concat(icp.TEAMS.map((t: Row) => t.typo));
    expect(values.some((v) => typos.includes(v))).toBe(true);
    expect(values).toContain('PRODUCTION');
    expect(values.some((v) => v !== v.trim())).toBe(true);
  });

  it('leaves the team or service tag off many tagged resources', () => {
    const tagged = resources.filter((r) => r.state === 'assigned');
    const noTeam = tagged.filter((r) => !Object.keys(r.tags as object).some((k) => /team|squad/i.test(k)));
    const noService = tagged.filter((r) => !Object.keys(r.tags as object).some((k) => /service|^app$/i.test(k.trim())));
    expect(noTeam.length).toBeGreaterThan(20);
    expect(noService.length).toBeGreaterThan(20);
  });

  it('tags shared infrastructure as shared, and gives every suggested resource a service tag', () => {
    for (const r of resources.filter((x) => x.state === 'shared')) {
      expect(Object.values(r.tags as object).some((v) => icp.SHARED_SERVICE_VALUES.includes(v))).toBe(true);
    }
    for (const r of resources.filter((x) => x.state === 'suggested')) {
      expect(Object.keys(r.tags as object).some((k) => /service|^app$/i.test(k.trim()))).toBe(true);
    }
  });

  it('names former employees and Slack handles as owners', () => {
    expect(values).toContain('former.engineer@example.com');
    expect(values.some((v) => v.startsWith('@'))).toBe(true);
  });
});

describe('only placeholders', () => {
  const text = JSON.stringify(data);

  it('every 12-digit number is a zero-padded placeholder account', () => {
    // UUIDs and sha256 finding keys can hold digit runs; they are not accounts.
    const withoutHashes = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64}/g, ' ');
    for (const [value] of withoutHashes.matchAll(/(?<![0-9])[0-9]{12}(?![0-9])/g)) {
      expect(value).toMatch(/^0{9}\d{3}$/);
    }
  });

  it('every vol-/i-/sg- id is visibly patterned (mostly zeros)', () => {
    const ids = [...text.matchAll(/(?<![0-9A-Za-z-])(?:vol|i|sg|vpc)-([0-9a-f]{17})(?![0-9A-Za-z])/g)];
    expect(ids.length).toBeGreaterThan(150);
    for (const [, hex] of ids) expect(hex).toMatch(/^0{12}[0-9a-f]{5}$/);
  });

  it('every email is @example.com and every IP is in a documentation range', () => {
    for (const [email] of text.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) expect(email.toLowerCase()).toMatch(/@example\.com$/);
    // 0.0.0.0 only as the "anywhere" CIDR in security-group findings.
    for (const [ip] of text.matchAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)) expect(ip).toMatch(/^(203\.0\.113\.\d+|0\.0\.0\.0)$/);
  });

  it('names the organization and people as invented', () => {
    expect(data.organization.name).toBe('Example SaaS Inc.');
    expect(data.organization.description).toMatch(/invented/i);
  });
});

describe('fits the schema', () => {
  it('recommendations use the analyzers\' issues and allowed severities and statuses, one ACTIVE per resource and issue', () => {
    const issues = ['Unattached EBS Volume', 'gp2 to gp3 Migration Opportunity', 'Idle Instance', 'S3 Lifecycle Optimization', 'Low-Usage Lambda Function'];
    for (const rec of data.recommendations) {
      expect(issues).toContain(rec.issue);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(rec.severity);
      expect(['ACTIVE', 'RESOLVED', 'DISMISSED']).toContain(rec.status);
      expect(rec.resolved_at === null).toBe(rec.status === 'ACTIVE');
    }
    const active = data.recommendations.filter((r: Row) => r.status === 'ACTIVE').map((r: Row) => `${r.resource_id}|${r.issue}`);
    expect(new Set(active).size).toBe(active.length);
    expect(active.length).toBeGreaterThanOrEqual(15);
    expect(data.recommendations.some((r: Row) => r.status !== 'ACTIVE')).toBe(true);
  });

  it('S3 lifecycle rows use the detector\'s ceiling formula and wording, and claim no access history', () => {
    const s3 = data.recommendations.filter((r: Row) => r.issue === 'S3 Lifecycle Optimization');
    expect(s3.length).toBeGreaterThan(0);
    for (const rec of s3) {
      const gb = (rec.metadata as Row).standard_storage_gb as number;
      expect(rec.potential_savings).toBeCloseTo(gb * (S3_STANDARD_PER_GB_MONTH_USD - S3_STANDARD_IA_PER_GB_MONTH_USD), 2);
      expect(rec.description).toMatch(/^This bucket has no lifecycle configuration\. If all [0-9.]+GB of its current Standard storage qualified for a transition to Standard-IA, the maximum possible saving/);
      expect(rec.description).not.toMatch(/not been read|90 days/);
    }
  });

  it('no retired oversized-RDS rows, and every figure states a savings basis (S3 lifecycle as a ceiling)', () => {
    expect(data.recommendations.some((r: Row) => r.issue === 'Oversized Instance' || r.resource_type === 'RDS')).toBe(false);
    for (const rec of data.recommendations) {
      const basis = (rec.metadata as Row).savings_basis as string;
      if (rec.issue === 'S3 Lifecycle Optimization') expect(basis).toMatch(/^ceiling: /);
      else expect(basis).toMatch(/^estimated: /);
    }
  });

  it('findings use allowed categories, severities, statuses and dispositions', () => {
    expect(data.findings.length).toBeGreaterThanOrEqual(10);
    for (const f of data.findings) {
      expect(['networking', 'iam']).toContain(f.category);
      expect(['critical', 'high', 'medium', 'low']).toContain(f.severity);
      expect(f.status).toBe('active');
      expect([null, 'acknowledged', 'dismissed', 'accepted_risk']).toContain(f.disposition);
      expect(f.finding_key).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(data.findings.map((f: Row) => f.finding_key)).size).toBe(data.findings.length);
    expect(data.findings.some((f: Row) => f.category === 'iam')).toBe(true);
    expect(data.findings.some((f: Row) => f.disposition !== null)).toBe(true);
  });

  it('services use templates the API accepts; the organization is on pro', () => {
    for (const s of data.services) expect(['api', 'frontend', 'worker', 'database']).toContain(s.template);
    expect(data.organization.subscription_tier).toBe('pro');
    expect(data.organization.max_services).toBeGreaterThanOrEqual(data.services.length);
    expect(data.organization.max_users).toBeGreaterThanOrEqual(data.users.length);
  });

  it('has exactly one owner, the demo login', () => {
    expect(data.memberships.filter((m: Row) => m.role === 'owner').map((m: Row) => m.user_id)).toEqual([
      data.users.find((u: Row) => u.email === icp.DEMO_EMAIL).id,
    ]);
  });

  it('seeds no AWS account connection', () => {
    expect(Object.keys(data)).not.toContain('awsAccounts');
  });
});
