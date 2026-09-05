/**
 * Read-only aggregation over the canonical `analytics_events` table for the
 * platform-wide activation funnel (GET /api/admin/activation-funnel).
 *
 * `analytics_events` has organization-scoped RLS (database/migrations-admin/
 * 010_create_analytics_events.sql):
 *
 *   organization_id = current_setting('app.current_organization_id', true)::uuid
 *   OR organization_id IS NULL
 *
 * An authenticated admin request runs on a connection already tagged (by
 * auth.middleware.ts's runWithOrgClient) to that admin's OWN organization --
 * so a naive `pool.query('SELECT ... FROM analytics_events')` inside this
 * request would silently return only that one org's rows, not a platform-wide
 * view. (This exact bug already exists, unfixed, in
 * onboarding.service.ts's getFunnelMetrics()/getMetrics() -- not touched
 * here, flagged as a separate follow-up.)
 *
 * The fix used below: check out ONE dedicated connection (bypassing the
 * request-scoped Proxy in config/database.ts entirely, since pool.connect()
 * is untouched by it), then for each organization explicitly run
 * `SET LOCAL app.current_organization_id` inside its own short transaction
 * before querying that organization's events -- the same per-call
 * "set the org context explicitly, don't rely on ambient context" pattern
 * analyticsEvents.ts itself already uses for the identical reason (see that
 * file's module docblock). Results are combined in application code. This
 * works correctly under both the production `devcontrol` role (RLS enforced)
 * and a local superuser role (RLS bypassed) -- it does not depend on which
 * one happens to be running.
 */
import { pool } from '../config/database';
import type { PoolClient } from 'pg';

export type ActivationFunnelEventName =
  | 'signup_completed'
  | 'aws_connection_completed'
  | 'discovery_completed'
  | 'first_insight_generated'
  | 'first_value_viewed'
  | 'subscription_activated';

const FUNNEL_EVENT_NAMES: ActivationFunnelEventName[] = [
  'signup_completed',
  'aws_connection_completed',
  'discovery_completed',
  'first_insight_generated',
  'first_value_viewed',
  'subscription_activated',
];

// Informational-only -- deliberately not a funnel stage. See module docblock
// on why aws_connection_started is excluded from the activation definition.
const INFORMATIONAL_EVENT_NAME = 'aws_connection_started';

interface OrgEventRow {
  event_name: string;
  created_at: Date;
  properties: Record<string, unknown> | null;
}

interface OrgFirstOccurrences {
  organizationId: string;
  firstAt: Partial<Record<ActivationFunnelEventName, Date>>;
  awsConnectionSource: string | null; // properties.source on the earliest aws_connection_completed row; null = no source key (primary/STS path never sets one)
  hasAwsConnectionStarted: boolean;
}

export interface ActivationFunnelStage {
  event: ActivationFunnelEventName;
  label: string;
  organizations: number;
  conversionFromPreviousStagePct: number | null;
  conversionFromSignupPct: number | null;
}

export interface ActivationFunnelSummary {
  generatedAt: string;
  organizationsTotal: number;
  stages: ActivationFunnelStage[];
  activated: {
    label: string;
    organizations: number;
    definition: string;
    note: string;
  };
  subscribed: {
    label: string;
    organizations: number;
    note: string;
  };
  informational: {
    awsConnectionStarted: {
      label: string;
      organizations: number;
      note: string;
    };
  };
  awsConnectionSourceBreakdown: {
    sts: number;
    legacyAccessKey: number;
    label: string;
    note: string;
  };
  timeToFirstValue: {
    organizationsWithBothEvents: number;
    medianDays: number | null;
    note: string;
  };
  knownLimitations: string[];
}

/**
 * Runs `query` against `client` with `app.current_organization_id` set for
 * exactly one transaction, then rolls back (this is a read-only aggregation;
 * ROLLBACK vs COMMIT is immaterial for a SELECT, but avoids ever needing to
 * reason about this connection holding an open write transaction).
 */
async function withOrgReadContext<T>(
  client: PoolClient,
  organizationId: string,
  run: () => Promise<T>
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const result = await run();
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => { /* connection already broken */ });
    throw error;
  }
}

async function fetchOrgFirstOccurrences(
  client: PoolClient,
  organizationId: string
): Promise<OrgFirstOccurrences> {
  return withOrgReadContext(client, organizationId, async () => {
    const { rows } = await client.query<OrgEventRow>(
      `SELECT event_name, created_at, properties
       FROM analytics_events
       WHERE organization_id = $1
         AND event_name = ANY($2::text[])
       ORDER BY created_at ASC`,
      [organizationId, [...FUNNEL_EVENT_NAMES, INFORMATIONAL_EVENT_NAME]]
    );

    const firstAt: Partial<Record<ActivationFunnelEventName, Date>> = {};
    let awsConnectionSource: string | null = null;
    let hasAwsConnectionStarted = false;
    let sawFirstAwsConnectionCompleted = false;

    for (const row of rows) {
      if (row.event_name === INFORMATIONAL_EVENT_NAME) {
        hasAwsConnectionStarted = true;
        continue;
      }
      const eventName = row.event_name as ActivationFunnelEventName;
      if (!firstAt[eventName]) {
        firstAt[eventName] = row.created_at;
        if (eventName === 'aws_connection_completed' && !sawFirstAwsConnectionCompleted) {
          sawFirstAwsConnectionCompleted = true;
          const source = row.properties?.source;
          awsConnectionSource = typeof source === 'string' ? source : null;
        }
      }
    }

    return { organizationId, firstAt, awsConnectionSource, hasAwsConnectionStarted };
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const STAGE_LABELS: Record<ActivationFunnelEventName, string> = {
  signup_completed: 'Organizations Signed Up',
  aws_connection_completed: 'Organizations Connected',
  discovery_completed: 'Organizations Completing Discovery',
  first_insight_generated: 'Organizations Reaching First Insight',
  first_value_viewed: 'Organizations Reaching First Value',
  subscription_activated: 'Organizations Subscribed',
};

// The activation definition itself -- signup through first_value_viewed.
// subscription_activated is reported separately (see `subscribed` on the
// summary) and is deliberately excluded from this list: it's a downstream
// monetization/graduation event, not part of activation.
const ACTIVATION_STAGE_SEQUENCE: ActivationFunnelEventName[] = [
  'signup_completed',
  'aws_connection_completed',
  'discovery_completed',
  'first_insight_generated',
  'first_value_viewed',
];

export async function getActivationFunnelSummary(): Promise<ActivationFunnelSummary> {
  const { rows: orgRows } = await pool.query<{ id: string }>('SELECT id FROM organizations');
  const organizationIds = orgRows.map((r) => r.id);

  const client = await pool.connect();
  const perOrg: OrgFirstOccurrences[] = [];
  try {
    for (const organizationId of organizationIds) {
      perOrg.push(await fetchOrgFirstOccurrences(client, organizationId));
    }
  } finally {
    client.release();
  }

  const stageCounts: Record<ActivationFunnelEventName, number> = {
    signup_completed: 0,
    aws_connection_completed: 0,
    discovery_completed: 0,
    first_insight_generated: 0,
    first_value_viewed: 0,
    subscription_activated: 0,
  };
  let awsConnectionStartedCount = 0;
  let stsSourceCount = 0;
  let legacySourceCount = 0;
  let activatedCount = 0;
  const timeToValueDays: number[] = [];

  for (const org of perOrg) {
    for (const eventName of FUNNEL_EVENT_NAMES) {
      if (org.firstAt[eventName]) stageCounts[eventName] += 1;
    }
    if (org.hasAwsConnectionStarted) awsConnectionStartedCount += 1;

    if (org.firstAt.aws_connection_completed) {
      if (org.awsConnectionSource === 'legacy_access_key') {
        legacySourceCount += 1;
      } else {
        // No `source` property is set by the primary/STS connection path
        // (aws.routes.ts) -- absence of the key is how "primary" is
        // currently inferred. See known limitations.
        stsSourceCount += 1;
      }
    }

    const isActivated = ACTIVATION_STAGE_SEQUENCE.every((eventName) => Boolean(org.firstAt[eventName]));
    if (isActivated) activatedCount += 1;

    if (org.firstAt.signup_completed && org.firstAt.first_value_viewed) {
      const days =
        (org.firstAt.first_value_viewed.getTime() - org.firstAt.signup_completed.getTime()) /
        (1000 * 60 * 60 * 24);
      timeToValueDays.push(days);
    }
  }

  const stages: ActivationFunnelStage[] = ACTIVATION_STAGE_SEQUENCE.map((eventName, index) => {
    const count = stageCounts[eventName];
    const previousCount = index === 0 ? null : stageCounts[ACTIVATION_STAGE_SEQUENCE[index - 1]];
    const signupCount = stageCounts.signup_completed;
    return {
      event: eventName,
      label: STAGE_LABELS[eventName],
      organizations: count,
      conversionFromPreviousStagePct:
        previousCount && previousCount > 0 ? Number(((count / previousCount) * 100).toFixed(1)) : null,
      conversionFromSignupPct:
        index === 0 || signupCount === 0 ? null : Number(((count / signupCount) * 100).toFixed(1)),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    organizationsTotal: organizationIds.length,
    stages,
    activated: {
      label: 'Organizations Activated',
      organizations: activatedCount,
      definition:
        'aws_connection_completed + discovery_completed + first_insight_generated + first_value_viewed (all reached, signup_completed implied)',
      note:
        'Measurable proxy based on current instrumentation, not a definitive product-value judgment. ' +
        'first_insight_generated and first_value_viewed both require the connected AWS environment to ' +
        'produce a recommendation with non-zero dollar savings -- a clean/well-optimized account may ' +
        'legitimately never reach these stages and would not count as activated under this definition.',
    },
    subscribed: {
      label: STAGE_LABELS.subscription_activated,
      organizations: stageCounts.subscription_activated,
      note: 'Downstream monetization/graduation event -- reported for context, not part of the activation definition.',
    },
    informational: {
      awsConnectionStarted: {
        label: 'Organizations That Started AWS Connection Setup',
        organizations: awsConnectionStartedCount,
        note:
          'Informational only, not an activation stage. aws_connection_started fires when the AWS ' +
          'connection setup page/endpoint initializes, not on confirmed user intent to connect -- it can ' +
          'overcount relative to genuine connection interest.',
      },
    },
    awsConnectionSourceBreakdown: {
      sts: stsSourceCount,
      legacyAccessKey: legacySourceCount,
      label: 'Organizations Connected, by AWS connection source',
      note:
        "The legacy access-key path explicitly tags properties.source='legacy_access_key'. The primary " +
        "STS path sets no source property at all, so 'sts' here is inferred from the ABSENCE of that key, " +
        'not an explicit value -- workable today but fragile; consider having the primary path stamp its ' +
        'own source value in a future change (not part of this endpoint).',
    },
    timeToFirstValue: {
      organizationsWithBothEvents: timeToValueDays.length,
      medianDays: (() => {
        const m = median(timeToValueDays);
        return m === null ? null : Number(m.toFixed(1));
      })(),
      note:
        'Computed only across organizations that have reached both signup_completed and first_value_viewed. ' +
        'created_at reflects when analytics_events recorded the row, which for discovery/insight-pipeline ' +
        'events can lag the real-world trigger by however long that background job took to run.',
    },
    knownLimitations: [
      "first_insight_generated and first_value_viewed both depend on the org's AWS environment having at " +
        "least one recommendation with non-zero dollar savings; a genuinely well-optimized account can " +
        'never reach them regardless of product quality.',
      'discovery_completed only fires when a scan finds or updates at least one resource -- a scan that ' +
        'ran and found zero resources is indistinguishable from discovery never having run at all (no ' +
        'discovery_started event exists to disambiguate).',
      'first_value_viewed fires on API access (GET /api/cost-recommendations returning active savings), ' +
        'not on confirmed screen visibility -- it is an access proxy, not a viewing/engagement signal.',
      'trackFunnelEventOnce dedup is application-level (INSERT ... WHERE NOT EXISTS), not enforced by a ' +
        'database unique constraint -- a narrow race under true concurrency could in theory produce more ' +
        'than one row for the same organization+event. This summary uses first-occurrence (MIN-equivalent) ' +
        'logic per organization, which is immune to that race for counting purposes.',
      'aws_connection_completed is emitted from two paths with different confidence: the primary STS path ' +
        'validates the AWS role via AssumeRole before persisting; the legacy access-key path only encrypts ' +
        'and stores credentials, with no AWS-side validation at all.',
    ],
  };
}
