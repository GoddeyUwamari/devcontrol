/**
 * Coverage for temporarily disabling deployment live log streaming.
 * POST /api/logs/stream/:deploymentId must refuse to start a stream and must
 * not reach the CloudWatch Logs SDK, whatever the request body contains,
 * until streaming is reimplemented with a server-determined log source.
 *
 * The auth middleware is replaced with a minimal stand-in that rejects
 * requests without an Authorization header, so these tests also confirm the
 * route is still mounted behind `authenticate`.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';

const mockCloudWatchSend = jest.fn();
const mockCloudWatchClientCtor = jest.fn();
const mockFilterLogEventsCtor = jest.fn();

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn().mockImplementation((config: unknown) => {
    mockCloudWatchClientCtor(config);
    return { send: mockCloudWatchSend };
  }),
  FilterLogEventsCommand: jest.fn().mockImplementation((input: unknown) => {
    mockFilterLogEventsCtor(input);
    return { input };
  }),
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.organizationId = 'org-test-1';
    next();
  },
}));

const OWNED_DEPLOYMENT_ID = 'dep-owned-1';
const mockFindById = jest.fn(async (id: string, organizationId: string) =>
  id === OWNED_DEPLOYMENT_ID && organizationId === 'org-test-1'
    ? { id, organizationId }
    : null
);

jest.mock('../../repositories/deployments.repository', () => ({
  DeploymentsRepository: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
  })),
}));

import logsRoutes from '../logs.routes';
import { LogStreamingService } from '../../services/logStreaming';

describe('POST /api/logs/stream/:deploymentId — temporarily disabled', () => {
  let server: http.Server;
  let baseUrl: string;
  let startLogStreamSpy: jest.SpyInstance;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.set('wsServer', { emitToOrganization: jest.fn() });
    app.use('/api', logsRoutes);
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Never let a real polling interval start, even if a regression routes
    // a request into the service.
    startLogStreamSpy = jest
      .spyOn(LogStreamingService.prototype, 'startLogStream')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    startLogStreamSpy.mockRestore();
  });

  const post = (deploymentId: string, body: unknown, authed = true) =>
    fetch(`${baseUrl}/api/logs/stream/${deploymentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authed ? { Authorization: 'Bearer test' } : {}),
      },
      body: JSON.stringify(body),
    });

  const expectNoCloudWatchAccess = () => {
    expect(startLogStreamSpy).not.toHaveBeenCalled();
    expect(mockCloudWatchClientCtor).not.toHaveBeenCalled();
    expect(mockFilterLogEventsCtor).not.toHaveBeenCalled();
    expect(mockCloudWatchSend).not.toHaveBeenCalled();
  };

  it('refuses with a non-success status for an owned deployment and valid-looking body', async () => {
    const res = await post(OWNED_DEPLOYMENT_ID, {
      logGroupName: '/aws/ecs/deployments',
      logStreamName: OWNED_DEPLOYMENT_ID,
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    expectNoCloudWatchAccess();
  });

  it.each([
    ['arbitrary absolute group', { logGroupName: '/some/other/group', logStreamName: 's' }],
    ['arbitrary group, no stream', { logGroupName: 'another-group' }],
    ['group via alternate key', { logGroup: '/some/other/group', logStreamName: 's' }],
    ['empty body', {}],
  ])('client-supplied log source (%s) never reaches CloudWatch', async (_label, body) => {
    const res = await post(OWNED_DEPLOYMENT_ID, body);

    expect(res.ok).toBe(false);
    expectNoCloudWatchAccess();
  });

  it('client-supplied log source never reaches CloudWatch for a deployment the caller does not own', async () => {
    const res = await post('dep-other-org', {
      logGroupName: '/some/other/group',
      logStreamName: 's',
    });

    expect(res.ok).toBe(false);
    expectNoCloudWatchAccess();
  });

  it('response does not echo request-supplied values', async () => {
    const res = await post(OWNED_DEPLOYMENT_ID, {
      logGroupName: '/echo-check/group',
      logStreamName: 'echo-check-stream',
    });

    const text = await res.text();
    expect(text).not.toContain('/echo-check/group');
    expect(text).not.toContain('echo-check-stream');
  });

  it('still requires authentication', async () => {
    const res = await post(OWNED_DEPLOYMENT_ID, { logGroupName: '/g', logStreamName: 's' }, false);

    expect(res.status).toBe(401);
    expectNoCloudWatchAccess();
  });

  it('route module does not take a log source from request input', () => {
    // Guards against re-enabling the stream route with request-supplied log
    // group/stream names without also updating this test.
    const source = fs.readFileSync(path.join(__dirname, '..', 'logs.routes.ts'), 'utf-8');
    expect(source).not.toMatch(/req\.(body|query)/);
    expect(source).not.toMatch(/startLogStream\s*\(/);
  });
});

describe('POST /api/logs/stop/:deploymentId — ownership check unchanged', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.set('wsServer', { emitToOrganization: jest.fn() });
    app.use('/api', logsRoutes);
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => jest.clearAllMocks());

  const stop = (deploymentId: string) =>
    fetch(`${baseUrl}/api/logs/stop/${deploymentId}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test' },
    });

  it('returns 404 for a deployment outside the caller organization', async () => {
    const res = await stop('dep-other-org');

    expect(res.status).toBe(404);
    expect(mockFindById).toHaveBeenCalledWith('dep-other-org', 'org-test-1');
  });

  it('succeeds for an owned deployment without calling CloudWatch', async () => {
    const res = await stop(OWNED_DEPLOYMENT_ID);

    expect(res.status).toBe(200);
    expect(mockFindById).toHaveBeenCalledWith(OWNED_DEPLOYMENT_ID, 'org-test-1');
    expect(mockCloudWatchSend).not.toHaveBeenCalled();
    expect(mockFilterLogEventsCtor).not.toHaveBeenCalled();
  });
});
