/**
 * F12 (dashboard-step1.md §E, founder decision DB-D17 Nov 12): no socket event
 * carries a cross-organization aggregate.
 *
 * The 30-second business-metrics loop reads infrastructure_resources across
 * every organization. It used to send that figure (one organization's
 * AWS_COST_TOTAL row, or the sum over all organizations) to every
 * organization as `metrics:costs`. It now only sets Prometheus gauges.
 *
 *   - runtime: with cross-organization rows in both shapes, the loop calls
 *     no socket emitter at all;
 *   - static: nothing in backend/src emits `metrics:costs`; the platform-wide
 *     loops (src/metrics, src/jobs) never reach a socket emitter; and nothing
 *     broadcasts to every client (WebSocketServer.broadcast).
 */
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer } from '../websocket/server';
import { MetricsEvents } from '../services/metricsEvents';
import { updateBusinessMetrics } from '../metrics';

const SRC = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

function fakePool(costTotalRow: boolean) {
  return {
    query: jest.fn(async (sql: string) => {
      if (/FROM services/.test(sql)) return { rows: [{ total: '0', active: '0' }] };
      if (/resource_type = 'AWS_COST_TOTAL' AND aws_id/.test(sql)) return { rows: costTotalRow ? [{ cost_per_month: '99.00' }] : [] };
      if (/SUM\(cost_per_month\)/.test(sql)) return { rows: [{ total_cost: '1234.56' }] };
      if (/FROM organizations/.test(sql)) return { rows: [{ id: 'org-a' }, { id: 'org-b' }] };
      return { rows: [] };
    }),
  };
}

describe('the business-metrics loop emits no socket event', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['the sum over every organization (no AWS_COST_TOTAL row)', false],
    ["one organization's AWS_COST_TOTAL row", true],
  ])('with %s', async (_name, costTotalRow) => {
    const emitToOrganization = jest.spyOn(WebSocketServer.prototype, 'emitToOrganization').mockImplementation(() => {});
    const broadcast = jest.spyOn(WebSocketServer.prototype, 'broadcast').mockImplementation(() => {});
    const metricsEventMethods = (Object.getOwnPropertyNames(MetricsEvents.prototype) as Array<keyof MetricsEvents>)
      .filter((name) => name !== ('constructor' as never))
      .map((name) => jest.spyOn(MetricsEvents.prototype, name).mockImplementation(() => {}));
    const pool = fakePool(costTotalRow);

    await updateBusinessMetrics(pool);

    expect(emitToOrganization).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    for (const method of metricsEventMethods) expect(method).not.toHaveBeenCalled();
    // It never even lists organizations: it has nobody to send to.
    expect(pool.query.mock.calls.map(([sql]) => sql).some((sql: string) => /FROM organizations/.test(sql))).toBe(false);
  });
});

describe('static: no cross-organization aggregate reaches a socket', () => {
  const files = sourceFiles(SRC);

  it('nothing in backend/src emits metrics:costs', () => {
    expect(files.filter((f) => fs.readFileSync(f, 'utf8').includes('metrics:costs'))).toEqual([]);
  });

  it('the platform-wide loops (src/metrics, src/jobs) never reach a socket emitter', () => {
    const loops = files.filter((f) => f.startsWith(path.join(SRC, 'metrics')) || f.startsWith(path.join(SRC, 'jobs')));
    expect(loops.length).toBeGreaterThan(0);
    const emitter = /emitToOrganization|\.broadcast\(|MetricsEvents|DeploymentEvents|WebSocketServer|wsServer/;
    expect(loops.filter((f) => emitter.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('nothing broadcasts to every client', () => {
    const callers = files.filter((f) => !f.endsWith(path.join('websocket', 'server.ts')) && /\.broadcast\(/.test(fs.readFileSync(f, 'utf8')));
    expect(callers.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
