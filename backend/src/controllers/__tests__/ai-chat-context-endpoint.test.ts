/**
 * GET /api/ai-chat/context returns the AI context to any authenticated Pro
 * user of the organization. It must never carry raw database, SQL, or
 * infrastructure error text: a failed getter's section keeps only a safe
 * diagnostic (the raw message goes to the server log), and an unexpected
 * failure of the whole request returns a generic error.
 *
 * No DB needed: the pool and the Cost Explorer calls are stubbed to fail.
 */
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { AIChatController } from '../ai-chat.controller';
import awsCostService from '../../services/aws-cost.service';

const RAW_DB_ERROR = 'relation "aws_accounts" does not exist at character 36 (SELECT account_id, region FROM aws_accounts WHERE org_id = $1)';

function mockReqRes() {
  const req = { user: { organizationId: '00000000-0000-0000-0000-000000000001' } } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

describe('GET /api/ai-chat/context -- no raw error details reach the user', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('failed getters return "error" sections with safe reasons -- raw database text stays in the server log', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error(RAW_DB_ERROR)) } as unknown as Pool;
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error(RAW_DB_ERROR));
    const controller = new AIChatController(throwingPool);
    const { req, res, json, status } = mockReqRes();

    await controller.getContext(req, res);

    expect(status).not.toHaveBeenCalled();
    const body = json.mock.calls[0][0];
    expect(body.success).toBe(true);
    for (const name of ['discovery', 'account', 'services', 'resources', 'dora']) {
      expect({ name, state: body.data[name].state, data: body.data[name].data }).toEqual({ name, state: 'error', data: null });
      expect(body.data[name].reason).toMatch(/could not be retrieved\.$/);
    }
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/relation|does not exist|aws_accounts WHERE|SELECT|character 36/);
    // The raw failure is still logged server-side, not swallowed.
    expect(consoleError.mock.calls.some((call: unknown[]) => call.some(arg => String(arg).includes('does not exist')))).toBe(true);
  });

  it('an unexpected failure of the whole request returns a generic error, not the raw message', async () => {
    const controller = new AIChatController({} as Pool);
    jest.spyOn((controller as any).contextRepo, 'gatherContext').mockRejectedValue(new Error(RAW_DB_ERROR));
    const { req, res, json, status } = mockReqRes();

    await controller.getContext(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Failed to load AI context' });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(/relation|aws_accounts|SELECT/);
    expect(consoleError).toHaveBeenCalledWith('[AI Chat Controller] Context error:', RAW_DB_ERROR);
  });
});
