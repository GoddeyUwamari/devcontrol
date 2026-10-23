/**
 * GET /api/infrastructure reads the database only (infra-overview-plan.md
 * §18.3 PB-3). The Infrastructure Overview keeps one request to it only to
 * see the 402 resource limit (§17.5, Q-R4), so neither answer may cause an
 * AWS call: an organization under its limit (200) and one over it (402
 * RESOURCE_LIMIT_REACHED).
 *
 * The real router, limit middleware and controller run over HTTP on a local
 * port. Every AWS SDK v3 client's send (the shared @smithy/smithy-client
 * base), AWSClientFactory and the default awsCostService are spies. No DB:
 * the pool is a fixture. Pins existing behaviour; no backend code changes.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Client } from '@smithy/smithy-client';

const ORG_ID = '00000000-0000-0000-0000-0000000000d7';

const fixture = { resources: 0 };
const queries: string[] = [];

jest.mock('../../config/database', () => ({
  pool: {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM organizations')) {
        return { rows: [{ subscription_tier: 'free', max_services: null, max_users: null, max_deployments_per_month: null, billing_lifecycle_state: null, grace_period_ends_at: null }] };
      }
      if (sql.includes('COUNT(*)')) {
        const n = /FROM aws_resources/.test(sql) ? fixture.resources : 0;
        return { rows: [{ count: String(n), total: String(n) }] };
      }
      return { rows: [] };
    }),
  },
}));

jest.mock('../../middleware/auth.middleware', () => {
  const authenticate = (req: { user?: unknown; organizationId?: string }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1', organizationId: ORG_ID };
    req.organizationId = ORG_ID;
    next();
  };
  return { authenticate, authenticateToken: authenticate };
});
jest.mock('../../middleware/rateLimiter', () => ({ costSyncRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));

const costCalls: string[] = [];
jest.mock('../../services/aws-cost.service', () => {
  const spies = new Map<string, jest.Mock>();
  const service = new Proxy({}, {
    get: (_target, prop: string) => {
      if (prop === 'then') return undefined;
      if (!spies.has(prop)) spies.set(prop, jest.fn(() => { costCalls.push(prop); return Promise.resolve(undefined); }));
      return spies.get(prop);
    },
  });
  return { __esModule: true, default: service, AWSCostService: jest.fn(() => service) };
});

const factoryCalls: string[] = [];
jest.mock('../../services/aws-client-factory.service', () => ({
  AWSClientFactory: {
    createClients: jest.fn(async () => { factoryCalls.push('createClients'); throw new Error('no AWS in this test'); }),
    assumeAccountRole: jest.fn(async () => { factoryCalls.push('assumeAccountRole'); throw new Error('no AWS in this test'); }),
    validateCredentials: jest.fn(async () => { factoryCalls.push('validateCredentials'); return false; }),
  },
}));

import infrastructureRoutes from '../../routes/infrastructure.routes';

let server: Server;
let base: string;
const send = jest.spyOn(Client.prototype, 'send');

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/infrastructure', infrastructureRoutes);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  send.mockRestore();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  queries.length = 0;
  costCalls.length = 0;
  factoryCalls.length = 0;
  send.mockClear();
});

function expectNoAws() {
  expect(send).not.toHaveBeenCalled();
  expect(costCalls).toEqual([]);
  expect(factoryCalls).toEqual([]);
}

describe('GET /api/infrastructure makes no AWS call (PB-3)', () => {
  it('under the limit: 200 from the database alone', async () => {
    fixture.resources = 3;
    const res = await fetch(`${base}/api/infrastructure`);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(queries.some((q) => q.includes('FROM organizations'))).toBe(true);
    expectNoAws();
  });

  it('over the limit: 402 RESOURCE_LIMIT_REACHED from the database alone', async () => {
    fixture.resources = 21; // the free tier allows 20
    const res = await fetch(`${base}/api/infrastructure`);
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('RESOURCE_LIMIT_REACHED');
    expectNoAws();
  });

  it('with a resource_type filter: still the database alone', async () => {
    fixture.resources = 3;
    const res = await fetch(`${base}/api/infrastructure?resource_type=ec2`);
    expect(res.status).toBe(200);
    expectNoAws();
  });
});
