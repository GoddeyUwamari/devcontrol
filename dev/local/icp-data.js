/**
 * The local demo workspace: an invented US Series A SaaS ("Example SaaS
 * Inc.") with ~330 AWS resources across two placeholder accounts, ~40
 * services in six teams, and the tags a company without a DevOps team really
 * has. Pure and deterministic: generateIcpData({ seed, anchor }) returns the
 * same rows for the same seed and anchor day, and touches no database, clock
 * or network. dev/local/seed-icp.js writes it.
 *
 * Everything here is invented. Account IDs are the zero-padded placeholders
 * 000000000001 and 000000000002; resource IDs are visibly patterned
 * (i-00000000000000002); people are @example.com; no name is a real company's.
 *
 * Rows mirror what the application itself writes, so screens render them as
 * they would real data: ARNs, metadata keys and statuses follow
 * awsResourceDiscovery.ts (EC2 and EBS ARNs carry `*` for the account, as
 * discovery writes them), recommendation issues and resource types follow
 * cost-optimization.service.ts, and finding keys follow
 * account-security-findings.repository.ts.
 *
 * Resource states the Services redesign has to show:
 *   assigned   service_id set (the service's team as team_id);
 *   suggested  unassigned, but a service tag names a service -- often
 *              misspelled, re-cased or under another key;
 *   shared     unassigned, tagged as shared infrastructure;
 *   untagged   unassigned, nothing to go on (S3 and CloudFront always: their
 *              discovery does not collect tags).
 * The API today only distinguishes assigned from unassigned; the other two
 * exist in the tags alone.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script run by plain node */
const crypto = require('crypto');

const DEFAULT_SEED = 'devcontrol-local-icp-v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const ORGANIZATION = {
  name: 'Example SaaS Inc.',
  slug: 'example-saas',
  description: 'Invented Series A SaaS for the local demo. Every value is made up.',
  // TIER_LIMITS.pro in backend/src/middleware/subscription.middleware.ts.
  tier: 'pro',
  maxServices: 100,
  maxUsers: 10,
  maxDeploymentsPerMonth: 500,
};

/** The one seeded login; the others cannot log in (their password is discarded). */
const DEMO_EMAIL = 'founder@example.com';

const PEOPLE = [
  { email: DEMO_EMAIL, name: 'Avery Founder', role: 'owner' },
  { email: 'cto@example.com', name: 'Jordan Placeholder', role: 'admin' },
  { email: 'platform.lead@example.com', name: 'Sam Sample', role: 'admin' },
  { email: 'payments.lead@example.com', name: 'Riley Example', role: 'member' },
  { email: 'growth.lead@example.com', name: 'Casey Demo', role: 'member' },
  { email: 'data.lead@example.com', name: 'Morgan Fictional', role: 'member' },
  { email: 'mobile.lead@example.com', name: 'Quinn Invented', role: 'member' },
  { email: 'finance@example.com', name: 'Drew Madeup', role: 'viewer' },
];

const ACCOUNTS = { production: '000000000001', staging: '000000000002' };

// Where resources live: production in us-east-1 with a us-west-2 DR copy,
// staging mostly us-east-1 plus a small eu-west-1 footprint for one EU customer.
const PLACEMENTS = [
  { account: ACCOUNTS.production, region: 'us-east-1', env: 'production', weight: 64 },
  { account: ACCOUNTS.production, region: 'us-west-2', env: 'production', weight: 12 },
  { account: ACCOUNTS.staging, region: 'us-east-1', env: 'staging', weight: 20 },
  { account: ACCOUNTS.staging, region: 'eu-west-1', env: 'staging', weight: 4 },
];

const TEAMS = [
  { name: 'Platform', slug: 'platform', lead: 'platform.lead@example.com', typo: 'platfrom' },
  { name: 'Payments', slug: 'payments', lead: 'payments.lead@example.com', typo: 'paymnets' },
  { name: 'Growth', slug: 'growth', lead: 'growth.lead@example.com', typo: 'grwoth' },
  { name: 'Core API', slug: 'core-api', lead: 'cto@example.com', typo: 'core-apl' },
  { name: 'Data', slug: 'data', lead: 'data.lead@example.com', typo: 'dtaa' },
  { name: 'Mobile', slug: 'mobile', lead: 'mobile.lead@example.com', typo: 'moblie' },
];

/** [name, template, team slug or null for no owner, typo or null]. */
const SERVICES = [
  ['api-gateway', 'api', 'platform', 'api-gatway'],
  ['auth-service', 'api', 'platform', 'auth-servce'],
  ['ci-runners', 'worker', 'platform', null],
  ['observability-stack', 'worker', 'platform', 'observabilty-stack'],
  ['bastion', 'worker', 'platform', null],
  ['edge-cdn', 'frontend', 'platform', null],
  ['shared-postgres', 'database', 'platform', null],
  ['billing-api', 'api', 'payments', 'biling-api'],
  ['checkout-api', 'api', 'payments', 'chekout-api'],
  ['invoice-worker', 'worker', 'payments', 'invoice-wroker'],
  ['payment-webhooks', 'api', 'payments', null],
  ['ledger-sync', 'worker', 'payments', null],
  ['fraud-scorer', 'worker', 'payments', 'fraud-socrer'],
  ['payouts-scheduler', 'worker', 'payments', null],
  ['marketing-site', 'frontend', 'growth', 'marketting-site'],
  ['signup-funnel', 'frontend', 'growth', null],
  ['email-campaigns', 'worker', 'growth', 'email-campains'],
  ['referral-service', 'api', 'growth', null],
  ['ab-testing', 'api', 'growth', null],
  ['core-api', 'api', 'core-api', 'core-apii'],
  ['search-service', 'api', 'core-api', 'serach-service'],
  ['notifications', 'worker', 'core-api', 'notifcations'],
  ['file-uploads', 'api', 'core-api', null],
  ['pdf-renderer', 'worker', 'core-api', null],
  ['webhooks-dispatcher', 'worker', 'core-api', null],
  ['graphql-gateway', 'api', 'core-api', null],
  ['etl-pipeline', 'worker', 'data', 'etl-pipline'],
  ['warehouse-loader', 'worker', 'data', null],
  ['event-collector', 'api', 'data', 'event-colector'],
  ['ml-recommendations', 'worker', 'data', null],
  ['reporting-api', 'api', 'data', null],
  ['data-exports', 'worker', 'data', null],
  ['mobile-bff', 'api', 'mobile', 'mobile-bf'],
  ['push-notifications', 'worker', 'mobile', null],
  ['mobile-config', 'api', 'mobile', null],
  ['app-version-check', 'api', 'mobile', null],
  // No owner: no team and an empty owner (services.owner is NOT NULL).
  ['legacy-cron-jobs', 'worker', null, 'legacy-cron'],
  ['old-admin-panel', 'frontend', null, null],
  ['hackathon-chatbot', 'api', null, null],
  ['temp-migration-tool', 'worker', null, null],
];

/** Registered, but nothing in AWS points at them yet. */
const SERVICES_WITHOUT_RESOURCES = new Set(['ab-testing', 'temp-migration-tool']);

/** Values a "this is shared" service tag takes in the wild. */
const SHARED_SERVICE_VALUES = ['shared', 'Shared', 'shared-vpc', 'shared-infra', 'common', 'platform-shared'];

// ---------------------------------------------------------------- randomness

/** A deterministic PRNG: sha256(seed:counter), 52 bits per draw. */
function makeRng(seed) {
  let counter = 0;
  const next = () => {
    const hex = crypto.createHash('sha256').update(`${seed}:${counter++}`).digest('hex');
    return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted: (list) => {
      const total = list.reduce((sum, item) => sum + item.weight, 0);
      let roll = next() * total;
      for (const item of list) {
        roll -= item.weight;
        if (roll < 0) return item;
      }
      return list[list.length - 1];
    },
  };
}

/** A UUID derived from the seed and a key, so ids are stable across runs. */
function uuidFor(seed, key) {
  const hex = crypto.createHash('sha256').update(`${seed}|${key}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A visibly patterned AWS-style id: prefix, then `n` in hex left-padded with zeros. */
function patternedId(prefix, n, width) {
  return `${prefix}${n.toString(16).padStart(width, '0')}`;
}

const round2 = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------- tags

const KEY_VARIANTS = {
  team: ['team', 'Team', 'TEAM', 'team ', 'owner-team', 'Squad'],
  service: ['service', 'Service', 'app', 'App', 'service-name', 'Service '],
  env: ['env', 'Environment', 'environment', 'stage', 'Env'],
  owner: ['owner', 'Owner', 'contact', 'created-by'],
};

const ENV_VALUES = {
  production: ['prod', 'production', 'Prod', 'prd', 'PRODUCTION', 'live'],
  staging: ['staging', 'stg', 'Staging', 'stage', 'dev'],
};

function teamValue(rng, team) {
  return rng.pick([
    team.slug,
    team.slug,
    team.name,
    team.name.toUpperCase(),
    `${team.slug}-team`,
    ` ${team.slug}`,
    team.typo,
  ]);
}

function serviceValue(rng, service) {
  const variants = [
    service.name,
    service.name,
    service.name.replace(/-/g, '_'),
    service.name.replace(/(^|-)(\w)/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`),
    service.name.replace(/-(api|service|worker)$/, ''),
  ];
  if (service.typo) variants.push(service.typo, service.typo);
  return rng.pick(variants);
}

function ownerValue(rng, team) {
  return rng.pick([
    team ? team.lead : 'cto@example.com',
    team ? team.lead.toUpperCase() : 'CTO@EXAMPLE.COM',
    'former.engineer@example.com',
    'contractor-2023@example.com',
    `@${team ? team.slug : 'someone'}`,
    'unknown',
  ]);
}

/**
 * The tags of one resource: what its state calls for, then the drift real
 * accounts accumulate (key case, synonyms, stray tool tags, missing keys).
 */
function buildTags(rng, { state, service, team, env, name }) {
  const tags = {};
  if (name && rng.chance(0.9)) tags[rng.chance(0.93) ? 'Name' : 'name'] = name;

  if (state === 'assigned' || state === 'suggested') {
    const keepService = state === 'suggested' || rng.chance(0.7);
    const keepTeam = team && rng.chance(state === 'suggested' ? 0.65 : 0.75);
    if (keepService) tags[rng.pick(KEY_VARIANTS.service)] = serviceValue(rng, service);
    if (keepTeam) tags[rng.pick(KEY_VARIANTS.team)] = teamValue(rng, team);
  } else if (state === 'shared') {
    tags[rng.pick(KEY_VARIANTS.service)] = rng.pick(SHARED_SERVICE_VALUES);
    if (rng.chance(0.8)) tags[rng.pick(KEY_VARIANTS.team)] = teamValue(rng, TEAMS[0]);
  }

  if (state !== 'untagged' ? rng.chance(0.8) : rng.chance(0.25)) tags[rng.pick(KEY_VARIANTS.env)] = rng.pick(ENV_VALUES[env]);
  if (state !== 'untagged' && rng.chance(0.45)) tags[rng.pick(KEY_VARIANTS.owner)] = ownerValue(rng, team);
  if (rng.chance(0.3)) tags[rng.pick(['ManagedBy', 'managed-by', 'managed_by'])] = rng.pick(['terraform', 'Terraform', 'console', 'cdk']);
  if (rng.chance(0.15)) tags[rng.pick(['CostCenter', 'cost-center', 'costcenter'])] = rng.pick(['eng', 'ENG-100', 'r&d', 'marketing']);
  if (rng.chance(0.12)) tags['aws:cloudformation:stack-name'] = `${(service && service.name) || 'shared'}-stack`;
  return tags;
}

// ---------------------------------------------------------------- resource types

// On-demand us-east-1 list prices, rounded: plausible, not quoted.
const EC2_TYPES = [
  { type: 't3.small', monthly: 15, weight: 3 },
  { type: 't3.medium', monthly: 30, weight: 8 },
  { type: 't3.large', monthly: 61, weight: 10 },
  { type: 'm5.large', monthly: 70, weight: 14 },
  { type: 'm5.xlarge', monthly: 140, weight: 14 },
  { type: 'm6i.2xlarge', monthly: 280, weight: 8 },
  { type: 'c5.xlarge', monthly: 124, weight: 8 },
  { type: 'c5.2xlarge', monthly: 248, weight: 6 },
  { type: 'r5.xlarge', monthly: 184, weight: 6 },
  { type: 'm4.xlarge', monthly: 146, weight: 3 },
  { type: 'm5.2xlarge', monthly: 280, weight: 6 },
  { type: 'r5.2xlarge', monthly: 368, weight: 3 },
];
const RDS_CLASSES = [
  { type: 'db.t3.medium', monthly: 60, weight: 2 },
  { type: 'db.m5.large', monthly: 125, weight: 4 },
  { type: 'db.r5.large', monthly: 175, weight: 3 },
  { type: 'db.r6g.xlarge', monthly: 330, weight: 4 },
  { type: 'db.m5.2xlarge', monthly: 500, weight: 2 },
  { type: 'db.r5.2xlarge', monthly: 700, weight: 1 },
];
const EBS_TYPES = [
  { type: 'gp3', perGb: 0.08, weight: 6 },
  { type: 'gp2', perGb: 0.1, weight: 3 },
  { type: 'io1', perGb: 0.125, weight: 1 },
];

/** type -> count and how to make one. `make` returns the type-specific part of a row. */
const RESOURCE_TYPES = [
  {
    type: 'ec2', count: 76, tagged: true,
    make: (rng, ctx) => {
      const spec = rng.weighted(EC2_TYPES);
      const id = patternedId('i-', ctx.n, 17);
      const stopped = rng.chance(0.08);
      const publicIp = !stopped && rng.chance(0.15);
      return {
        resource_arn: `arn:aws:ec2:${ctx.region}:*:instance/${id}`,
        resource_id: id,
        resource_name: ctx.name || id,
        status: stopped ? 'stopped' : 'running',
        cost: stopped ? 0 : spec.monthly,
        is_encrypted: rng.chance(0.85),
        is_public: publicIp,
        has_backup: null,
        metadata: {
          instance_type: spec.type,
          vpc_id: patternedId('vpc-', ctx.vpc, 17),
          availability_zone: `${ctx.region}${rng.pick(['a', 'b', 'c'])}`,
          launch_time: new Date(ctx.discoveredAt - rng.int(0, 200) * DAY_MS).toISOString(),
          ...(publicIp ? { public_ip: `203.0.113.${ctx.n % 250}` } : {}),
        },
      };
    },
  },
  {
    type: 'ebs', count: 81, tagged: true,
    make: (rng, ctx) => {
      const spec = rng.weighted(EBS_TYPES);
      const size = rng.pick([20, 30, 50, 100, 100, 200, 250, 500, 1000]);
      const id = patternedId('vol-', ctx.n, 17);
      const unattached = rng.chance(0.13);
      return {
        resource_arn: `arn:aws:ec2:${ctx.region}:*:volume/${id}`,
        resource_id: id,
        resource_name: ctx.name || id,
        status: unattached ? 'available' : 'in-use',
        cost: size * spec.perGb,
        is_encrypted: rng.chance(0.82),
        is_public: false,
        has_backup: rng.chance(0.4),
        metadata: { volume_type: spec.type, size_gb: size, availability_zone: `${ctx.region}a` },
      };
    },
  },
  {
    type: 'rds', count: 15, tagged: true,
    make: (rng, ctx) => {
      const spec = rng.weighted(RDS_CLASSES);
      const multiAz = ctx.env === 'production' && rng.chance(0.6);
      const id = ctx.slugName;
      return {
        resource_arn: `arn:aws:rds:${ctx.region}:${ctx.account}:db:${id}`,
        resource_id: id,
        resource_name: ctx.name || id,
        status: 'available',
        cost: spec.monthly * (multiAz ? 2 : 1) + rng.int(10, 80),
        is_encrypted: rng.chance(0.9),
        is_public: false,
        has_backup: rng.chance(0.85),
        metadata: {
          db_instance_class: spec.type,
          engine: rng.pick(['postgres', 'postgres', 'postgres', 'mysql']),
          engine_version: rng.pick(['14.10', '15.5', '13.13', '8.0.35']),
          allocated_storage: rng.pick([20, 100, 200, 500]),
          multi_az: multiAz,
          publicly_accessible: false,
        },
      };
    },
  },
  {
    type: 's3', count: 45, tagged: false,
    make: (rng, ctx) => {
      const bucket = `example-saas-${ctx.slugName}`;
      return {
        resource_arn: `arn:aws:s3:::${bucket}`,
        resource_id: bucket,
        resource_name: bucket,
        // storedStatusFor('s3', ...): a bucket has no lifecycle status.
        status: 'not_applicable',
        cost: round2(rng.pick([1, 3, 8, 15, 30, 60, 120, 250]) * (0.8 + rng.next() * 0.4)),
        is_encrypted: rng.chance(0.92),
        is_public: rng.chance(0.04),
        has_backup: null,
        metadata: { tags_state: 'unavailable' },
      };
    },
  },
  {
    type: 'lambda', count: 55, tagged: true,
    make: (rng, ctx) => {
      const fn = ctx.slugName;
      return {
        resource_arn: `arn:aws:lambda:${ctx.region}:${ctx.account}:function:${fn}`,
        resource_id: fn,
        resource_name: fn,
        status: 'Active',
        cost: round2(rng.pick([0.4, 1.2, 3, 6, 15, 35, 90])),
        is_encrypted: true,
        is_public: false,
        has_backup: null,
        metadata: { tags_state: 'observed', runtime: rng.pick(['nodejs20.x', 'nodejs18.x', 'python3.12', 'python3.9']), memory_size: rng.pick([128, 256, 512, 1024]) },
      };
    },
  },
  {
    type: 'load-balancer', count: 12, tagged: true,
    make: (rng, ctx) => {
      const lb = ctx.slugName.slice(0, 28);
      return {
        resource_arn: `arn:aws:elasticloadbalancing:${ctx.region}:${ctx.account}:loadbalancer/app/${lb}/${patternedId('', ctx.n, 16)}`,
        resource_id: lb,
        resource_name: lb,
        status: 'active',
        cost: round2(rng.pick([18, 22, 30, 45, 60])),
        is_encrypted: null,
        is_public: rng.chance(0.6),
        has_backup: null,
        metadata: { tags_state: 'observed', type: 'application', scheme: 'internet-facing' },
      };
    },
  },
  {
    type: 'ecs', count: 18, tagged: true,
    make: (rng, ctx) => ({
      resource_arn: `arn:aws:ecs:${ctx.region}:${ctx.account}:service/main-${ctx.env}/${ctx.slugName}`,
      resource_id: ctx.slugName,
      resource_name: ctx.slugName,
      // Resource Explorer reports presence, not state: storedStatusFor(type, 'unknown').
      status: 'unknown',
      cost: rng.pick([90, 140, 220, 380, 520]),
      is_encrypted: null,
      is_public: false,
      has_backup: null,
      metadata: { source: 'resource-explorer', service: 'ecs', tags_state: 'observed' },
    }),
  },
  {
    type: 'cloudfront', count: 4, tagged: false, global: true,
    make: (rng, ctx) => {
      const id = `E${patternedId('', ctx.n, 13).toUpperCase()}`;
      return {
        resource_arn: `arn:aws:cloudfront::${ctx.account}:distribution/${id}`,
        resource_id: id,
        resource_name: `${ctx.slugName}.example.com`,
        // mapCloudFrontStatus('Deployed').
        status: 'active',
        cost: rng.pick([25, 60, 140, 380]),
        is_encrypted: null,
        is_public: true,
        has_backup: null,
        metadata: { tags_state: 'unavailable' },
      };
    },
  },
  {
    type: 'elasticache', count: 4, tagged: true,
    make: (rng, ctx) => ({
      resource_arn: `arn:aws:elasticache:${ctx.region}:${ctx.account}:cluster:${ctx.slugName}`,
      resource_id: ctx.slugName,
      resource_name: ctx.slugName,
      status: 'unknown',
      cost: rng.pick([95, 160, 240, 330]),
      is_encrypted: rng.chance(0.75),
      is_public: false,
      has_backup: null,
      metadata: { source: 'resource-explorer', service: 'elasticache', tags_state: 'observed' },
    }),
  },
  {
    type: 'sqs', count: 10, tagged: true,
    make: (rng, ctx) => ({
      resource_arn: `arn:aws:sqs:${ctx.region}:${ctx.account}:${ctx.slugName}`,
      resource_id: ctx.slugName,
      resource_name: ctx.slugName,
      status: 'unknown',
      cost: rng.pick([0.4, 1, 3, 8, 20]),
      is_encrypted: rng.chance(0.7),
      is_public: false,
      has_backup: null,
      metadata: { source: 'resource-explorer', service: 'sqs', tags_state: 'observed' },
    }),
  },
  {
    type: 'sns', count: 6, tagged: true,
    make: (rng, ctx) => ({
      resource_arn: `arn:aws:sns:${ctx.region}:${ctx.account}:${ctx.slugName}`,
      resource_id: ctx.slugName,
      resource_name: ctx.slugName,
      status: 'not_applicable',
      cost: rng.pick([0.5, 1, 2, 6]),
      is_encrypted: rng.chance(0.5),
      is_public: false,
      has_backup: null,
      metadata: { source: 'resource-explorer', service: 'sns', tags_state: 'observed' },
    }),
  },
  {
    type: 'dynamodb', count: 6, tagged: true,
    make: (rng, ctx) => ({
      resource_arn: `arn:aws:dynamodb:${ctx.region}:${ctx.account}:table/${ctx.slugName}`,
      resource_id: ctx.slugName,
      resource_name: ctx.slugName,
      status: 'unknown',
      cost: rng.pick([12, 35, 80, 160, 420]),
      is_encrypted: true,
      is_public: false,
      has_backup: rng.chance(0.5),
      metadata: { source: 'resource-explorer', service: 'dynamodb', tags_state: 'observed' },
    }),
  },
];

const STATE_WEIGHTS = [
  { state: 'assigned', weight: 55 },
  { state: 'suggested', weight: 20 },
  { state: 'shared', weight: 10 },
  { state: 'untagged', weight: 15 },
];

const PURPOSES = {
  ec2: ['app', 'worker', 'web', 'batch', 'jobs'],
  ebs: ['data', 'root', 'logs', 'scratch'],
  rds: ['db', 'primary', 'replica'],
  s3: ['assets', 'uploads', 'logs', 'backups', 'exports', 'artifacts'],
  lambda: ['handler', 'cron', 'consumer', 'resize', 'notify', 'sync'],
  'load-balancer': ['alb', 'public-alb', 'internal-alb'],
  ecs: ['svc', 'web', 'worker'],
  cloudfront: ['cdn', 'static', 'assets'],
  elasticache: ['cache', 'sessions'],
  sqs: ['queue', 'dlq', 'events'],
  sns: ['alerts', 'events'],
  dynamodb: ['table', 'state', 'events'],
};

const ENV_SHORT = { production: 'prod', staging: 'stg' };

// ---------------------------------------------------------------- generator

function generateIcpData({ seed = DEFAULT_SEED, anchor }) {
  if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) throw new Error('anchor must be a Date');
  // Every timestamp is an offset back from the anchor's UTC midnight: same day,
  // same rows, and nothing dated in the future.
  const day = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const at = (daysAgo, hoursAgo = 0) => new Date(day - daysAgo * DAY_MS - hoursAgo * 60 * 60 * 1000);
  const rng = makeRng(seed);
  const id = (key) => uuidFor(seed, key);

  const organization = {
    id: id('organization'),
    name: ORGANIZATION.name,
    slug: ORGANIZATION.slug,
    display_name: ORGANIZATION.name,
    description: ORGANIZATION.description,
    subscription_tier: ORGANIZATION.tier,
    max_services: ORGANIZATION.maxServices,
    max_users: ORGANIZATION.maxUsers,
    max_deployments_per_month: ORGANIZATION.maxDeploymentsPerMonth,
    created_at: at(420),
  };

  const users = PEOPLE.map((person, i) => ({
    id: id(`user:${person.email}`),
    email: person.email,
    full_name: person.name,
    role: person.role,
    created_at: at(420 - i * 30),
  }));
  const userByEmail = Object.fromEntries(users.map((u) => [u.email, u]));
  const memberships = users.map((u) => ({
    id: id(`membership:${u.email}`),
    organization_id: organization.id,
    user_id: u.id,
    role: u.role,
    invited_by: u.email === DEMO_EMAIL ? null : userByEmail[DEMO_EMAIL].id,
    joined_at: u.created_at,
  }));

  const teams = TEAMS.map((t, i) => ({
    ...t,
    id: id(`team:${t.slug}`),
    organization_id: organization.id,
    description: `${t.name} team (invented)`,
    owner: t.lead,
    members: [t.lead],
    slack_channel: `#team-${t.slug}`,
    created_at: at(400 - i * 10),
  }));
  const teamBySlug = Object.fromEntries(teams.map((t) => [t.slug, t]));

  const services = SERVICES.map(([name, template, teamSlug, typo], i) => ({
    id: id(`service:${name}`),
    organization_id: organization.id,
    name,
    template,
    typo,
    team: teamSlug ? teamBySlug[teamSlug] : null,
    team_id: teamSlug ? teamBySlug[teamSlug].id : null,
    owner: teamSlug ? teamBySlug[teamSlug].lead : '',
    status: 'active',
    description: teamSlug ? `${name} (invented)` : `${name}: nobody claims this one`,
    created_at: at(380 - i * 7),
  }));
  const resourceOwners = services.filter((s) => !SERVICES_WITHOUT_RESOURCES.has(s.name));

  const resources = [];
  const usedNames = new Set();
  let serial = 0;
  for (const spec of RESOURCE_TYPES) {
    for (let i = 0; i < spec.count; i++) {
      serial += 1;
      const placement = spec.global ? PLACEMENTS[0] : rng.weighted(PLACEMENTS);
      let state = rng.weighted(STATE_WEIGHTS).state;
      // No tags are collected for these types, so only assignment can place them.
      if (!spec.tagged && state !== 'assigned') state = rng.chance(0.4) ? 'assigned' : 'untagged';
      const service = state === 'shared' ? null : rng.pick(resourceOwners);
      const team = service ? service.team : state === 'shared' ? TEAMS[0] : null;

      const base = state === 'shared' ? 'shared' : service.name;
      let slugName = `${base}-${rng.pick(PURPOSES[spec.type])}-${ENV_SHORT[placement.env]}`;
      for (let n = 2; usedNames.has(`${spec.type}:${slugName}`); n++) slugName = `${slugName.replace(/-\d+$/, '')}-${n}`;
      usedNames.add(`${spec.type}:${slugName}`);

      const discoveredDaysAgo = rng.int(3, 400);
      const ctx = {
        n: serial,
        vpc: placement.account === ACCOUNTS.production ? 1 : 2,
        region: placement.region,
        account: placement.account,
        env: placement.env,
        slugName,
        // Untagged instances and volumes often have no Name either.
        name: ['ec2', 'ebs', 'rds'].includes(spec.type) && !(state === 'untagged' && rng.chance(0.5)) ? slugName : null,
        discoveredAt: at(discoveredDaysAgo).getTime(),
      };
      const made = spec.make(rng, ctx);
      const tags = spec.tagged ? buildTags(rng, { state, service, team, env: placement.env, name: ctx.name }) : {};
      resources.push({
        id: id(`resource:${made.resource_arn}`),
        organization_id: organization.id,
        resource_arn: made.resource_arn,
        resource_id: made.resource_id,
        resource_name: made.resource_name,
        resource_type: spec.type,
        region: placement.region,
        account: placement.account,
        state,
        tags,
        metadata: made.metadata,
        status: made.status,
        estimated_monthly_cost: round2(made.cost),
        is_encrypted: made.is_encrypted,
        is_public: made.is_public,
        has_backup: made.has_backup,
        service_id: state === 'assigned' ? service.id : null,
        team_id: state === 'assigned' && service.team ? service.team.id : null,
        last_synced_at: at(0, 3),
        first_discovered_at: at(discoveredDaysAgo),
        suggested_service: state === 'suggested' ? service.name : null,
      });
    }
  }

  const recommendations = buildRecommendations({ rng, id, at, organization, resources });
  const findings = buildFindings({ rng, id, at, organization, resources, users: userByEmail });

  const discoveryJobs = [
    {
      id: id('discovery:failed'),
      organization_id: organization.id,
      status: 'failed',
      resources_discovered: 0,
      regions: ['us-east-1'],
      resource_types: RESOURCE_TYPES.map((t) => t.type),
      error_message: 'Rate exceeded (example throttling error)',
      started_at: at(2, 3),
      completed_at: at(2, 2.9),
      created_at: at(2, 3),
      cost_analysis_completed: false,
      compliance_scan_completed: false,
    },
    {
      id: id('discovery:completed'),
      organization_id: organization.id,
      status: 'completed',
      resources_discovered: resources.length,
      regions: [...new Set(PLACEMENTS.map((p) => p.region))],
      resource_types: RESOURCE_TYPES.map((t) => t.type),
      error_message: null,
      started_at: at(0, 3.1),
      completed_at: at(0, 3),
      created_at: at(0, 3.1),
      // The seeded recommendations stand for a finished cost analysis. No
      // compliance scan is seeded, so that one stays pending.
      cost_analysis_completed: true,
      compliance_scan_completed: false,
    },
  ];

  return { seed, organization, users, memberships, teams, services, resources, recommendations, findings, discoveryJobs };
}

function severityForSavings(monthly) {
  // calculateSeverity() in cost-optimization.service.ts.
  if (monthly >= 100) return 'HIGH';
  if (monthly >= 50) return 'MEDIUM';
  return 'LOW';
}

// metadata.savings_basis as cost-optimization.service.ts writes it: without
// one, a figure counts in no total and the UI shows "No dollar estimate". The
// S3 row is a ceiling, kept out of the estimated total.
const BASIS = {
  ebs: 'estimated: example seed data; provisioned size x EBS list price',
  gp2: 'estimated: example seed data; gp2-to-gp3 storage-rate difference',
  ec2Idle: 'estimated: example seed data; compute list price',
  lambda: 'estimated: example seed data; request and duration list price',
  s3Ceiling: 'ceiling: example seed data; assumes 100% of current Standard storage transitions to Standard-IA',
};

function buildRecommendations({ rng, id, at, organization, resources }) {
  const recs = [];
  const add = (resource, issue, resourceType, savings, description, metadata, status = 'ACTIVE') => {
    const daysAgo = rng.int(1, 40);
    recs.push({
      id: id(`recommendation:${resource.resource_id}:${issue}:${status}`),
      organization_id: organization.id,
      resource_id: resource.resource_id,
      resource_name: resource.resource_name,
      resource_type: resourceType,
      issue,
      description,
      potential_savings: round2(savings),
      severity: severityForSavings(savings),
      status,
      aws_region: resource.region,
      metadata,
      created_at: at(daysAgo),
      resolved_at: status === 'ACTIVE' ? null : at(rng.int(0, daysAgo - 1)),
    });
  };

  const unattached = resources.filter((r) => r.resource_type === 'ebs' && r.status === 'available');
  for (const volume of unattached) {
    add(volume, 'Unattached EBS Volume', 'EBS', volume.estimated_monthly_cost,
      `This ${volume.metadata.size_gb}GB ${volume.metadata.volume_type} volume is not attached to any instance. Unattached EBS volumes continue to incur storage charges.`,
      { volume_type: volume.metadata.volume_type, size_gb: volume.metadata.size_gb, encrypted: volume.is_encrypted, savings_basis: BASIS.ebs });
  }

  const gp2 = resources.filter((r) => r.resource_type === 'ebs' && r.status === 'in-use' && r.metadata.volume_type === 'gp2').slice(0, 4);
  for (const volume of gp2) {
    add(volume, 'gp2 to gp3 Migration Opportunity', 'EBS', volume.estimated_monthly_cost * 0.2,
      `Migrating this ${volume.metadata.size_gb}GB gp2 volume to gp3 keeps baseline performance at a lower per-GB price.`,
      { volume_type: 'gp2', size_gb: volume.metadata.size_gb, savings_basis: BASIS.gp2 });
  }

  const idle = resources.filter((r) => r.resource_type === 'ec2' && r.status === 'running' && r.estimated_monthly_cost >= 60).slice(0, 4);
  for (const instance of idle) {
    const cpu = round2(1 + rng.next() * 3);
    add(instance, 'Idle Instance', 'EC2', instance.estimated_monthly_cost,
      `This EC2 instance averaged ${cpu.toFixed(2)}% CPU utilization over the past 14 days. It is an idle candidate: review whether it is still needed. Average CPU alone does not show peak load or memory use, so this is not a rightsizing recommendation.`,
      { instance_type: instance.metadata.instance_type, average_cpu: cpu, days_analyzed: 14, example_data: true, savings_basis: BASIS.ec2Idle });
  }

  // No RDS rows: the oversized-RDS detector is retired (rds_rightsizing is
  // 'planned' in optimization-rules.ts), so the product never produces one.

  const buckets = resources.filter((r) => r.resource_type === 's3' && r.estimated_monthly_cost >= 100).slice(0, 2);
  for (const bucket of buckets) {
    add(bucket, 'S3 Lifecycle Optimization', 'S3', bucket.estimated_monthly_cost * 0.3,
      'Most objects in this bucket have not been read in 90 days; a lifecycle rule to an infrequent-access class would lower storage cost.',
      { example_data: true, savings_basis: BASIS.s3Ceiling });
  }

  const lambda = resources.find((r) => r.resource_type === 'lambda' && r.estimated_monthly_cost >= 15);
  if (lambda) {
    add(lambda, 'Low-Usage Lambda Function', 'Lambda', lambda.estimated_monthly_cost,
      'This function was invoked only a handful of times in the past 30 days; review whether it is still needed.', { example_data: true, savings_basis: BASIS.lambda });
  }

  // History: what the team already acted on.
  const history = resources.filter((r) => r.resource_type === 'ebs' && r.status === 'in-use').slice(10, 14);
  history.forEach((volume, i) => {
    add(volume, 'Unattached EBS Volume', 'EBS', volume.estimated_monthly_cost,
      'This volume was unattached at the time of the scan.', { size_gb: volume.metadata.size_gb, savings_basis: BASIS.ebs },
      i < 3 ? 'RESOLVED' : 'DISMISSED');
  });
  return recs;
}

function findingKey(resourceIdentifier, category, title) {
  // account-security-findings.repository.ts fromComplianceIssues().
  return crypto.createHash('sha256').update(`${resourceIdentifier}|${category}|${title}`).digest('hex');
}

function buildFindings({ rng, id, at, organization, resources, users }) {
  const findings = [];
  const add = ({ category, severity, title, recommendation, resource, region, disposition }) => {
    const detected = rng.int(2, 60);
    findings.push({
      id: id(`finding:${resource}:${title}`),
      organization_id: organization.id,
      finding_key: findingKey(resource, category, title),
      category,
      severity,
      title,
      recommendation,
      resource_identifier: resource,
      region,
      status: 'active',
      detected_at: at(detected),
      last_seen_at: at(0, 3),
      disposition: disposition ? disposition.kind : null,
      disposition_actor_id: disposition ? users[disposition.by].id : null,
      disposition_at: disposition ? at(rng.int(0, detected)) : null,
      disposition_note: disposition ? disposition.note : null,
    });
  };

  const sg = (n) => patternedId('sg-', n, 17);
  const sgFinding = (n, name, port, label, severity, region, disposition) =>
    add({
      category: 'networking',
      severity,
      title: `Security group "${name}" (${sg(n)}) allows ${label} from anywhere (0.0.0.0/0)`,
      recommendation: port === 22
        ? 'Restrict SSH to known source addresses, or remove the rule and use AWS Systems Manager Session Manager.'
        : 'Restrict this port to known source addresses.',
      resource: `arn:aws:ec2:${region}:${ACCOUNTS.production}:security-group/${sg(n)}`,
      region,
      disposition,
    });
  sgFinding(1, 'bastion-sg', 22, 'SSH (port 22)', 'high', 'us-east-1');
  sgFinding(2, 'legacy-admin-sg', 3389, 'RDP (port 3389)', 'high', 'us-east-1');
  sgFinding(3, 'debug-temp', 22, 'SSH (port 22)', 'high', 'us-west-2');
  sgFinding(4, 'db-migration-sg', 5432, 'PostgreSQL (port 5432)', 'critical', 'us-east-1');
  sgFinding(5, 'staging-wide-open', 0, 'all traffic', 'high', 'eu-west-1', {
    kind: 'accepted_risk', by: 'cto@example.com', note: 'Staging only; scheduled for cleanup (example note).',
  });
  sgFinding(6, 'ci-runner-sg', 22, 'SSH (port 22)', 'medium', 'us-east-1', {
    kind: 'acknowledged', by: 'platform.lead@example.com', note: 'Ticket filed (example note).',
  });

  const iamUser = (name) => `arn:aws:iam::${ACCOUNTS.production}:user/${name}`;
  const iam = (severity, title, recommendation, resource) =>
    add({ category: 'iam', severity, title, recommendation, resource, region: null });
  iam('high', 'IAM user "deploy-bot" has console access but no MFA device enabled',
    'Enable MFA for this user, or remove console access if it is not needed.', iamUser('deploy-bot'));
  iam('high', 'IAM user "former-contractor" has console access but no MFA device enabled',
    'Remove this user if the person has left.', iamUser('former-contractor'));
  iam('medium', 'IAM user "ci-legacy" has an access key (AKIAEXAMPLE0000000001) that is 412 days old',
    'Rotate the key, or replace it with a role.', iamUser('ci-legacy'));
  iam('medium', 'IAM user "analytics-export" has an access key (AKIAEXAMPLE0000000002) that is 230 days old',
    'Rotate the key, or replace it with a role.', iamUser('analytics-export'));
  iam('low', 'IAM user "marketing-tools" has no MFA device, and console access could not be verified',
    'Check whether this user can sign in to the console; if so, enable MFA.', iamUser('marketing-tools'));

  const publicDb = resources.find((r) => r.resource_type === 'rds' && r.region === 'us-east-1');
  if (publicDb) {
    add({
      category: 'networking',
      severity: 'critical',
      title: `Security group "rds-public" (${sg(7)}) allows PostgreSQL (port 5432) from anywhere (0.0.0.0/0)`,
      recommendation: `Restrict this rule; it fronts the database ${publicDb.resource_id}.`,
      resource: `arn:aws:ec2:us-east-1:${ACCOUNTS.production}:security-group/${sg(7)}`,
      region: 'us-east-1',
    });
  }
  const stagingSg = (n, name) => add({
    category: 'networking', severity: 'medium',
    title: `Security group "${name}" (${sg(n)}) allows HTTP (port 80) from anywhere (0.0.0.0/0)`,
    recommendation: 'Serve this through the load balancer over HTTPS only.',
    resource: `arn:aws:ec2:us-east-1:${ACCOUNTS.staging}:security-group/${sg(n)}`,
    region: 'us-east-1',
  });
  stagingSg(8, 'staging-web');
  stagingSg(9, 'preview-envs');
  return findings;
}

module.exports = {
  DEFAULT_SEED,
  DEMO_EMAIL,
  ORGANIZATION,
  ACCOUNTS,
  TEAMS,
  SERVICES,
  SHARED_SERVICE_VALUES,
  generateIcpData,
};
