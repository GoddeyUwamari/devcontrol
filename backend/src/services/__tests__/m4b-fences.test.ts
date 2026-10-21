/**
 * Multi-region plan M4b, §5.1 / L3: a stale fencing token at EVERY fenced mutation
 * F1-F16 writes nothing.
 *
 * For each mutation: worker A holds a lease with a short TTL and no heartbeat; the
 * lease really expires (by the database clock, never by editing the row); worker B
 * takes it over on another connection. A then runs the mutation through the same
 * code the scan runs it with, on its own connection, against committed rows. It must
 * throw LeaseLostError (F15: return false) and leave every row exactly as it was. A
 * control runs the same mutation with a live lease for another organization and must
 * change the rows, so no case can pass by doing nothing.
 *
 * A static check pins the wiring: every destructive statement of a scan (discovery,
 * Analyze, the cron's SOC 2 step) runs inside a fenced transaction or passes its
 * lease to a repository that fences.
 *
 * Real Postgres; no AWS call (clients are fakes). Placeholders only.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Pool, PoolClient } from 'pg';
import { RDSClient } from '@aws-sdk/client-rds';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { ResourceReconciliationService } from '../resourceReconciliation.service';
import { ComplianceScannerService } from '../complianceScanner';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { Soc2EvidenceRepository } from '../../repositories/soc2-evidence.repository';
import { resolveFrameworkApplicability } from '../../utils/frameworkApplicability';
import * as dynamoTableUtil from '../dynamodb-table.util';
import * as dynamoAutoscalingUtil from '../dynamodb-autoscaling.util';
import {
  HeldLease,
  LeaseLostError,
  acquireJobLease,
  acquireScanLease,
  linkScanLeaseJob,
  releaseLease,
} from '../scan-lease';
import { LeaseSession, SCAN_KIND_DISCOVERY, DISCOVERY_JOB_NAME, DISCOVERY_INTERRUPTED_MESSAGE, onTaggedConnection } from '../scan-session';
import { connectPlaceholderAccount, removePlaceholderAccounts, PLACEHOLDER_ACCOUNT_ROW } from './helpers/scan-source';
import { ISSUE_EC2_IDLE_INSTANCE, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY } from '../../config/optimization-rules';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const ACCOUNT = PLACEHOLDER_ACCOUNT_ROW.account_id!;
const HOME = 'us-east-1';
const createdOrgIds: string[] = [];
const service = new AWSResourceDiscoveryService(pool);
const svc = service as any;
const NO_HEARTBEAT = { heartbeat: { intervalMs: 3_600_000 } };

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'active') RETURNING id`,
    [`M4b Fence Org ${suffix}`, `m4b-fence-org-${suffix}`, `M4b Fence Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

/** A dedicated connection tagged for the organization (the scan's own connection). */
async function scanConnection(orgId: string): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  return client;
}

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function untilExpired(lease: HeldLease): Promise<void> {
  await waitFor(
    async () =>
      (await pool.query(`SELECT expires_at <= clock_timestamp() AS expired FROM ${lease.key.table} WHERE fencing_token = $1`, [lease.fencingToken]))
        .rows[0]?.expired === true,
    'the lease to expire on the database clock'
  );
}

type Kind = 'scan' | 'job';

interface Worker {
  orgId: string;
  client: PoolClient;
  session: LeaseSession;
  done: () => Promise<void>;
}

/** Worker A whose lease another worker took over after real expiry (stale), or a live worker (fresh). */
async function worker(kind: Kind, state: 'stale' | 'fresh'): Promise<Worker> {
  const orgId = await insertOrg();
  const client = await scanConnection(orgId);
  const acquire = (db: PoolClient, holder: string, ttlSeconds?: number) =>
    kind === 'scan'
      ? acquireScanLease(db, { organizationId: orgId, awsAccountId: ACCOUNT, scanKind: SCAN_KIND_DISCOVERY }, holder, { ttlSeconds })
      : acquireJobLease(db, { organizationId: orgId, jobName: DISCOVERY_JOB_NAME }, holder, { ttlSeconds });
  const lease = (await acquire(client, 'worker-a', state === 'stale' ? 1 : undefined))!;
  const session = new LeaseSession(pool, lease, NO_HEARTBEAT);
  let takeover: HeldLease | null = null;
  if (state === 'stale') {
    await untilExpired(lease);
    takeover = await onTaggedConnection(pool, orgId, (db) => acquire(db, 'worker-b'));
    expect(takeover).not.toBeNull();
    expect(BigInt(takeover!.fencingToken) > BigInt(lease.fencingToken)).toBe(true);
  }
  return {
    orgId,
    client,
    session,
    done: async () => {
      await session.end();
      if (takeover) await onTaggedConnection(pool, orgId, (db) => releaseLease(db, takeover!));
      client.release();
    },
  };
}

const fencedOn = (w: Worker) => <T>(fn: () => Promise<T>) => w.session.fenced(w.client, fn);

async function insertResource(orgId: string, row: { arn: string; type: string; region?: string; missing?: number; metadata?: object }): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count, metadata)
     VALUES ($1, $2, $2, $2, $3, $4, 'active', $5, $6) RETURNING id`,
    [orgId, row.arn, row.type, row.region ?? HOME, row.missing ?? 1, JSON.stringify(row.metadata ?? {})]
  );
  return rows[0].id;
}

async function resourceState(orgId: string) {
  const { rows } = await pool.query(
    `SELECT resource_arn, resource_type, status, missing_scan_count, is_orphaned, metadata, compliance_issues
       FROM aws_resources WHERE organization_id = $1 ORDER BY resource_arn`,
    [orgId]
  );
  return rows;
}

async function insertJob(orgId: string, status = 'running', ageDays = 2): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, created_at)
     VALUES ($1, $2, NOW() - make_interval(days => $3), NOW() - make_interval(days => $3)) RETURNING id`,
    [orgId, status, ageDays]
  );
  return rows[0].id;
}

async function jobState(orgId: string) {
  return (await pool.query(`SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY created_at`, [orgId])).rows;
}

async function recState(orgId: string) {
  return (await pool.query(`SELECT resource_id, issue, status FROM cost_recommendations WHERE organization_id = $1 ORDER BY issue, resource_id`, [orgId])).rows;
}

async function seedRec(orgId: string, resourceId: string, issue: string): Promise<void> {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, severity, aws_region, status)
     VALUES ($1, $2, $2, 'EC2', $3, 'LOW', $4, 'ACTIVE')`,
    [orgId, resourceId, issue, HOME]
  );
}

interface FenceCase {
  id: string;
  kind: Kind;
  seed: (orgId: string) => Promise<Record<string, unknown>>;
  act: (w: Worker, seeded: Record<string, unknown>) => Promise<unknown>;
  state: (orgId: string) => Promise<unknown>;
  /** F15 reports a refusal as false instead of throwing. */
  refusesWith?: 'false';
}

const reconcileCase = (id: string, type: string, region: string | null, arn: string): FenceCase => ({
  id,
  kind: 'scan',
  seed: async (orgId) => ({ resource: await insertResource(orgId, { arn, type, region: region ?? HOME }) }),
  act: (w) => fencedOn(w)(() => new ResourceReconciliationService().reconcile(w.client, w.orgId, region, new Set(), [type as any])),
  state: resourceState,
});

const CASES: FenceCase[] = [
  reconcileCase('F1 Resource Explorer reconcile', 'ec2', HOME, `arn:aws:ec2:${HOME}:*:instance/i-1234567890abcdef0`),
  reconcileCase('F2 S3 reconcile', 's3', null, 'arn:aws:s3:::m4b-fence-bucket'),
  reconcileCase('F3 CloudFront reconcile', 'cloudfront', null, `arn:aws:cloudfront::${ACCOUNT}:distribution/EPLACEHOLDER`),
  reconcileCase('F4 EBS reconcile', 'ebs', HOME, `arn:aws:ec2:${HOME}:*:volume/vol-0123456789abcdef0`),
  {
    id: 'F5 resource upserts (one batch)',
    kind: 'scan',
    seed: async () => ({}),
    act: (w) =>
      svc.upsertFenced(
        fencedOn(w),
        [{
          organization_id: w.orgId, resource_arn: 'arn:aws:s3:::m4b-upserted', resource_id: 'm4b-upserted', resource_name: 'm4b-upserted',
          resource_type: 's3', region: HOME, tags: {}, metadata: {}, status: 'unknown',
        }],
        (r: any) => svc.upsertResource(w.client, r),
        { created: 0, updated: 0 }
      ),
    state: resourceState,
  },
  {
    id: 'F6 DynamoDB enrichment',
    kind: 'scan',
    seed: async (orgId) => {
      await insertResource(orgId, { arn: `arn:aws:dynamodb:${HOME}:${ACCOUNT}:table/m4b-table`, type: 'dynamodb', metadata: { source: 'resource-explorer' } });
      return {};
    },
    act: (w) => {
      jest.spyOn(dynamoTableUtil, 'describeDynamoDBTable').mockResolvedValue({ status: 'described', config: { billing_mode: 'PROVISIONED' } } as any);
      jest.spyOn(dynamoAutoscalingUtil, 'describeDynamoDBAutoscaling').mockResolvedValue({ status: 'unavailable', reason: 'test' } as any);
      return svc.enrichDynamoDBTables(
        w.orgId, w.client,
        { getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}) },
        [{ arn: `arn:aws:dynamodb:${HOME}:${ACCOUNT}:table/m4b-table`, resourceType: 'dynamodb', region: HOME, service: 'dynamodb', tags: {}, tagsState: 'observed' }],
        fencedOn(w)
      );
    },
    state: resourceState,
  },
  {
    id: 'F6 Aurora reclassification',
    kind: 'scan',
    seed: async (orgId) => {
      await insertResource(orgId, { arn: `arn:aws:rds:${HOME}:${ACCOUNT}:cluster:m4b-cluster`, type: 'aurora' });
      return {};
    },
    act: (w) => {
      const rds = new RDSClient({ region: HOME });
      (rds as any).send = jest.fn(async () => ({ DBClusters: [{ DBClusterIdentifier: 'm4b-cluster', Engine: 'mysql', DBClusterMembers: [] }] }));
      return svc.enrichAuroraClusters(
        w.orgId, w.client, rds,
        [{ arn: `arn:aws:rds:${HOME}:${ACCOUNT}:cluster:m4b-cluster`, resourceType: 'aurora', region: HOME, service: 'rds', tags: {}, tagsState: 'observed' }],
        fencedOn(w)
      );
    },
    state: resourceState,
  },
  {
    id: 'F7 per-resource framework evaluation (persistResourceEvaluation)',
    kind: 'scan',
    seed: async (orgId) => ({ resource: await insertResource(orgId, { arn: 'arn:aws:s3:::m4b-evaluated', type: 's3' }) }),
    act: async (w, seeded) => {
      const resource = (await pool.query(`SELECT * FROM aws_resources WHERE id = $1`, [seeded.resource])).rows[0];
      const scan = { storageAvailable: true, runs: [], persisted: 0, failed: 0, stateCounts: {} };
      const baseline = [{ severity: 'low', category: 'tagging', issue: 'm4b baseline finding', recommendation: 'tag it' }];
      return svc.persistResourceCompliance(w.client, w.orgId, new ComplianceScannerService(), resource, baseline, [], scan, w.session);
    },
    state: resourceState,
  },
  {
    id: 'F8 baseline findings when evaluations cannot be stored',
    kind: 'scan',
    seed: async (orgId) => ({ resource: await insertResource(orgId, { arn: 'arn:aws:s3:::m4b-baseline', type: 's3' }) }),
    act: async (w, seeded) => {
      const resource = (await pool.query(`SELECT * FROM aws_resources WHERE id = $1`, [seeded.resource])).rows[0];
      const scan = { storageAvailable: false, runs: [], persisted: 0, failed: 0, stateCounts: {} };
      const baseline = [{ severity: 'low', category: 'tagging', issue: 'm4b baseline finding', recommendation: 'tag it' }];
      return svc.persistResourceCompliance(w.client, w.orgId, new ComplianceScannerService(), resource, baseline, [], scan, w.session);
    },
    state: resourceState,
  },
  {
    id: 'F9 framework runs (start: abandon, prune, insert)',
    kind: 'scan',
    seed: async (orgId) => ({ job: await insertJob(orgId, 'completed', 0) }),
    act: (w, seeded) =>
      svc.startFrameworkEvaluation(w.client, w.orgId, seeded.job, resolveFrameworkApplicability({ status: 'ok', rows: [] }), fencedOn(w)),
    state: async (orgId) => (await pool.query(`SELECT framework, status FROM framework_evaluation_runs WHERE organization_id = $1 ORDER BY framework`, [orgId])).rows,
  },
  {
    id: 'F10 account findings upsert + resolve',
    kind: 'scan',
    seed: async (orgId) => {
      await pool.query(
        `INSERT INTO account_security_findings
           (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region, last_seen_at)
         VALUES ($1, 'm4b-key', 'networking', 'high', 't', 'r', 'sg', $2, NOW() - interval '1 day')`,
        [orgId, HOME]
      );
      return {};
    },
    act: (w) => w.session.watch(() => new AccountSecurityFindingsRepository().reconcileScan(w.orgId, new Date(), [], ['networking'], HOME, w.session.lease)),
    state: async (orgId) => (await pool.query(`SELECT finding_key, status FROM account_security_findings WHERE organization_id = $1`, [orgId])).rows,
  },
  {
    id: 'F11 orphan flags',
    kind: 'scan',
    seed: async (orgId) => ({ resource: await insertResource(orgId, { arn: 'arn:aws:s3:::m4b-orphan', type: 's3' }) }),
    act: (w, seeded) => fencedOn(w)(() => svc.writeOrphanFlags(w.client, w.orgId, [{ resource: { id: seeded.resource }, potential_savings: 5 }])),
    state: resourceState,
  },
  {
    id: 'F12 cost recommendation reconcile',
    kind: 'scan',
    seed: async (orgId) => {
      await seedRec(orgId, 'i-1234567890abcdef0', ISSUE_EC2_IDLE_INSTANCE);
      return {};
    },
    act: (w) =>
      w.session.watch(() =>
        new CostRecommendationsRepository().reconcileActiveRecommendations(
          w.orgId, [{ issue: ISSUE_EC2_IDLE_INSTANCE, success: true, recommendations: [] }], { homeRegion: HOME }, w.session.lease
        )
      ),
    state: recState,
  },
  {
    id: 'F13 Reserved Instance replacement',
    kind: 'scan',
    seed: async (orgId) => {
      await seedRec(orgId, 'ri-opportunity-m5.large', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY);
      return {};
    },
    act: (w) => w.session.watch(() => new CostRecommendationsRepository().replaceReservedInstanceRecommendations(w.orgId, { homeRegion: HOME }, [], w.session.lease)),
    state: recState,
  },
  {
    id: 'F14 SOC 2 evidence (job lease)',
    kind: 'job',
    seed: async (orgId) => {
      await pool.query(
        `INSERT INTO soc2_evidence_observations (organization_id, criterion_id, resource_arn, resource_type, provenance, result, observed_at, collected_at, source, explanation)
         VALUES ($1, 'CC6.1-encryption', 'arn:aws:s3:::m4b-soc2', 's3', 'OBSERVED', 'SUPPORTS', NOW(), NOW(), '{}', 'm4b fence test')`,
        [orgId]
      );
      return {};
    },
    act: (w) =>
      w.session.watch(() =>
        new Soc2EvidenceRepository(pool).persistComputation(
          w.orgId, [], [{ criterionId: 'CC6.1-encryption', resourceType: 's3', currentResourceArns: [] }], [], w.session.lease
        )
      ),
    state: async (orgId) => (await pool.query(`SELECT resource_arn FROM soc2_evidence_observations WHERE organization_id = $1`, [orgId])).rows,
  },
  {
    id: 'F15 job link on the lease row',
    kind: 'scan',
    seed: async (orgId) => ({ job: await insertJob(orgId, 'running', 0) }),
    act: (w, seeded) => linkScanLeaseJob(w.client, w.session.lease, seeded.job as string),
    state: async (orgId) => (await pool.query(`SELECT job_id FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows,
    refusesWith: 'false',
  },
  {
    id: 'F16 race-safe recovery of interrupted jobs',
    kind: 'scan',
    seed: async (orgId) => {
      await insertJob(orgId, 'running', 2);
      return {};
    },
    act: (w) => svc.recoverInterruptedJobs(w.client, w.session, w.orgId),
    state: jobState,
  },
];

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    for (const table of ['soc2_evidence_observations', 'account_security_findings', 'cost_recommendations', 'framework_evaluation_runs', 'aws_resources', 'resource_discovery_jobs', 'aws_scan_leases', 'job_leases']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]);
    }
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('L3: a stale fencing token at every fenced mutation writes nothing (two connections, committed rows)', () => {
  it.each(CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    // Control: a live lease changes the rows.
    const live = await worker(c.kind, 'fresh');
    try {
      const seeded = await c.seed(live.orgId);
      const before = await c.state(live.orgId);
      const result = await c.act(live, seeded);
      if (c.refusesWith === 'false') expect(result).toBe(true);
      expect(await c.state(live.orgId)).not.toEqual(before);
    } finally {
      await live.done();
    }

    // Stale: A's token after B's takeover changes nothing, and A learns it lost the lease.
    const stale = await worker(c.kind, 'stale');
    try {
      const seeded = await c.seed(stale.orgId);
      const before = await c.state(stale.orgId);
      if (c.refusesWith === 'false') {
        expect(await c.act(stale, seeded)).toBe(false);
      } else {
        await expect(c.act(stale, seeded)).rejects.toBeInstanceOf(LeaseLostError);
        expect(stale.session.lost).toBe(true);
        expect(() => stale.session.checkpoint()).toThrow(LeaseLostError);
      }
      expect(await c.state(stale.orgId)).toEqual(before);
    } finally {
      await stale.done();
    }
  }, 30_000);

  it('F16 control: recovery writes exactly the approved text', async () => {
    const live = await worker('scan', 'fresh');
    try {
      await insertJob(live.orgId, 'running', 2);
      expect(await svc.recoverInterruptedJobs(live.client, live.session, live.orgId)).toBe(1);
      expect(await jobState(live.orgId)).toEqual([{ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE }]);
    } finally {
      await live.done();
    }
  });
});

// ---------------------------------------------------------------------------

/** Source text without comments, so prose cannot satisfy a check. */
function source(relative: string): string {
  return fs
    .readFileSync(path.join(__dirname, '..', '..', relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The lines of `text` around each match of `pattern`, as one string per match. */
function contexts(text: string, pattern: RegExp, before = 3): string[] {
  const lines = text.split('\n');
  return lines.flatMap((line, i) => (pattern.test(line) ? [lines.slice(Math.max(0, i - before), i + 1).join('\n')] : []));
}

/** The destructive repository methods (§5.1) and the 0-based position of their required lease. */
const DESTRUCTIVE_METHODS: Record<string, number> = {
  reconcileActiveRecommendations: 3,
  replaceReservedInstanceRecommendations: 3,
  reconcileScan: 5,
  persistComputation: 4,
  computeAndPersistEvidence: 1,
  persistResourceEvaluation: 1, // the `lease` property of its input
  recordRegionList: 1, // multi-region M5a, F17
};

/**
 * Every call of a DESTRUCTIVE_METHODS method in backend/src outside the tests,
 * from the TypeScript syntax tree (all matches, not one per file), with the
 * source text of the lease it passes (null when there is none).
 */
function destructiveCallSites(): { file: string; line: number; method: string; lease: string | null }[] {
  const root = path.join(__dirname, '..', '..');
  const files = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.includes('__tests__'));
  const sites: { file: string; line: number; method: string; lease: string | null }[] = [];
  for (const file of files) {
    const tree = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
        if (Object.prototype.hasOwnProperty.call(DESTRUCTIVE_METHODS, method)) {
          const argument = node.arguments[DESTRUCTIVE_METHODS[method]];
          let lease: string | null = null;
          if (method === 'persistResourceEvaluation') {
            const property = argument && ts.isObjectLiteralExpression(argument)
              ? argument.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'lease')
              : undefined;
            lease = property && ts.isPropertyAssignment(property) ? property.initializer.getText(tree) : null;
          } else {
            lease = argument ? argument.getText(tree) : null;
          }
          sites.push({ file: file.split(path.sep).join('/'), line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, method, lease });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return sites;
}

describe('L3 static: every destructive step of a scan is fenced', () => {
  const discovery = source('services/awsResourceDiscovery.ts');

  it.each([
    ['F1-F4 every reconcile() call', /this\.reconciliation\.reconcile\(/, /fenced\(/],
    ['F5 every upsertResource / upsertGenericResource call runs inside upsertFenced', /this\.upsert(Resource|GenericResource)\(client/, /upsertFenced\(/],
    ['F6 enrichments get the fence', /this\.enrich(DynamoDBTables|AuroraClusters)\(/, /, fenced\)/],
    ['F8 baseline / reconciliation-marker writes', /(writeBaselinePreservingFrameworkFindings|recordReconciliationRequired)\(client/, /fenced\(/],
    ['F9 framework run start / heartbeat / finish', /(startFrameworkRun|heartbeatFrameworkRun|finishFrameworkRun)\(client/, /fenced\(/],
    ['F11 orphan flags', /this\.writeOrphanFlags\(/, /fenced\(/],
  ])('%s', (_name, call, wrapper) => {
    // F16 (recovery) is pinned by the R5 check below.
    const sites = contexts(discovery, call, 12);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site).toMatch(wrapper);
  });

  it('F7 F10 F12 F13 F14: EVERY call of a destructive repository method in backend/src passes a lease', () => {
    const sites = destructiveCallSites();
    // A new caller must be added here, so a reviewer sees it.
    expect(sites.map(({ file, method }) => `${file} ${method}`).sort()).toEqual(
      [
        'controllers/cost-recommendations.controller.ts reconcileActiveRecommendations',
        'controllers/cost-recommendations.controller.ts replaceReservedInstanceRecommendations',
        'jobs/resourceDiscovery.job.ts computeAndPersistEvidence',
        'services/awsResourceDiscovery.ts persistResourceEvaluation',
        'services/awsResourceDiscovery.ts recordRegionList',
        'services/awsResourceDiscovery.ts reconcileActiveRecommendations',
        'services/awsResourceDiscovery.ts reconcileScan',
        'services/awsResourceDiscovery.ts replaceReservedInstanceRecommendations',
        'services/soc2-evidence.service.ts persistComputation',
      ].sort()
    );
    for (const site of sites) expect(site).toMatchObject({ lease: expect.stringMatching(/^(lease|jobLease|(session|scan|lease)\.lease)$/) });
  });

  it('the repositories fence right after BEGIN, unconditionally', () => {
    for (const file of [
      'repositories/cost-recommendations.repository.ts',
      'repositories/account-security-findings.repository.ts',
      'repositories/soc2-evidence.repository.ts',
      'repositories/framework-evaluations.repository.ts',
    ]) {
      const text = source(file);
      const sites = contexts(text, /beginFenced\(/, 3);
      expect(sites.length).toBeGreaterThan(0);
      for (const site of sites) expect(site).toMatch(/BEGIN/);
      expect(text).not.toMatch(/if \([\w.]*lease\) await beginFenced/);
    }
  });

  it('R5: every job-row UPDATE names its own row by id, except the one fenced recovery (which needs the lease)', () => {
    const files = fs
      .readdirSync(path.join(__dirname, '..', '..'), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts') && !file.includes('__tests__'));
    const statements = files.flatMap((file) =>
      (source(file).match(/UPDATE resource_discovery_jobs[^`]*`/g) ?? []).map((sql) => ({ file, sql }))
    );
    expect(statements.length).toBeGreaterThan(0);
    const others = statements.filter(({ sql }) => !/WHERE id = \$\d/.test(sql));
    expect(others).toEqual([
      { file: 'services/awsResourceDiscovery.ts', sql: expect.stringMatching(/status IN \('running', 'pending'\) AND created_at < \$2/) },
    ]);
    // ... and that one runs only inside the session's fenced transaction, after acquisition.
    expect(discovery).toMatch(/const recovered = await session\.fenced\(client, async \(\) => \{\s*const result = await client\.query\(\s*`UPDATE resource_discovery_jobs/);
    expect(discovery.indexOf('await this.recoverInterruptedJobs(')).toBeGreaterThan(discovery.indexOf('await openScanSession('));
  });
});
