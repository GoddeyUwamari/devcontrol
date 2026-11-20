/**
 * GET /api/metrics/dora filter validation (D4-D6), at the controller.
 *
 *   - service_id / team_id must be UUIDs, environment one of
 *     all | development | staging | production; anything else is a 400 with a
 *     plain message and nothing is computed.
 *   - Absent, empty or environment=all is "all" and adds no filter key.
 *   - A 500 never carries the error's text (it can hold database detail).
 *   - The real service refuses invalid filters before any query too.
 */
import type { Request, Response } from 'express';
import { DORAMetricsController } from '../../controllers/dora-metrics.controller';
import { DORAMetricsService } from '../../services/dora-metrics.service';
import type { DORAMetricsRepository } from '../../repositories/dora-metrics.repository';
import { DoraFilterError, DORA_FILTER_MESSAGES, normalizeDoraFilters } from '../../services/dora-filters';

const ORG = '11111111-1111-4111-8111-111111111111';
const SERVICE = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';

function build(impl?: () => Promise<unknown>) {
  const getComprehensiveMetrics = jest.fn(impl ?? (() => Promise.resolve({ ok: true })));
  const controller = new DORAMetricsController({ getComprehensiveMetrics } as unknown as DORAMetricsService);
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  return { controller, getComprehensiveMetrics, res: { status, json } as unknown as Response, status, json };
}

const call = async (query: Record<string, unknown>, impl?: () => Promise<unknown>) => {
  const built = build(impl);
  await built.controller.getDORAMetrics({ query, organizationId: ORG } as unknown as Request, built.res);
  return built;
};

describe('GET /api/metrics/dora — valid filters', () => {
  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['no filters (all services, teams, environments)', {}, {}],
    ['environment=all', { environment: 'all' }, {}],
    ['empty values', { service_id: '', team_id: '', environment: '' }, {}],
    ['one service', { service_id: SERVICE }, { serviceId: SERVICE }],
    ['one service, upper-case UUID', { service_id: SERVICE.toUpperCase() }, { serviceId: SERVICE }],
    ['one team', { team_id: TEAM }, { teamId: TEAM }],
    ['production', { environment: 'production' }, { environment: 'production' }],
    ['staging', { environment: 'staging' }, { environment: 'staging' }],
    ['development', { environment: 'development' }, { environment: 'development' }],
    ['combined', { date_range: '90d', service_id: SERVICE, team_id: TEAM, environment: 'staging' },
      { dateRange: '90d', serviceId: SERVICE, teamId: TEAM, environment: 'staging' }],
  ])('%s → computed with exactly those filters', async (_name, query, expected) => {
    const { getComprehensiveMetrics, status, json } = await call(query);
    expect(status).not.toHaveBeenCalled();
    expect(getComprehensiveMetrics).toHaveBeenCalledTimes(1);
    expect(getComprehensiveMetrics.mock.calls[0]).toEqual([{ organizationId: ORG, ...expected }]);
    expect(json).toHaveBeenCalledWith({ success: true, data: { ok: true } });
  });
});

describe('GET /api/metrics/dora — invalid filters are a plain 400', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['non-UUID service', { service_id: 'not-a-uuid' }, DORA_FILTER_MESSAGES.service_id],
    ['SQL in service', { service_id: "1' OR '1'='1" }, DORA_FILTER_MESSAGES.service_id],
    ['service=all', { service_id: 'all' }, DORA_FILTER_MESSAGES.service_id],
    ['repeated service', { service_id: [SERVICE, SERVICE] }, DORA_FILTER_MESSAGES.service_id],
    ['non-UUID team', { team_id: '42' }, DORA_FILTER_MESSAGES.team_id],
    ['object team', { team_id: { $ne: 1 } }, DORA_FILTER_MESSAGES.team_id],
    ['unknown environment', { environment: 'prod' }, DORA_FILTER_MESSAGES.environment],
    ['wrong-case environment', { environment: 'Production' }, DORA_FILTER_MESSAGES.environment],
    ['repeated environment', { environment: ['production', 'staging'] }, DORA_FILTER_MESSAGES.environment],
  ])('%s', async (_name, query, message) => {
    const { getComprehensiveMetrics, status, json } = await call(query);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: false, error: message });
    expect(getComprehensiveMetrics).not.toHaveBeenCalled();
    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toMatch(/syntax|uuid:|22P02|postgres|relation|column/i);
  });

  it('the messages are plain and name the accepted values', () => {
    expect(DORA_FILTER_MESSAGES.environment).toBe('Invalid environment. Must be one of: all, development, staging, production');
    expect(DORA_FILTER_MESSAGES.service_id).toBe('Invalid service_id. Must be a service UUID');
    expect(DORA_FILTER_MESSAGES.team_id).toBe('Invalid team_id. Must be a team UUID');
  });

  it('a DoraFilterError raised inside the service is also a 400', async () => {
    const { status, json } = await call({}, () => Promise.reject(new DoraFilterError('team_id', DORA_FILTER_MESSAGES.team_id)));
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: false, error: DORA_FILTER_MESSAGES.team_id });
  });
});

describe('GET /api/metrics/dora — a failure is a 500 with no error text', () => {
  it('omits the error message (it can carry database detail)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { status, json } = await call({}, () =>
      Promise.reject(new Error('invalid input syntax for type uuid: "x" (22P02) at relation "deployments"')));
    spy.mockRestore();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Failed to fetch DORA metrics' });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(/22P02|uuid|deployments/);
  });
});

describe('DORAMetricsService refuses invalid filters before any query', () => {
  const untouched = () => { throw new Error('the repository must not be called'); };
  const repository = {
    countFinishedByUtcDay: jest.fn(untouched),
    countFinishedByService: jest.fn(untouched),
  } as unknown as DORAMetricsRepository;
  const service = new DORAMetricsService(repository);

  it.each([
    [{ serviceId: 'nope' }],
    [{ teamId: 'nope' }],
    [{ environment: 'qa' }],
  ])('%j', async (bad) => {
    await expect(service.getComprehensiveMetrics({ organizationId: ORG, ...bad })).rejects.toBeInstanceOf(DoraFilterError);
    expect(repository.countFinishedByUtcDay).not.toHaveBeenCalled();
    expect(repository.countFinishedByService).not.toHaveBeenCalled();
  });

  it('and never runs without an organization', async () => {
    await expect(service.getComprehensiveMetrics({ dateRange: '7d' })).rejects.toThrow(/organization/);
    expect(repository.countFinishedByUtcDay).not.toHaveBeenCalled();
  });
});

describe('normalizeDoraFilters', () => {
  it('null = all; idempotent', () => {
    expect(normalizeDoraFilters({})).toEqual({ environment: null, serviceId: null, teamId: null });
    const once = normalizeDoraFilters({ serviceId: SERVICE.toUpperCase(), teamId: TEAM, environment: 'production' });
    expect(once).toEqual({ environment: 'production', serviceId: SERVICE, teamId: TEAM });
    expect(normalizeDoraFilters(once)).toEqual(once);
  });
});
