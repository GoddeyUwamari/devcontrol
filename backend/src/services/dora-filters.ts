import { DEPLOYMENT_ENVIRONMENTS, type DeploymentEnvironment } from './deployment-status';

/**
 * The service / team / environment filters of GET /api/metrics/dora, checked
 * and normalized once. The same normalized object drives every query of a
 * request (current period, previous period, daily series, busiest day,
 * per-service breakdown) and is echoed in the response as `filters`.
 *
 *   - absent or empty          -> null (all)
 *   - environment 'all'        -> null (all environments, the default)
 *   - environment              -> one of DEPLOYMENT_ENVIRONMENTS, exactly
 *   - service_id / team_id     -> a UUID (lower-cased)
 *
 * Anything else is a DoraFilterError, which the controller answers with a
 * 400 and the error's own plain message: a bad value never reaches the
 * database, so no database error text can reach the client. The organization
 * is never a filter: it comes from the authenticated request only.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NormalizedDoraFilters {
  /** Null = all environments. */
  environment: DeploymentEnvironment | null;
  /** Null = all services. */
  serviceId: string | null;
  /** Null = all teams. */
  teamId: string | null;
}

export type DoraFilterParameter = 'service_id' | 'team_id' | 'environment';

export class DoraFilterError extends Error {
  constructor(public readonly parameter: DoraFilterParameter, message: string) {
    super(message);
    this.name = 'DoraFilterError';
  }
}

export const DORA_FILTER_MESSAGES = {
  service_id: 'Invalid service_id. Must be a service UUID',
  team_id: 'Invalid team_id. Must be a team UUID',
  environment: `Invalid environment. Must be one of: all, ${DEPLOYMENT_ENVIRONMENTS.join(', ')}`,
} as const;

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function uuidOrNull(parameter: 'service_id' | 'team_id', value: unknown): string | null {
  if (isAbsent(value)) return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new DoraFilterError(parameter, DORA_FILTER_MESSAGES[parameter]);
  }
  return value.toLowerCase();
}

function environmentOrNull(value: unknown): DeploymentEnvironment | null {
  if (isAbsent(value) || value === 'all') return null;
  if (typeof value !== 'string' || !(DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new DoraFilterError('environment', DORA_FILTER_MESSAGES.environment);
  }
  return value as DeploymentEnvironment;
}

/**
 * Validates raw values (query-string values may be strings, arrays or
 * objects) and returns the normalized filters, or throws DoraFilterError.
 * Idempotent: normalizing a normalized object returns the same values.
 */
export function normalizeDoraFilters(input: {
  serviceId?: unknown;
  teamId?: unknown;
  environment?: unknown;
}): NormalizedDoraFilters {
  return {
    environment: environmentOrNull(input.environment),
    serviceId: uuidOrNull('service_id', input.serviceId),
    teamId: uuidOrNull('team_id', input.teamId),
  };
}
