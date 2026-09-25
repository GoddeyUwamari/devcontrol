/**
 * aws_resources.tags holds a resource's own AWS tags -- customer-set text
 * that no DevControl process writes a measurement into. No anomaly path may
 * treat a tag value as a measured metric: not the former CPU (cpu_avg), cost
 * (estimated_monthly_cost), Lambda invocation (invocations/invocations_avg)
 * or error-rate (error_rate) detectors, and not custom rules (which read
 * tags->'<metric>' for labels like "EC2 CPU Usage"). Nothing tag-derived is
 * persisted, displayed, counted as critical, scored, or sent for AI
 * explanation -- and nothing substitutes another value in its place.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { AnomalyDetectionService } from '../anomaly-detection.service';
import { CustomAnomalyRulesService } from '../custom-anomaly-rules.service';
import { AnomalyDetectionJob } from '../../jobs/anomaly-detection.job';
import { AnomalyRepository } from '../../repositories/anomaly.repository';
import { AnomalyAIService } from '../anomaly-ai.service';

// Every tag a former detector read, set to values that used to trigger it.
const TAGGED_RESOURCE = {
  resource_id: 'i-tagged',
  resource_name: 'tagged',
  resource_type: 'ec2',
  region: 'us-east-1',
  tags: { cpu_avg: '95', estimated_monthly_cost: '9999', invocations: '100000', invocations_avg: '10', error_rate: '50', ec2_cpu: '99' },
};

function poolReturningTags() {
  const query = jest.fn(async (sql: string) => (/FROM aws_resources/i.test(sql) ? { rows: [TAGGED_RESOURCE] } : { rows: [] }));
  return { pool: { query } as any, query };
}

describe('built-in anomaly detectors read no tag-derived measurements', () => {
  it('a resource tagged with every former detector key produces no anomaly', async () => {
    const { pool } = poolReturningTags();

    const anomalies = await new AnomalyDetectionService(pool).scanForAnomalies('org-1', pool);

    expect(anomalies).toEqual([]);
  });

  it('no query is issued at all -- no tag, and no substitute source, is read', async () => {
    const { pool, query } = poolReturningTags();

    await new AnomalyDetectionService(pool).scanForAnomalies('org-1', pool);

    expect(query).not.toHaveBeenCalled();
  });
});

describe('custom rules are kept but not evaluated against tags', () => {
  it('enabled rules on tag-bearing resources produce no anomaly and never read aws_resources', async () => {
    const service = new CustomAnomalyRulesService({ query: jest.fn() } as any);
    const client = { query: jest.fn(async () => ({ rows: [TAGGED_RESOURCE] })) } as any;
    jest.spyOn(service, 'getRules').mockResolvedValue([
      { id: 'r1', organizationId: 'org-1', name: 'EC2 CPU', metric: 'ec2_cpu', condition: 'greater_than', threshold: 80, timeWindow: '1h', severity: 'critical', enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 'r2', organizationId: 'org-1', name: 'Cost', metric: 'total_cost', condition: 'greater_than', threshold: 1, timeWindow: '1h', severity: 'warning', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const anomalies = await service.evaluateRules('org-1', client);

    expect(anomalies).toEqual([]);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('the scheduled/manual job persists nothing and sends nothing for AI explanation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('triggerManual on tag-bearing data never saves or explains an anomaly', async () => {
    const client = {
      query: jest.fn(async (sql: string) => (/FROM aws_resources/i.test(sql) ? { rows: [TAGGED_RESOURCE] } : { rows: [], rowCount: 0 })),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client), query: client.query } as any;
    jest.spyOn(CustomAnomalyRulesService.prototype, 'getRules').mockResolvedValue([
      { id: 'r1', organizationId: 'org-1', name: 'EC2 CPU', metric: 'ec2_cpu', condition: 'greater_than', threshold: 80, timeWindow: '1h', severity: 'critical', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const save = jest.spyOn(AnomalyRepository.prototype, 'saveAnomalies').mockResolvedValue();
    const explain = jest.spyOn(AnomalyAIService.prototype, 'explainAnomalies');

    const result = await new AnomalyDetectionJob(pool).triggerManual('org-1');

    expect(result).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
    const sqlIssued = client.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sqlIssued).not.toMatch(/aws_resources/i);
  });
});

describe('an empty scan is not reported as healthy infrastructure', () => {
  it('the mounted POST /api/anomalies/scan handler makes no health claim', () => {
    const serverSource = readFileSync(join(__dirname, '../../server.ts'), 'utf8');

    expect(serverSource).not.toMatch(/infrastructure is healthy/);
    expect(serverSource).toMatch(/Anomaly detection on measured data is not currently active/);
  });
});
