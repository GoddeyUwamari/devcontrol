import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api } from '@/lib/api';
import { complianceFrameworksService } from '../compliance-frameworks.service';

/**
 * Regression coverage for the Custom Compliance Frameworks frontend
 * authentication bug (Phase 2, Blocker 1): compliance-frameworks.service.ts
 * used to call native fetch() with `credentials: 'include'` and never sent
 * an Authorization header, so every one of its 11 methods hit the backend's
 * authenticateToken middleware (backend/src/middleware/auth.middleware.ts,
 * which only ever reads the Authorization header, never cookies) and failed
 * with "No authentication token provided" in production. The fix routes
 * every method through the shared `api` Axios client (lib/api.ts), whose
 * request interceptor injects `Authorization: Bearer <accessToken>` from
 * localStorage -- the same mechanism security-hub.service.ts uses (see
 * security-hub.service.test.ts for the pattern this mirrors).
 *
 * Layers of coverage, on purpose:
 *  - "uses the shared api client" spies on api.get/post/put/delete: proves
 *    each of the 11 methods delegates to the shared client with the exact
 *    backend path, method, and body.
 *  - "no raw fetch" combines a static check of the service source with a
 *    runtime check that global fetch is never called.
 *  - "authentication contract" does NOT mock '@/lib/api'. It lets the real
 *    shared Axios instance and its real request interceptor run, replacing
 *    only the transport (the Axios adapter) with an in-memory fake that
 *    enforces the backend's actual Bearer-only contract. If the service is
 *    ever swapped back to a bare fetch() that forgets the header, these
 *    tests fail; a plain "was api.get called" spy alone would not catch a
 *    partial regression.
 *
 * Only synthetic tokens are used here -- never a real credential.
 */

const BASE = '/api/compliance-frameworks';
const SYNTHETIC_TOKEN = 'test-only-synthetic-token';

const framework = { id: 'fw-1', organization_id: 'org-1', name: 'Internal Policy', framework_type: 'custom' };
const rule = { id: 'rule-1', framework_id: 'fw-1', rule_code: 'R-1', rule_type: 'property_check' };
const scan = { id: 'scan-1', organization_id: 'org-1', framework_id: 'fw-1', status: 'completed' };
const finding = { id: 'finding-1', resource_id: 'res-1', status: 'pass' };

/** An Axios-shaped failure (what the real client rejects with for an HTTP error). */
function axiosHttpError(status: number, data: unknown) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, statusText: 'x', data, headers: {}, config: {} },
  };
}

/** An Axios-shaped failure with no HTTP response at all (network down, DNS, CORS, ...). */
function axiosNetworkError() {
  return { isAxiosError: true, message: 'Network Error', code: 'ERR_NETWORK' };
}

// ---------------------------------------------------------------------------
// A. Every method delegates to the shared api client, with the exact path/body.
// ---------------------------------------------------------------------------

describe('compliance-frameworks.service -- uses the shared api client', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let postSpy: ReturnType<typeof vi.spyOn>;
  let putSpy: ReturnType<typeof vi.spyOn>;
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: {} } } as any);
    postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: {} } } as any);
    putSpy = vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true, data: {} } } as any);
    deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getFrameworks calls api.get on the base path', async () => {
    await complianceFrameworksService.getFrameworks();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(BASE);
  });

  it('getFramework calls api.get on /:id', async () => {
    await complianceFrameworksService.getFramework('fw-1');
    expect(getSpy).toHaveBeenCalledWith(`${BASE}/fw-1`);
  });

  it('createFramework calls api.post on the base path with the framework body', async () => {
    const payload = { name: 'Internal Policy', framework_type: 'custom' as const };
    await complianceFrameworksService.createFramework(payload);
    expect(postSpy).toHaveBeenCalledWith(BASE, payload);
  });

  it('updateFramework calls api.put on /:id with the updates body', async () => {
    const updates = { name: 'Renamed' };
    await complianceFrameworksService.updateFramework('fw-1', updates);
    expect(putSpy).toHaveBeenCalledWith(`${BASE}/fw-1`, updates);
  });

  it('deleteFramework calls api.delete on /:id', async () => {
    await complianceFrameworksService.deleteFramework('fw-1');
    expect(deleteSpy).toHaveBeenCalledWith(`${BASE}/fw-1`);
  });

  it('createRule calls api.post on /:frameworkId/rules with the rule body', async () => {
    const payload = { rule_code: 'R-1', title: 'x', severity: 'high' as const, category: 'custom' as const, rule_type: 'property_check' as const, conditions: {}, recommendation: 'x' };
    await complianceFrameworksService.createRule('fw-1', payload);
    expect(postSpy).toHaveBeenCalledWith(`${BASE}/fw-1/rules`, payload);
  });

  it('updateRule calls api.put on /rules/:ruleId with the updates body', async () => {
    const updates = { title: 'Renamed rule' };
    await complianceFrameworksService.updateRule('rule-1', updates);
    expect(putSpy).toHaveBeenCalledWith(`${BASE}/rules/rule-1`, updates);
  });

  it('deleteRule calls api.delete on /rules/:ruleId', async () => {
    await complianceFrameworksService.deleteRule('rule-1');
    expect(deleteSpy).toHaveBeenCalledWith(`${BASE}/rules/rule-1`);
  });

  it('executeScan calls api.post on /:frameworkId/scan with { resource_filters }', async () => {
    await complianceFrameworksService.executeScan('fw-1', { region: 'us-east-1' });
    expect(postSpy).toHaveBeenCalledWith(`${BASE}/fw-1/scan`, { resource_filters: { region: 'us-east-1' } });
  });

  it('getScans calls api.get on /scans/list, with and without a limit', async () => {
    await complianceFrameworksService.getScans();
    expect(getSpy).toHaveBeenCalledWith(`${BASE}/scans/list`);

    await complianceFrameworksService.getScans(25);
    expect(getSpy).toHaveBeenCalledWith(`${BASE}/scans/list?limit=25`);
  });

  it('getScanResults calls api.get on /scans/:scanId', async () => {
    await complianceFrameworksService.getScanResults('scan-1');
    expect(getSpy).toHaveBeenCalledWith(`${BASE}/scans/scan-1`);
  });
});

// ---------------------------------------------------------------------------
// B. No raw fetch: static (source) + runtime (global fetch never called).
// ---------------------------------------------------------------------------

describe('compliance-frameworks.service -- no raw fetch / bespoke authentication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('has no fetch(), cookie credentials, or hand-built auth in the source (comments excluded)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const raw = await fs.readFile(path.join(process.cwd(), 'lib/services/compliance-frameworks.service.ts'), 'utf-8');
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/credentials\s*:/);
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/NEXT_PUBLIC_API_URL/);
    expect(source).toMatch(/from\s+['"]@\/lib\/api['"]/);
  });

  it('never calls global fetch for any method', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('raw fetch must not be used by compliance-frameworks.service');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } } as any);
    vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: {} } } as any);
    vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true, data: {} } } as any);
    vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true } } as any);

    await complianceFrameworksService.getFrameworks();
    await complianceFrameworksService.getFramework('fw-1');
    await complianceFrameworksService.createFramework({ name: 'x' });
    await complianceFrameworksService.updateFramework('fw-1', { name: 'y' });
    await complianceFrameworksService.deleteFramework('fw-1');
    await complianceFrameworksService.createRule('fw-1', {
      rule_code: 'R-1', title: 'x', severity: 'high', category: 'custom', rule_type: 'property_check', conditions: {}, recommendation: 'x',
    });
    await complianceFrameworksService.updateRule('rule-1', { title: 'y' });
    await complianceFrameworksService.deleteRule('rule-1');
    await complianceFrameworksService.executeScan('fw-1');
    await complianceFrameworksService.getScans();
    await complianceFrameworksService.getScanResults('scan-1');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C. Response mapping is unchanged.
// ---------------------------------------------------------------------------

describe('compliance-frameworks.service -- response mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getFrameworks returns response.data.data (the array, not the envelope)', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [framework] } } as any);
    expect(await complianceFrameworksService.getFrameworks()).toEqual([framework]);
  });

  it('getFramework returns { framework, rules } from response.data.data', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: { framework, rules: [rule] } } } as any);
    expect(await complianceFrameworksService.getFramework('fw-1')).toEqual({ framework, rules: [rule] });
  });

  it('createFramework / updateFramework return the created/updated framework', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: framework } } as any);
    expect(await complianceFrameworksService.createFramework({ name: 'x' })).toEqual(framework);

    vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true, data: framework } } as any);
    expect(await complianceFrameworksService.updateFramework('fw-1', { name: 'x' })).toEqual(framework);
  });

  it('deleteFramework / deleteRule / executeScan resolve to undefined regardless of the response body', async () => {
    vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true, message: 'Framework deleted successfully' } } as any);
    await expect(complianceFrameworksService.deleteFramework('fw-1')).resolves.toBeUndefined();
    await expect(complianceFrameworksService.deleteRule('rule-1')).resolves.toBeUndefined();

    vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, message: 'Compliance scan initiated.' } } as any);
    await expect(complianceFrameworksService.executeScan('fw-1')).resolves.toBeUndefined();
  });

  it('getScans returns the scan array; getScanResults returns { scan, findings }', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { success: true, data: [scan] } } as any);
    expect(await complianceFrameworksService.getScans()).toEqual([scan]);

    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { success: true, data: { scan, findings: [finding] } } } as any);
    expect(await complianceFrameworksService.getScanResults('scan-1')).toEqual({ scan, findings: [finding] });
  });
});

// ---------------------------------------------------------------------------
// D. Error mapping: backend `error` message preserved; safe fallback otherwise.
// ---------------------------------------------------------------------------

describe('compliance-frameworks.service -- error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the backend error message on an HTTP failure, not the generic Axios text', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(axiosHttpError(401, { success: false, error: 'No authentication token provided' }));

    const error = await complianceFrameworksService.getFrameworks().catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('No authentication token provided');
    expect(error.message).not.toMatch(/Request failed with status code/);
  });

  it('every method preserves the backend error message on failure', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(axiosHttpError(500, { success: false, error: 'Boom from backend' }));
    vi.spyOn(api, 'post').mockRejectedValue(axiosHttpError(400, { success: false, error: 'UNSUPPORTED_RULE_TYPE', code: 'x' }));
    vi.spyOn(api, 'put').mockRejectedValue(axiosHttpError(400, { success: false, error: 'RESERVED_FRAMEWORK_NAME' }));
    vi.spyOn(api, 'delete').mockRejectedValue(axiosHttpError(404, { success: false, error: 'Framework not found' }));

    await expect(complianceFrameworksService.getFrameworks()).rejects.toMatchObject({ message: 'Boom from backend' });
    await expect(complianceFrameworksService.createFramework({ name: 'x' })).rejects.toMatchObject({ message: 'UNSUPPORTED_RULE_TYPE' });
    await expect(complianceFrameworksService.updateFramework('fw-1', {})).rejects.toMatchObject({ message: 'RESERVED_FRAMEWORK_NAME' });
    await expect(complianceFrameworksService.deleteFramework('fw-1')).rejects.toMatchObject({ message: 'Framework not found' });
  });

  it('a network-style failure (no HTTP response) gets the per-method safe fallback', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(axiosNetworkError());
    await expect(complianceFrameworksService.getFrameworks()).rejects.toMatchObject({ message: 'Failed to fetch frameworks' });
    await expect(complianceFrameworksService.getScans()).rejects.toMatchObject({ message: 'Failed to fetch scans' });
  });

  it('a non-Axios failure gets the safe fallback rather than leaking its own message', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('Cannot read properties of undefined'));
    const error = await complianceFrameworksService.getFramework('fw-1').catch((e) => e);
    expect(error.message).toBe('Failed to fetch framework');
  });

  it('an error body without a usable string message falls back safely', async () => {
    const postSpy = vi.spyOn(api, 'post');
    for (const data of ['<html>502 Bad Gateway</html>', { success: false }, { error: { nested: 'object' } }, { error: '' }, null]) {
      postSpy.mockRejectedValueOnce(axiosHttpError(502, data));
      const error = await complianceFrameworksService.executeScan('fw-1').catch((e) => e);
      expect(error.message).toBe('Failed to execute scan');
    }
  });
});

// ---------------------------------------------------------------------------
// E. Authentication contract: real shared `api` client + real interceptor, fake transport.
// ---------------------------------------------------------------------------

function getAuthHeader(config: InternalAxiosRequestConfig): string | undefined {
  const value = AxiosHeaders.from(config.headers as any).get('Authorization');
  return typeof value === 'string' ? value : undefined;
}

interface RecordedCall {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  withCredentials: boolean | undefined;
}

/** Mirrors backend/src/middleware/auth.middleware.ts's `authenticate` exactly: reject with
 * the real 401 body when Authorization is missing or not Bearer, otherwise answer from
 * `responses` keyed by "METHOD URL" (several methods here share a URL with a different
 * verb, e.g. GET/POST both on the base path, so the URL alone isn't a unique key).
 * Records every request it sees. */
function installFakeBackend(responses: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const authorization = getAuthHeader(config);
    calls.push({ method: config.method, url: config.url, authorization, withCredentials: config.withCredentials });
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw {
        isAxiosError: true,
        message: 'Request failed with status code 401',
        config,
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: { success: false, error: 'No authentication token provided' },
          headers: {},
          config,
        },
      };
    }
    const key = `${(config.method ?? '').toUpperCase()} ${config.url ?? ''}`;
    return { data: responses[key] ?? { success: true, data: {} }, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  return calls;
}

const FAKE_RESPONSES: Record<string, unknown> = {
  [`GET ${BASE}`]: { success: true, data: [framework] },
  [`GET ${BASE}/fw-1`]: { success: true, data: { framework, rules: [rule] } },
  [`POST ${BASE}`]: { success: true, data: framework },
  [`PUT ${BASE}/fw-1`]: { success: true, data: framework },
  [`DELETE ${BASE}/fw-1`]: { success: true, message: 'Framework deleted successfully' },
  [`POST ${BASE}/fw-1/rules`]: { success: true, data: rule },
  [`PUT ${BASE}/rules/rule-1`]: { success: true, data: rule },
  [`DELETE ${BASE}/rules/rule-1`]: { success: true, message: 'Rule deleted successfully' },
  [`POST ${BASE}/fw-1/scan`]: { success: true, message: 'Compliance scan initiated.' },
  [`GET ${BASE}/scans/list`]: { success: true, data: [scan] },
  [`GET ${BASE}/scans/scan-1`]: { success: true, data: { scan, findings: [finding] } },
};

const ALL_METHODS: Array<[string, () => Promise<unknown>]> = [
  ['getFrameworks', () => complianceFrameworksService.getFrameworks()],
  ['getFramework', () => complianceFrameworksService.getFramework('fw-1')],
  ['createFramework', () => complianceFrameworksService.createFramework({ name: 'x' })],
  ['updateFramework', () => complianceFrameworksService.updateFramework('fw-1', { name: 'x' })],
  ['deleteFramework', () => complianceFrameworksService.deleteFramework('fw-1')],
  ['createRule', () => complianceFrameworksService.createRule('fw-1', {
    rule_code: 'R-1', title: 'x', severity: 'high', category: 'custom', rule_type: 'property_check', conditions: {}, recommendation: 'x',
  })],
  ['updateRule', () => complianceFrameworksService.updateRule('rule-1', { title: 'x' })],
  ['deleteRule', () => complianceFrameworksService.deleteRule('rule-1')],
  ['executeScan', () => complianceFrameworksService.executeScan('fw-1')],
  ['getScans', () => complianceFrameworksService.getScans()],
  ['getScanResults', () => complianceFrameworksService.getScanResults('scan-1')],
];

describe('compliance-frameworks.service -- authentication contract (real api client + real interceptor)', () => {
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(ALL_METHODS)('%s sends Authorization: Bearer <token> supplied by the shared interceptor', async (_name, call) => {
    localStorage.setItem('accessToken', SYNTHETIC_TOKEN);
    const calls = installFakeBackend(FAKE_RESPONSES);

    await call();

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`);
  });

  it.each(ALL_METHODS)('%s rejects with the real 401 contract when no token exists (the production bug)', async (_name, call) => {
    // No accessToken in localStorage -- the shared interceptor has nothing to
    // inject, exactly reproducing the request the old raw fetch() sent in
    // production (this is the exact bug this fix closes).
    installFakeBackend(FAKE_RESPONSES);

    await expect(call()).rejects.toMatchObject({ message: 'No authentication token provided' });
  });

  it('never opts into cookie credentials for any method', async () => {
    localStorage.setItem('accessToken', SYNTHETIC_TOKEN);
    const calls = installFakeBackend(FAKE_RESPONSES);

    for (const [, call] of ALL_METHODS) await call();

    expect(calls).toHaveLength(ALL_METHODS.length);
    expect(calls.every((c) => !c.withCredentials)).toBe(true);
  });

  it('framework creation and scan execution return the real mapped values through the real client end to end', async () => {
    localStorage.setItem('accessToken', SYNTHETIC_TOKEN);
    installFakeBackend(FAKE_RESPONSES);

    expect(await complianceFrameworksService.createFramework({ name: 'x' })).toEqual(framework);
    expect(await complianceFrameworksService.executeScan('fw-1')).toBeUndefined();
    expect(await complianceFrameworksService.getScanResults('scan-1')).toEqual({ scan, findings: [finding] });
  });
});
