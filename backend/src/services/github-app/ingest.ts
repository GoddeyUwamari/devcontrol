/**
 * The GitHub App webhook pipeline (d8a-build.md §1.3), free of Express so it
 * is tested directly.
 *
 *  1. feature off -> 503, nothing touched
 *  2. HMAC over the raw bytes, before parsing -> 401, nothing written
 *  3. delivery id / event headers, JSON -> 400, nothing written
 *  4. ping, unsupported events and actions -> 200, nothing written
 *  5. normalize (allowlist) -> organization ONLY from the installation claim
 *  6. unclaimed installation -> held (202); claimed -> pipeline_events row
 *  7. acknowledge only after the row is committed; then process, which may
 *     fail without losing the event
 *  8. any database failure while storing -> 503, never "received"
 *
 * Logs one line per delivery: delivery id, event, action, installation id,
 * outcome code, duration. Never a body, header value, secret or token.
 */
import crypto from 'crypto';
import { GitHubAppConfigResult, readGitHubAppConfig } from '../../config/github-app';
import { holdDelivery, installationOrganization } from '../../repositories/github-installations.repository';
import { insertPipelineEvent } from '../../repositories/pipeline-events.repository';
import { NORMALIZER_VERSION } from './contract';
import { ConnectionSource, defaultSource, withOrgClient, withUntaggedClient } from './db';
import { normalizeDelivery } from './normalize';
import { EventProcessor, processEvent, processStoredEvent } from './process';
import { verifyGitHubSignature } from './signature';

export interface WebhookDeps {
  readConfig: () => GitHubAppConfigResult;
  source: ConnectionSource;
  processor: EventProcessor;
  log: (line: string) => void;
}

const defaultWebhookDeps: WebhookDeps = {
  readConfig: () => readGitHubAppConfig(),
  source: defaultSource,
  processor: processEvent,
  log: (line) => console.log(line),
};

interface WebhookInput {
  rawBody: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_NAME = /^[a-z_]{1,40}$/;

function header(headers: WebhookInput['headers'], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function ingestDelivery(input: WebhookInput, deps: WebhookDeps = defaultWebhookDeps): Promise<WebhookResult> {
  const started = Date.now();
  const fields: Record<string, string> = {};
  const done = (status: number, outcome: string, body: Record<string, unknown>): WebhookResult => {
    const parts = Object.entries({ ...fields, outcome, status: String(status), ms: String(Date.now() - started) })
      .map(([k, v]) => `${k}=${v}`);
    deps.log(`[github-app] ${parts.join(' ')}`);
    return { status, body };
  };

  const config = deps.readConfig();
  if (!config.enabled) return done(503, 'not_configured', { received: false, error: 'github_app_not_configured' });

  const raw = input.rawBody;
  if (!Buffer.isBuffer(raw)) return done(400, 'no_raw_body', { received: false, error: 'invalid_body' });
  if (!verifyGitHubSignature(raw, header(input.headers, 'x-hub-signature-256'), config.config.webhookSecrets)) {
    return done(401, 'invalid_signature', { received: false, error: 'invalid_signature' });
  }

  const deliveryId = (header(input.headers, 'x-github-delivery') ?? '').toLowerCase();
  const event = header(input.headers, 'x-github-event') ?? '';
  if (!DELIVERY_ID.test(deliveryId) || !EVENT_NAME.test(event)) {
    return done(400, 'invalid_headers', { received: false, error: 'invalid_headers' });
  }
  fields.delivery = deliveryId;
  fields.event = event;

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return done(400, 'invalid_json', { received: false, error: 'invalid_json' });
  }
  if (event === 'ping') return done(200, 'ping', { received: true, stored: false });

  const normalized = normalizeDelivery(event, payload);
  if (normalized.kind === 'ignored') return done(200, `ignored_${normalized.reason}`, { received: true, stored: false });
  const record = normalized.record;
  fields.action = record.action;
  fields.installation = String(record.installationId);
  const payloadSha256 = crypto.createHash('sha256').update(raw).digest('hex');

  let organizationId: string | null;
  try {
    organizationId = await withUntaggedClient(deps.source, (c) => installationOrganization(c, record.installationId));
    if (organizationId === null) {
      const held = await withUntaggedClient(deps.source, (c) => holdDelivery(c, deliveryId, record, NORMALIZER_VERSION, payloadSha256));
      if (held !== 'claimed') {
        return done(held === 'held' ? 202 : 200, held === 'held' ? 'held' : 'held_duplicate',
          { received: true, stored: 'held', duplicate: held === 'duplicate' });
      }
      organizationId = await withUntaggedClient(deps.source, (c) => installationOrganization(c, record.installationId));
      if (organizationId === null) throw new Error('installation claimed but not found');
    }
  } catch (error) {
    return done(503, `not_recorded_${dbCode(error)}`, { received: false, error: 'not_recorded' });
  }

  const orgId = organizationId;
  let stored;
  try {
    stored = await withOrgClient(deps.source, orgId, (c) => insertPipelineEvent(c, orgId, deliveryId, record, payloadSha256));
  } catch (error) {
    return done(503, `not_recorded_${dbCode(error)}`, { received: false, error: 'not_recorded' });
  }
  if (!stored.inserted) return done(200, 'duplicate', { received: true, stored: true, duplicate: true });

  // The event row is committed. Processing may fail; the event stays.
  const outcome = await processStoredEvent(deps.source, orgId, {
    id: stored.id,
    installationId: String(record.installationId),
    event: record.event,
    action: record.action,
    occurredAt: record.occurredAt ? new Date(record.occurredAt) : null,
    receivedAt: new Date(),
    facts: record.facts,
  }, deps.processor);
  fields.processing = outcome.status;
  return done(200, 'stored', { received: true, stored: true, duplicate: false });
}

/** SQLSTATE (or "error") for the log line; never a message. */
function dbCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code.toLowerCase() : 'error';
}
