/**
 * Ask AI with no model configured: POST /api/nl-query/execute answers
 * "Ask AI is temporarily unavailable" -- the retired keyword fallback never
 * parses or answers the question, and nothing is queried.
 *
 * ANTHROPIC_API_KEY is set to '' BEFORE any import: config/database.ts loads
 * .env, and dotenv never overrides a variable that already exists, so the
 * service sees no key even on a machine whose .env has one. The SDK is
 * mocked too, as a second guarantee that no real model can be reached.
 */
process.env.ANTHROPIC_API_KEY = '';
const mockModelCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockModelCreate } })),
}));

const mockCalls: string[] = [];
jest.mock('../../config/database', () => {
  const actual = jest.requireActual('../../config/database');
  const query = jest.fn(async (sql: string) => {
    mockCalls.push(sql);
    if (sql.includes('subscription_tier')) return { rows: [{ subscription_tier: 'pro', billing_lifecycle_state: null, grace_period_ends_at: null }] };
    return { rows: [] };
  });
  return { ...actual, pool: { query, connect: jest.fn() } };
});

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'u@example.test', organizationId: 'org-1', role: 'owner' };
    req.organizationId = 'org-1';
    next();
  },
}));

const mockGatherCostContext = jest.fn();
jest.mock('../../repositories/ai-chat-context.repository', () => ({
  AIChatContextRepository: jest.fn().mockImplementation(() => ({ gatherCostContext: mockGatherCostContext })),
}));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import nlQueryRoutes from '../nl-query.routes';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/api/nl-query', nlQueryRoutes);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  jest.restoreAllMocks();
});

async function ask(query: string) {
  mockCalls.length = 0;
  const res = await fetch(`${baseUrl}/api/nl-query/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const dataQueries = () => mockCalls.filter(sql => !sql.includes('subscription_tier') && !sql.includes('nl_query_analytics'));

describe('no model configured', () => {
  it.each([
    'show running ec2 instances',
    'ec2',
    'what is my aws spend',
    'ec2 instances not running',
    'buckets that are not public',
    'ec2 over $1,000',
    'is my spend up',
  ])('"%s" -> unavailable, no keyword answer, no query, no model call', async question => {
    const { status, body } = await ask(question);
    expect(status).toBe(200);
    expect(body.data.data.outcome).toBe('unavailable');
    expect(body.data.data.summary).toBe('Ask AI is temporarily unavailable.');
    expect(body.data.data.rows).toEqual([]);
    expect(dataQueries()).toEqual([]);
    expect(mockGatherCostContext).not.toHaveBeenCalled();
    expect(mockModelCreate).not.toHaveBeenCalled();
  });

  it('unsupported questions still get their specific limitation first', async () => {
    const { body } = await ask('Why is EC2 cost high?');
    expect(body.data.data.outcome).toBe('not_supported');
  });
});
