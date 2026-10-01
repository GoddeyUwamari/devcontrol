/**
 * Recent Activity feed: optimization events come only from ACTIVE
 * recommendations, DECIMAL-string savings (pg returns NUMERIC as strings)
 * render in cents instead of throwing and silently dropping the whole
 * optimization source, and anomaly_detections is not read as current
 * activity while anomaly detection is not operating. Pool mocked; no database.
 */
const mockClientQuery = jest.fn();

jest.mock('../../config/database', () => ({
  pool: {
    query: jest.fn(),
    connect: async () => ({ query: (...args: unknown[]) => mockClientQuery(...args), release: () => undefined }),
  },
}));

import { ActivityFeedService } from '../activity-feed.service';

const ORG = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const T = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const RECOMMENDATIONS = [
  { created_at: T(1), potential_savings: '0.48', issue: 'Unattached volume', severity: 'LOW' },
  { created_at: T(2), potential_savings: '0.00', issue: 'gp2 volume', severity: 'LOW' },
  { created_at: T(3), potential_savings: '12.5', issue: 'Idle Instance', severity: 'MEDIUM' },
];

function routeQueries(anomalyRows: unknown[] = [{ created_at: T(4), description: 'legacy tag-derived spike', severity: 'high' }]) {
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('set_config')) return { rows: [] };
    if (sql.includes('FROM cost_recommendations')) return { rows: RECOMMENDATIONS };
    if (sql.includes('FROM anomaly_detections')) return { rows: anomalyRows };
    return { rows: [] };
  });
}

const sqlFor = (table: string) => mockClientQuery.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.includes(`FROM ${table}`));

beforeEach(() => {
  mockClientQuery.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('optimization activity', () => {
  it('reads ACTIVE recommendations only -- a RESOLVED or DISMISSED row is never "found"', async () => {
    routeQueries();
    await new ActivityFeedService().getActivityFeed(ORG);
    const [sql] = sqlFor('cost_recommendations');
    expect(sql).toMatch(/status = 'ACTIVE'/);
  });

  it('DECIMAL-string savings render in cents and the source is not dropped', async () => {
    routeQueries();
    const events = await new ActivityFeedService().getActivityFeed(ORG);
    const optimization = events.filter((e) => e.type === 'optimization').map((e) => e.message);
    expect(optimization).toEqual([
      'Cost optimization found · Unattached volume — ~$0.48/month opportunity',
      'Cost optimization found · gp2 volume — ~$0.00/month opportunity',
      'Cost optimization found · Idle Instance — ~$12.50/month opportunity',
    ]);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('cost_recommendations'), expect.anything());
  });
});

describe('anomaly activity', () => {
  it('while ANOMALY_DETECTION_ACTIVE is false, anomaly_detections is not read and no anomaly event appears', async () => {
    routeQueries();
    const events = await new ActivityFeedService().getActivityFeed(ORG);
    expect(sqlFor('anomaly_detections')).toHaveLength(0);
    expect(events.some((e) => e.type === 'anomaly')).toBe(false);
  });

  it('with detection active, the existing anomaly source is unchanged', async () => {
    let Service!: typeof ActivityFeedService;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../anomaly-detection.service', () => ({ ...jest.requireActual('../anomaly-detection.service'), ANOMALY_DETECTION_ACTIVE: true }));
      Service = (await import('../activity-feed.service')).ActivityFeedService;
    });
    routeQueries();
    const events = await new Service().getActivityFeed(ORG);
    expect(events.filter((e) => e.type === 'anomaly').map((e) => e.message)).toEqual(['Anomaly detected · legacy tag-derived spike']);
  });
});
