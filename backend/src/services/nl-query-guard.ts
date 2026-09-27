/**
 * Ask AI (NL query) guardrails: what a question may ask, and what a parsed
 * intent may contain, before anything is executed.
 *
 * The safety boundary is an ALLOWLIST: Ask AI answers only when a question
 * positively maps to a supported target, filters, and period. Everything
 * else is not_supported.
 *
 * The parser (the model) is an untrusted interpreter of untrusted user
 * text. Its output is never authorization: the organization always comes
 * from the authenticated request. reconcileWithQuery() first checks the
 * parser's claims against the question text itself -- the period, a stated
 * date range, cost thresholds, and, for costs and inventory, that every word
 * of the question is in the allowlist VOCABULARY. Then an intent executes
 * only if validateIntent() accepts all of it --
 *   - target is one of the four executable targets (not "unsupported",
 *     missing, or anything else; looked up as own properties only),
 *   - the parser reported CONFIDENCE: high (an exact mapping),
 *   - the period is one the target can honor (costs: none or this month
 *     only; inventory/services: current snapshot; deployments: a 7/30/90-day
 *     range the filter applies),
 *   - every filter is on the target's allowlist with a valid value.
 * Anything else is rejected as not_supported -- never dropped or
 * reinterpreted, which would answer a different question than the one asked.
 *
 * classifyUnsupportedQuestion() is only a fast path: it catches common
 * phrasings of question types DevControl has no evidence to answer before
 * any parsing, so they get a specific message. It is not the boundary.
 *
 * Limit: these checks validate structure and wording, not meaning. A model
 * that labels a question as a supported target with high confidence, using
 * only allowlisted words, is executed; the answer is still deterministic and
 * labeled with its real scope and source.
 */

import type { NLQueryIntent } from './nl-query.service';

export type NLTarget = 'infrastructure' | 'services' | 'deployments' | 'costs';

/** The time a question refers to. 'other' is any time reference except this month / month to date. */
export type NLPeriod = 'none' | 'current_month' | 'other';

/** A parsed intent that passed validation; filters are typed and bounded. */
export interface ValidatedIntent {
  target: NLTarget;
  filters: ValidatedFilters;
}

export interface ValidatedFilters {
  resourceType?: string;
  status?: string;
  awsRegion?: string;
  costMin?: number;
  costMax?: number;
  encrypted?: boolean;
  hasBackup?: boolean;
  publicAccess?: boolean;
  template?: string;
  environment?: string;
  /** Days, from an allowlisted 7d/30d/90d. */
  dateRangeDays?: number;
}

export type IntentValidation =
  | { ok: true; intent: ValidatedIntent }
  | { ok: false; reason: string };

export interface UnsupportedQuestion {
  kind: 'causal' | 'comparison' | 'forecast' | 'optimization' | 'utilization' | 'period' | 'other';
  message: string;
}

const ACTIONS = new Set(['navigate', 'filter', 'search']);

const RESOURCE_TYPES = new Set(['ec2', 'rds', 's3', 'vpc', 'lambda', 'cloudfront', 'elb', 'ecs', 'dynamodb', 'elasticache', 'eks']);
const RESOURCE_STATUSES = new Set(['running', 'stopped', 'terminated', 'pending', 'available']);
const SERVICE_STATUSES = new Set(['active', 'inactive', 'deploying', 'failed']);
const SERVICE_TEMPLATES = new Set(['api', 'microservices', 'frontend', 'worker']);
const DEPLOYMENT_STATUSES = new Set(['success', 'failed', 'running', 'deploying', 'pending', 'stopped', 'rolled_back']);
const ENVIRONMENTS = new Set(['production', 'staging', 'development']);
const DATE_RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

/** Which filters each executable target accepts. Anything else is rejected. */
const TARGET_FILTERS: Record<NLTarget, ReadonlySet<string>> = {
  infrastructure: new Set(['resourceType', 'status', 'awsRegion', 'costMin', 'costMax', 'encrypted', 'hasBackup', 'publicAccess']),
  services: new Set(['status', 'template']),
  deployments: new Set(['status', 'environment', 'dateRange']),
  // Month-to-date AWS spend only: no per-service, per-resource, or date-range cost query exists.
  costs: new Set(),
};

export const GENERIC_NOT_SUPPORTED =
  "Ask AI can't answer that from the data it has. It can report month-to-date AWS spend, and list resources in your inventory, services, and deployments.";
export const COST_PERIOD_NOT_SUPPORTED = 'Ask AI only has month-to-date AWS spend.';
const INVENTORY_PERIOD_NOT_SUPPORTED =
  'Ask AI only has your current inventory and services, not their state or costs over a past or future period.';
const DEPLOYMENT_PERIOD_NOT_SUPPORTED = 'Ask AI can filter deployments to the last 7, 30, or 90 days only.';

const TARGET_NOT_SUPPORTED: Record<string, string> = {
  alerts:
    "Ask AI can't answer alert questions: DevControl's alert sync does not yet associate alerts with an organization, so this organization's alerts cannot be determined.",
  teams: "Ask AI can't list teams. Open the Teams page to see them.",
};

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** The period a question refers to, deterministically. Any time reference that isn't this month / MTD is 'other'. */
export function detectPeriod(query: string): NLPeriod {
  const q = query.toLowerCase();
  const other =
    /\b(last|past|previous|prior|next|ago|since|yesterday|today|tomorrow|tonight)\b/.test(q) ||
    /\b(weeks?|weekly|quarters?|quarterly|years?|yearly|annual|fortnight)\b/.test(q) ||
    /\bq[1-4]\b/.test(q) ||
    /\b\d+\s*(days?|weeks?|months?|years?|hours?)\b/.test(q) ||
    /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/.test(q) ||
    /(?<![$\d.,])\b(19|20)\d{2}\b(?![.,]?\d)/.test(q) ||
    /\b\d{4}-\d{2}(-\d{2})?\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(q);
  if (other) return 'other';
  if (/\b(this|current) month\b|\bmonth[- ]to[- ]date\b|\bmtd\b/.test(q)) return 'current_month';
  return 'none';
}

/**
 * Every word Ask AI can map exactly. A cost or inventory question with any
 * other word is not executed, whatever the parser says: this makes period
 * and meaning safety independent of how complete detectPeriod() or the
 * fast-path guard are (e.g. "May", "the holidays", "FY25", "earlier").
 * Negations and "up" are deliberately absent; they are accepted only inside
 * the exact phrases in NEGATION_PHRASES, so "not running" or "is my spend
 * up" are never read as "running" or as a plain spend question.
 */
const VOCABULARY = new Set([
  // phrasing
  'show', 'list', 'find', 'get', 'view', 'display', 'give', 'me', 'my', 'our', 'all', 'the', 'a', 'an', 'of', 'in', 'on',
  'with', 'and', 'or', 'for', 'which', 'what', 'whats', "what's", 'is', 'are', 'were', 'was', 'do', 'does', 'did', 'i', 'we',
  'have', 'has', 'any', 'that', 'from', 'to', 'by', 'per', 'please', 'current', 'currently', 'total', 'how', 'much', 'many',
  'aws', 'amazon', 'there', 'right', 'now', 'so', 'far', 'at',
  // inventory
  'resource', 'resources', 'instance', 'instances', 'ec2', 'rds', 'database', 'databases', 'db', 'dbs', 's3', 'bucket', 'buckets',
  'lambda', 'lambdas', 'function', 'functions', 'vpc', 'vpcs', 'cloudfront', 'elb', 'elbs', 'load', 'balancer', 'balancers',
  'infrastructure', 'region', 'regions',
  'running', 'stopped', 'terminated', 'pending', 'failed', 'failing', 'active', 'inactive',
  'virginia', 'ohio', 'california', 'oregon', 'ireland', 'singapore',
  'encrypted', 'unencrypted', 'encryption', 'public', 'publicly', 'exposed', 'accessible', 'backup', 'backups',
  // cost
  'cost', 'costs', 'costing', 'spend', 'spending', 'spent', 'bill', 'billing', 'charges', 'expensive', 'cheap', 'over', 'under', 'more',
  'than', 'above', 'below', 'monthly', 'month', 'date', 'mtd', 'this', 'estimated',
  // time words (the period, not the vocabulary, decides whether they can be honored)
  'last', 'past', 'previous', 'prior', 'next', 'ago', 'since', 'yesterday', 'today', 'week', 'weeks', 'quarter', 'year', 'day', 'days', 'months',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  // deployments / services / alerts
  'deploy', 'deploys', 'deployment', 'deployments', 'deployed', 'production', 'prod', 'staging', 'development', 'dev', 'environment',
  'service', 'services', 'microservice', 'microservices', 'api', 'apis', 'template',
  'alert', 'alerts', 'critical', 'warning', 'warnings', 'firing', 'acknowledged', 'resolved', 'severity',
  // placeholders for NEGATION_PHRASES
  'phrase_unencrypted', 'phrase_no_backups', 'phrase_backed_up',
]);

/** The only places a negation or "up" is understood; each becomes one known token. */
const NEGATION_PHRASES: Array<[RegExp, string]> = [
  [/\bnot encrypted\b/g, 'phrase_unencrypted'],
  [/\bwithout encryption\b/g, 'phrase_unencrypted'],
  [/\b(no|without) backups?\b/g, 'phrase_no_backups'],
  [/\bnot backed up\b/g, 'phrase_no_backups'],
  [/\bbacked up\b/g, 'phrase_backed_up'],
];

const REGION_TOKEN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const NUMBER_TOKEN = /^\$?\d{1,3}(,\d{3})*(\.\d+)?k?$|^\$?\d+(\.\d+)?k?$/;

/** True when every word in the question is in the allowlist vocabulary (negations only inside exact phrases). */
export function fullyRecognized(query: string): boolean {
  let q = query.toLowerCase();
  for (const [pattern, token] of NEGATION_PHRASES) q = q.replace(pattern, ` ${token} `);
  const tokens = q.replace(/[?!;:()"]/g, ' ').split(/\s+/).map(t => t.replace(/[.,]+$/, '')).filter(Boolean);
  return tokens.length > 0 && tokens.every(t => VOCABULARY.has(t) || REGION_TOKEN.test(t) || NUMBER_TOKEN.test(t) || t === '$' || t === '-');
}

/** A dollar amount as written in a question: "$1,000", "1k", "1.5k", "250.50". null when unparseable. */
function parseAmount(text: string): number | null {
  const m = text.replace(/[$,]/g, '').match(/^(\d+(?:\.\d+)?)(k?)$/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'k' ? 1000 : 1);
}

/**
 * The cost thresholds a question states, deterministically: the amount must
 * directly follow its qualifier ("over $1,000", "under 1k"). 'invalid' when a
 * qualifier is followed by something that isn't a parseable amount.
 */
export function statedCostBounds(query: string): { min?: number; max?: number } | 'invalid' {
  const q = query.toLowerCase();
  const bounds: { min?: number; max?: number } = {};
  for (const [pattern, key] of [[/\b(?:over|more than|above)\s+(\S+)/g, 'min'], [/\b(?:under|less than|below)\s+(\S+)/g, 'max']] as const) {
    for (const m of q.matchAll(pattern)) {
      const amount = parseAmount(m[1].replace(/[?!;:()".]+$/, ''));
      if (amount === null) return 'invalid';
      bounds[key] = amount;
    }
  }
  return bounds;
}

const PERIOD_RANK: Record<NLPeriod, number> = { none: 0, current_month: 1, other: 2 };
const NEGATION = /\b(not|no|without|except|excluding|outside|before|after|besides)\b/;

/**
 * Reconcile the parser's claims with the question text before validation,
 * so the boundary never rests on the parser alone:
 *   - the period is the stricter of the parser's and detectPeriod(query)'s
 *     (a parser can't downgrade "last month" to none); a missing parser
 *     period stays missing and is rejected by validateIntent();
 *   - a dateRange filter is kept only if the question literally states
 *     "last/past N days" with the same N; otherwise the intent is unsupported
 *     (e.g. "this week" is never silently approximated as 7 days).
 */
export function reconcileWithQuery(query: string, intent: NLQueryIntent): NLQueryIntent {
  if (!intent || typeof intent !== 'object') return intent;
  const detected = detectPeriod(query);
  const claimed = typeof intent.period === 'string' ? (intent.period.toLowerCase() as NLPeriod) : undefined;
  const period = claimed && Object.prototype.hasOwnProperty.call(PERIOD_RANK, claimed)
    ? (PERIOD_RANK[detected] > PERIOD_RANK[claimed] ? detected : claimed)
    : undefined;

  const unsupported = { ...intent, target: 'unsupported' as const, period };
  const target = typeof intent.target === 'string' ? intent.target.toLowerCase() : '';
  const filters = intent.filters && typeof intent.filters === 'object' ? (intent.filters as Record<string, unknown>) : undefined;

  if (filters && filters.dateRange !== undefined && filters.dateRange !== null) {
    const q = query.toLowerCase();
    const stated = q.match(/\b(last|past)\s+(7|30|90)\s+days\b/);
    if (!stated || String(filters.dateRange).toLowerCase() !== `${stated[2]}d`) return unsupported;
    // The stated range must be the question's only time reference, un-negated
    // ("last 30 days of May", "not in the last 30 days" are not that range).
    const rest = q.replace(stated[0], ' ');
    if (detectPeriod(rest) !== 'none' || NEGATION.test(q) || !fullyRecognized(rest)) return unsupported;
  }

  // Costs and inventory execute only for questions made entirely of words
  // Ask AI maps exactly -- independent of what the parser claims.
  if ((target === 'costs' || target === 'infrastructure') && !fullyRecognized(query)) return unsupported;

  // A cost threshold must be the one the question states: the parser can
  // neither invent, drop, nor misread it ("$1,000" is 1000, "1k" is 1000).
  if (target === 'infrastructure') {
    const bounds = statedCostBounds(query);
    if (bounds === 'invalid') return unsupported;
    const q = query.toLowerCase();
    const min = filters?.costMin !== undefined && filters?.costMin !== null ? Number(filters.costMin) : undefined;
    const max = filters?.costMax !== undefined && filters?.costMax !== null ? Number(filters.costMax) : undefined;
    const expectedMin = bounds.min ?? (/\bexpensive\b/.test(q) ? 100 : undefined);
    const expectedMax = bounds.max ?? (/\bcheap\b/.test(q) ? 50 : undefined);
    if (min !== expectedMin || max !== expectedMax) return unsupported;
  }

  return { ...intent, period };
}

function nonNegativeNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function lowerString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null;
}

export function validateIntent(intent: NLQueryIntent | null | undefined): IntentValidation {
  if (!intent || typeof intent !== 'object') return { ok: false, reason: GENERIC_NOT_SUPPORTED };

  // Own-property lookups only: "__proto__"/"constructor" must never resolve through the prototype.
  const target = lowerString(intent.target) ?? '';
  const targetReason = own(TARGET_NOT_SUPPORTED, target);
  if (targetReason) return { ok: false, reason: targetReason };
  const allowed = own(TARGET_FILTERS as Record<string, ReadonlySet<string>>, target);
  if (!allowed) return { ok: false, reason: GENERIC_NOT_SUPPORTED }; // includes "unsupported" and a missing target
  if (!ACTIONS.has(lowerString(intent.action) ?? '')) return { ok: false, reason: GENERIC_NOT_SUPPORTED };
  // Only an exact mapping executes: a guessed ("medium"/"low") or missing confidence is not an answer.
  if (lowerString(intent.confidence) !== 'high') return { ok: false, reason: GENERIC_NOT_SUPPORTED };

  const raw = intent.filters && typeof intent.filters === 'object' ? (intent.filters as Record<string, unknown>) : {};
  const filters: ValidatedFilters = {};
  const invalid = (key: string) => ({ ok: false as const, reason: `Ask AI can't apply the "${key}" filter to that question.` });

  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (!allowed.has(key)) {
      return target === 'costs'
        ? { ok: false, reason: 'Ask AI can only report total month-to-date AWS spend; it has no per-service, per-resource, or date-range billing data.' }
        : invalid(key);
    }

    switch (key) {
      case 'resourceType': {
        const v = lowerString(value);
        if (!v || !RESOURCE_TYPES.has(v)) return invalid(key);
        filters.resourceType = v;
        break;
      }
      case 'status': {
        const v = lowerString(value);
        const set = target === 'infrastructure' ? RESOURCE_STATUSES : target === 'services' ? SERVICE_STATUSES : DEPLOYMENT_STATUSES;
        if (!v || !set.has(v)) return invalid(key);
        filters.status = v;
        break;
      }
      case 'awsRegion': {
        const v = lowerString(value);
        if (!v || !REGION_PATTERN.test(v)) return invalid(key);
        filters.awsRegion = v;
        break;
      }
      case 'costMin':
      case 'costMax': {
        const n = nonNegativeNumber(value);
        if (n === null) return invalid(key);
        filters[key] = n;
        break;
      }
      case 'encrypted':
      case 'hasBackup':
      case 'publicAccess': {
        if (typeof value !== 'boolean') return invalid(key);
        filters[key] = value;
        break;
      }
      case 'template': {
        const v = lowerString(value);
        if (!v || !SERVICE_TEMPLATES.has(v)) return invalid(key);
        filters.template = v;
        break;
      }
      case 'environment': {
        const v = lowerString(value);
        if (!v || !ENVIRONMENTS.has(v)) return invalid(key);
        filters.environment = v;
        break;
      }
      case 'dateRange': {
        const v = lowerString(value);
        if (!v || !(v in DATE_RANGES)) return invalid(key);
        filters.dateRangeDays = DATE_RANGES[v];
        break;
      }
      default:
        return invalid(key);
    }
  }

  if (filters.costMin !== undefined && filters.costMax !== undefined && filters.costMin > filters.costMax) {
    return { ok: false, reason: 'The minimum cost is greater than the maximum cost.' };
  }

  // The period must be reported and must be one this target can honor -- a
  // question about another period is never answered with current data.
  const period = lowerString(intent.period);
  if (period !== 'none' && period !== 'current_month' && period !== 'other') {
    return { ok: false, reason: GENERIC_NOT_SUPPORTED };
  }
  if (target === 'costs' && period === 'other') return { ok: false, reason: COST_PERIOD_NOT_SUPPORTED };
  if ((target === 'infrastructure' || target === 'services') && period === 'other') {
    return { ok: false, reason: INVENTORY_PERIOD_NOT_SUPPORTED };
  }
  if (target === 'deployments') {
    // A time reference is only honored as a 7/30/90-day range the query applies.
    if (period !== 'none' && filters.dateRangeDays === undefined) return { ok: false, reason: DEPLOYMENT_PERIOD_NOT_SUPPORTED };
  }

  return { ok: true, intent: { target: target as NLTarget, filters } };
}

/** What Ask AI will show for a validated intent -- deterministic; model-written explanations are never displayed. */
export function describeIntent(intent: ValidatedIntent): string {
  const f = intent.filters;
  switch (intent.target) {
    case 'costs':
      return 'AWS spend, month to date';
    case 'services':
      return ['Services', f.status && `with status ${f.status}`, f.template && `using the ${f.template} template`].filter(Boolean).join(' ');
    case 'deployments':
      return [
        'Deployments',
        f.environment && `in ${f.environment}`,
        f.status && `with status ${f.status}`,
        f.dateRangeDays && `from the last ${f.dateRangeDays} days`,
      ].filter(Boolean).join(' ');
    case 'infrastructure': {
      const parts = [f.resourceType ? `${f.resourceType.toUpperCase()} resources` : 'Resources'];
      if (f.status) parts.push(`with status ${f.status}`);
      if (f.awsRegion) parts.push(`in ${f.awsRegion}`);
      if (f.encrypted !== undefined) parts.push(f.encrypted ? 'that are encrypted' : 'that are not encrypted');
      if (f.hasBackup !== undefined) parts.push(f.hasBackup ? 'with backups' : 'without backups');
      if (f.publicAccess !== undefined) parts.push(f.publicAccess ? 'that are publicly accessible' : 'that are not publicly accessible');
      if (f.costMin !== undefined) parts.push(`with an estimated monthly cost of at least $${f.costMin}`);
      if (f.costMax !== undefined) parts.push(`with an estimated monthly cost of at most $${f.costMax}`);
      return parts.join(' ');
    }
  }
}

const COST_WORDS = /\b(cost|costs|costing|spend|spends|spending|spent|bill|billed|billing|bills|charges?|charged|invoice)\b/i;

const UNSUPPORTED_RULES: Array<{ kind: UnsupportedQuestion['kind']; pattern: RegExp; message: string }> = [
  {
    kind: 'utilization',
    pattern: /\b(right[- ]?siz\w*|downsiz\w*|over-?sized|over-?provisioned|under-?utili[sz]\w*|utili[sz]ation|cpu|memory usage|idle|low usage|doing nothing|not (being )?used)\b/i,
    message:
      "Ask AI doesn't have utilization data, so it can't determine which resources are oversized, idle, or underutilized. " +
      'It can list the resources in your current inventory -- for example, "show running EC2 instances".',
  },
  {
    kind: 'optimization',
    pattern: /\b(optimi[sz]\w*|save|saving|savings|waste|wasted|wasteful|wasting|unused|reserved instances?|savings plans?|commitments?|commit|(reduce|cut|lower|decrease|trim|shrink) (my |our |the )?(aws )?(cost|costs|spend|spending|bill|bills))\b|\bRIs?\b/i,
    message:
      "Ask AI doesn't have the evidence to identify savings or waste, so it won't estimate savings. " +
      "DevControl's detector-backed cost recommendations, with their estimated savings, are on the Cost Optimization page.",
  },
  {
    kind: 'causal',
    pattern: /(^\s*why\b|\bwhy (is|are|did|does|do|has|have|was|were)\b|\bwhat('s| is| are) (causing|driving)\b|\bwhat made\b|\bwhat happened\b|\broot cause\b|\b(go|goes|went|gone|going) (up|down)\b|\b(spike|spiked|jump|jumped|increase[ds]?|decrease[ds]?)\b|\bexplain (the |my |our )?(cost|spend|bill|increase|spike))/i,
    message:
      "Ask AI doesn't have resource-level billing attribution, so it can't explain why a cost is what it is. " +
      'It can show current month-to-date AWS spend ("what is my AWS spend") or list resources with their inventory cost estimates.',
  },
  {
    kind: 'comparison',
    pattern: /\b(compare[ds]?|comparison|versus|vs\.?|month[- ]over[- ]month|week[- ]over[- ]week|year[- ]over[- ]year|trends?|trending)\b|\b(more|less|higher|lower) than (last|the previous|previous)\b/i,
    message:
      "Ask AI can't compare billing periods: it only has the current month-to-date AWS spend, not historical Cost Explorer data. " +
      'The Costs page chart shows the daily trend.',
  },
  {
    kind: 'forecast',
    pattern: /\b(forecast\w*|predict\w*|projection|projected|expected|expect|next (month|quarter|year)|end[- ]of[- ](the[- ])?month|will (i|we) spend|estimate (my |our |the )?(end|bill|spend))\b/i,
    message: "Ask AI can't forecast spend. It can show current month-to-date AWS spend.",
  },
  {
    kind: 'other',
    pattern: /\b(incidents?|outages?|downtime|teams?|who owns|owner of|ownership|best practices?|advice|recommend\w*)\b/i,
    message: GENERIC_NOT_SUPPORTED,
  },
];

/**
 * A question DevControl has no evidence to answer, or null. A fast path
 * checked before any parsing -- not the boundary (see validateIntent()).
 */
export function classifyUnsupportedQuestion(query: string): UnsupportedQuestion | null {
  for (const rule of UNSUPPORTED_RULES) {
    if (rule.pattern.test(query)) return { kind: rule.kind, message: rule.message };
  }
  if (COST_WORDS.test(query) && detectPeriod(query) === 'other') {
    return { kind: 'period', message: COST_PERIOD_NOT_SUPPORTED };
  }
  return null;
}
