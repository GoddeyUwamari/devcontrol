/**
 * GET /api/infrastructure reads stored rows through infrastructureRow.ts:
 * an EBS volume reports its own state ('available' / 'in-use', never
 * 'running'), and an S3 bucket's fixed $5 placeholder is reported as not
 * estimated (null).
 *
 * No DB and no AWS: the pool is a fixture that answers the repository's count
 * and list queries. Rows here are fixtures, not production data.
 */
import { Request, Response } from 'express';

const ORG_ID = '00000000-0000-0000-0000-0000000000c6';

const mockRows: Record<string, unknown>[] = [];
jest.mock('../../config/database', () => ({
  pool: {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: String(mockRows.length) }] };
      return { rows: mockRows };
    }),
  },
}));

import { InfrastructureController } from '../infrastructure.controller';

function row(id: string, resource_type: string, status: string, estimated_monthly_cost: string | null) {
  return {
    id, organization_id: ORG_ID, resource_id: id, resource_name: id, resource_type, region: 'us-east-1',
    status, estimated_monthly_cost, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  };
}

async function getAll(): Promise<any[]> {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const req = { user: { organizationId: ORG_ID }, query: {} } as unknown as Request;
  await new InfrastructureController().getAll(req, { json, status } as unknown as Response);
  expect(status).not.toHaveBeenCalled();
  return json.mock.calls[0][0].data;
}

describe('GET /api/infrastructure -- row truth', () => {
  beforeEach(() => { mockRows.length = 0; });

  it('an EBS volume reports its own state, never "running"', async () => {
    mockRows.push(row('volume-unattached', 'ebs', 'available', '8.00'), row('volume-attached', 'ebs', 'in-use', '8.00'));
    const data = await getAll();
    expect(data.find((r) => r.id === 'volume-unattached').status).toBe('available');
    expect(data.find((r) => r.id === 'volume-attached').status).toBe('in-use');
  });

  it("an S3 bucket's fixed $5 placeholder is reported as not estimated", async () => {
    mockRows.push(row('example-bucket', 's3', 'not_applicable', '5.00'), row('instance-a', 'ec2', 'running', '30.37'));
    const data = await getAll();
    expect(data.find((r) => r.id === 'example-bucket').costPerMonth).toBeNull();
    expect(data.find((r) => r.id === 'instance-a').costPerMonth).toBe(30.37);
  });
});
