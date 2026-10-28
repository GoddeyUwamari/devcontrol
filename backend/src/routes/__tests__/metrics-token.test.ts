/**
 * Coverage for the bearer-token gate on GET /metrics.
 *
 * GET /metrics answers 200 with the registry output only when METRICS_TOKEN
 * is set and the request carries `Authorization: Bearer <METRICS_TOKEN>`.
 * Every other request gets exactly the response the app gives an unknown
 * path, so the endpoint's existence is not revealed.
 *
 * The registry is replaced with a fixed stand-in so the 200 body can be
 * compared with what the route served before the gate was added.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const METRICS_BODY = '# HELP services_total Total services\n# TYPE services_total gauge\nservices_total 3\n';
const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

jest.mock('../../metrics', () => ({
  register: {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    metrics: jest.fn(async () => '# HELP services_total Total services\n# TYPE services_total gauge\nservices_total 3\n'),
  },
}));

import metricsRoutes from '../metrics.routes';
import { notFoundHandler } from '../../middleware/error-handler';

const TOKEN = 'metrics-test-token-0123456789';

describe('GET /metrics — bearer token required', () => {
  let server: http.Server;
  let baseUrl: string;
  const originalToken = process.env.METRICS_TOKEN;

  beforeAll((done) => {
    const app = express();
    app.use(metricsRoutes);
    app.use(notFoundHandler);
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (originalToken === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = originalToken;
    }
    server.close(done);
  });

  beforeEach(() => {
    process.env.METRICS_TOKEN = TOKEN;
  });

  const get = (urlPath: string, authorization?: string) =>
    fetch(`${baseUrl}${urlPath}`, {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    });

  // A denied request must be indistinguishable from a request for a path
  // that does not exist, apart from the path echoed in the error message.
  const expectNotFound = async (res: Response) => {
    expect(res.status).toBe(404);
    const body = await res.json();
    const unknown = await get('/no-such-path');
    const unknownBody = await unknown.json();
    expect(res.headers.get('content-type')).toBe(unknown.headers.get('content-type'));
    expect(body).toEqual({
      ...unknownBody,
      error: unknownBody.error.replace('/no-such-path', '/metrics'),
    });
  };

  it('returns 404 without an Authorization header', async () => {
    await expectNotFound(await get('/metrics'));
  });

  it('returns 404 for a wrong token of the same length', async () => {
    const wrong = TOKEN.slice(0, -1) + (TOKEN.endsWith('x') ? 'y' : 'x');
    await expectNotFound(await get('/metrics', `Bearer ${wrong}`));
  });

  it('returns 404 for a token of a different length', async () => {
    await expectNotFound(await get('/metrics', `Bearer ${TOKEN}extra`));
    await expectNotFound(await get('/metrics', `Bearer ${TOKEN.slice(0, 4)}`));
  });

  it('returns 404 for the right token without the Bearer scheme', async () => {
    await expectNotFound(await get('/metrics', TOKEN));
    await expectNotFound(await get('/metrics', `Basic ${TOKEN}`));
  });

  it('returns 404 for every request when METRICS_TOKEN is unset', async () => {
    delete process.env.METRICS_TOKEN;
    await expectNotFound(await get('/metrics'));
    await expectNotFound(await get('/metrics', `Bearer ${TOKEN}`));
    await expectNotFound(await get('/metrics', 'Bearer '));
    await expectNotFound(await get('/metrics', 'Bearer undefined'));
  });

  it('returns 404 for every request when METRICS_TOKEN is empty', async () => {
    process.env.METRICS_TOKEN = '';
    await expectNotFound(await get('/metrics'));
    await expectNotFound(await get('/metrics', 'Bearer '));
  });

  it('returns 200 with the unchanged registry output for the correct token', async () => {
    const res = await get('/metrics', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(METRICS_CONTENT_TYPE);
    expect(await res.text()).toBe(METRICS_BODY);
  });
});
