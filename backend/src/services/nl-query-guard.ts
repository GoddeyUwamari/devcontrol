/**
 * Ask AI (NL query) guardrails: what a question may ask, and what a parsed
 * intent may contain, before anything is executed.
 *
 * The parser (Claude or the keyword fallback) is an untrusted interpreter of
 * untrusted user text. Its output is never authorization: the organization
 * always comes from the authenticated request, and an intent executes only
 * if its target, action, and every filter are on the allowlist below. An
 * unknown target, an unknown or target-inappropriate filter (including
 * anything like organization_id), or an invalid value is rejected as
 * not_supported -- never silently dropped or reinterpreted, which would
 * answer a different question than the one asked.
 *
 * classifyUnsupportedQuestion() catches question types DevControl has no
 * evidence to answer (causes, historical comparisons, forecasts,
 * optimization/savings/waste, utilization/rightsizing, RI/Savings Plans)
 * before the parser runs, so they get an explicit limitation instead of an
 * unrelated resource list.
 */

import type { NLQueryIntent } from './nl-query.service';

export type NLTarget = 'infrastructure' | 'services' | 'deployments' | 'costs';

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
  kind: 'causal' | 'comparison' | 'forecast' | 'optimization' | 'utilization';
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

const TARGET_NOT_SUPPORTED: Record<string, string> = {
  alerts:
    "Ask AI can't answer alert questions: DevControl's alert sync does not yet associate alerts with an organization, so this organization's alerts cannot be determined.",
  teams: "Ask AI can't list teams. Open the Teams page to see them.",
};

function nonNegativeNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function lowerString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null;
}

export function validateIntent(intent: NLQueryIntent | null | undefined): IntentValidation {
  if (!intent || typeof intent !== 'object') return { ok: false, reason: "Ask AI couldn't interpret that question." };

  const target = lowerString(intent.target) ?? '';
  if (TARGET_NOT_SUPPORTED[target]) return { ok: false, reason: TARGET_NOT_SUPPORTED[target] };
  if (!(target in TARGET_FILTERS)) return { ok: false, reason: "Ask AI can't answer that kind of question." };
  if (!ACTIONS.has(lowerString(intent.action) ?? '')) return { ok: false, reason: "Ask AI couldn't interpret that question." };

  const allowed = TARGET_FILTERS[target as NLTarget];
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

const UNSUPPORTED_RULES: Array<{ kind: UnsupportedQuestion['kind']; pattern: RegExp; message: string }> = [
  {
    kind: 'utilization',
    pattern: /\b(right-?siz\w*|downsiz\w*|over-?sized|over-?provisioned|under-?utili[sz]\w*|utili[sz]ation|cpu|memory usage|idle)\b/i,
    message:
      "Ask AI doesn't have utilization data, so it can't determine which resources are oversized, idle, or underutilized. " +
      'It can list the resources in your current inventory -- for example, "show running EC2 instances".',
  },
  {
    kind: 'optimization',
    pattern: /\b(optimi[sz]\w*|save|saving|savings|waste|wasted|wasteful|wasting|unused|reserved instances?|savings plans?|reduce (my |our |the )?(cost|costs|spend|spending|bill))\b/i,
    message:
      "Ask AI doesn't have the evidence to identify savings or waste, so it won't estimate savings. " +
      "DevControl's detector-backed cost recommendations, with their estimated savings, are on the Cost Optimization page.",
  },
  {
    kind: 'causal',
    pattern: /(^\s*why\b|\bwhy (is|are|did|does|do|has|have|was|were)\b|\bwhat('s| is| are) (causing|driving)\b|\broot cause\b|\bexplain (the |my |our )?(cost|spend|bill|increase|spike))/i,
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
    pattern: /\b(forecast\w*|predict\w*|projection|projected|next month|end of (the )?month|will (i|we) spend)\b/i,
    message: "Ask AI can't forecast spend. It can show current month-to-date AWS spend.",
  },
];

/** A question DevControl has no evidence to answer, or null. Checked before any parsing. */
export function classifyUnsupportedQuestion(query: string): UnsupportedQuestion | null {
  for (const rule of UNSUPPORTED_RULES) {
    if (rule.pattern.test(query)) return { kind: rule.kind, message: rule.message };
  }
  return null;
}
