import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api } from '@/lib/api';
import { securityHubService } from '../security-hub.service';

/**
 * Regression coverage for the Security Hub frontend authentication bug:
 * security-hub.service.ts used to call native fetch() with `credentials: 'include'` and
 * never sent an Authorization header, so every Security Hub request hit the backend's
 * authenticateToken middleware (backend/src/middleware/auth.middleware.ts, which only
 * ever reads the Authorization header, never cookies) and failed with
 * "No authentication token provided" in production. The fix routes every method through
 * the shared `api` Axios client (lib/api.ts), whose request interceptor injects
 * `Authorization: Bearer <accessToken>` from localStorage -- the same mechanism
 * soc2.service.ts uses (see soc2.service.test.ts for the pattern this mirrors).
 *
 * Layers of coverage, on purpose:
 *  - "uses the shared api client" spies on api.get/api.post: proves each method delegates
 *    to the shared client with the exact backend path.
 *  - "no raw fetch" combines a static check of the service source with a runtime check
 *    that global fetch is never called.
 *  - "authentication contract" does NOT mock '@/lib/api' or re-implement its token
 *    injection. It lets the real shared Axios instance and its real request interceptor
 *    run, replacing only the transport (the Axios adapter) with an in-memory fake that
 *    enforces the backend's actual Bearer-only contract. If the service is ever swapped
 *    back to a bare fetch() that forgets the header, these tests fail; a plain
 *    "was api.get called" spy alone would not catch a partial regression.
 *
 * Only synthetic tokens are used here -- never a real credential.
 */

const CAPABILITY_PATH = '/api/security-hub/capability';
const CIS_PATH = '/api/security-hub/frameworks/cis';
const PCI_PATH = '/api/security-hub/frameworks/pci';
const NIST_PATH = '/api/security-hub/frameworks/nist';
const SYNC_PATH = '/api/security-hub/sync';

const FALLBACKS = {
  capability: 'Failed to fetch Security Hub capability',
  cis: 'Failed to fetch CIS readiness',
  pci: 'Failed to fetch PCI DSS readiness',
  nist: 'Failed to fetch NIST SP 800-53 Rev. 5 readiness',
  sync: 'Failed to trigger Security Hub sync',
} as const;

const SYNTHETIC_TOKEN = 'test-only-synthetic-token';

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

const capabilityPayload = {
  success: true,
  capabilityStatus: 'ENABLED',
  syncStatus: 'COMPLETED',
  checkedAt: '2026-09-19T00:00:00.000Z',
  error: null,
  enabledStandards: [
    { standardsArn: 'arn:std/cis', standardsSubscriptionArn: 'arn:sub/cis', name: 'CIS', enabled: true },
  ],
};

const cisResult = { framework: 'cis', frameworkVersion: '5.0.0', controls: [{ controlId: '1.1' }] };
const pciResult = { framework: 'pci', frameworkVersion: '4.0.1', controls: [{ controlId: '2.2' }] };
const nistResult = { framework: 'nist', frameworkVersion: 'Rev. 5', controls: [{ controlId: 'AC-2' }] };

// ---------------------------------------------------------------------------
// A. Every method delegates to the shared api client, with the exact backend path.
// ---------------------------------------------------------------------------

describe('security-hub.service -- uses the shared api client', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as any);
    postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getCapability calls api.get on /api/security-hub/capability', async () => {
    getSpy.mockResolvedValue({ data: capabilityPayload } as any);
    await securityHubService.getCapability();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(CAPABILITY_PATH);
  });

  it('getCisReadiness calls api.get on /api/security-hub/frameworks/cis', async () => {
    getSpy.mockResolvedValue({ data: { success: true, result: cisResult } } as any);
    await securityHubService.getCisReadiness();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(CIS_PATH);
  });

  it('getPciReadiness calls api.get on /api/security-hub/frameworks/pci', async () => {
    getSpy.mockResolvedValue({ data: { success: true, result: pciResult } } as any);
    await securityHubService.getPciReadiness();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(PCI_PATH);
  });

  it('getNistReadiness calls api.get on /api/security-hub/frameworks/nist', async () => {
    getSpy.mockResolvedValue({ data: { success: true, result: nistResult } } as any);
    await securityHubService.getNistReadiness();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(NIST_PATH);
  });

  it('triggerSync calls api.post on /api/security-hub/sync (no body, unchanged from before)', async () => {
    postSpy.mockResolvedValue({ data: { success: true, message: 'Security Hub sync completed' } } as any);
    await securityHubService.triggerSync();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(SYNC_PATH);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('exposes exactly the same public methods as before (no accidental signature change)', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(securityHubService))
      .filter((name) => name !== 'constructor')
      .sort();
    expect(methods).toEqual(['getCapability', 'getCisReadiness', 'getNistReadiness', 'getPciReadiness', 'triggerSync']);
    expect(securityHubService.getCapability.length).toBe(0);
    expect(securityHubService.getCisReadiness.length).toBe(0);
    expect(securityHubService.getPciReadiness.length).toBe(0);
    expect(securityHubService.getNistReadiness.length).toBe(0);
    expect(securityHubService.triggerSync.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. No raw fetch: static (source) + runtime (global fetch never called).
// ---------------------------------------------------------------------------

describe('security-hub.service -- no raw fetch / bespoke authentication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('has no fetch(), cookie credentials, or hand-built auth in the source (comments excluded)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const raw = await fs.readFile(path.join(process.cwd(), 'lib/services/security-hub.service.ts'), 'utf-8');
    // Strip comments so explanatory prose can never trip (or hide from) these checks.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/credentials\s*:/);
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/Authorization/);
    expect(source).not.toMatch(/Bearer/);
    expect(source).not.toMatch(/XMLHttpRequest/);
    // Base URL is owned by the shared client, not re-derived here.
    expect(source).not.toMatch(/NEXT_PUBLIC_API_URL/);
    // Positive check: it actually goes through the shared client.
    expect(source).toMatch(/from\s+['"]@\/lib\/api['"]/);
  });

  it('never calls global fetch for any method', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('raw fetch must not be used by security-hub.service');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ...capabilityPayload, result: cisResult } } as any);
    vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);

    await securityHubService.getCapability();
    await securityHubService.getCisReadiness();
    await securityHubService.getPciReadiness();
    await securityHubService.getNistReadiness();
    await securityHubService.triggerSync();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C. Response mapping is unchanged.
// ---------------------------------------------------------------------------

describe('security-hub.service -- response mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getCapability returns exactly the five capability fields (drops success and any extras)', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ...capabilityPayload, somethingElse: 'ignored' } } as any);

    const result = await securityHubService.getCapability();

    expect(result).toEqual({
      capabilityStatus: 'ENABLED',
      syncStatus: 'COMPLETED',
      checkedAt: '2026-09-19T00:00:00.000Z',
      error: null,
      enabledStandards: capabilityPayload.enabledStandards,
    });
  });

  it('getCapability defaults enabledStandards to [] when the backend omits it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, capabilityStatus: null, syncStatus: 'NEVER_RUN', checkedAt: null, error: null },
    } as any);

    const result = await securityHubService.getCapability();

    expect(result.enabledStandards).toEqual([]);
    expect(result.capabilityStatus).toBeNull();
    expect(result.syncStatus).toBe('NEVER_RUN');
  });

  it('getCisReadiness / getPciReadiness / getNistReadiness return response.data.result (not data, not the AxiosResponse)', async () => {
    const getSpy = vi.spyOn(api, 'get');

    getSpy.mockResolvedValueOnce({ data: { success: true, result: cisResult } } as any);
    expect(await securityHubService.getCisReadiness()).toBe(cisResult);

    getSpy.mockResolvedValueOnce({ data: { success: true, result: pciResult } } as any);
    expect(await securityHubService.getPciReadiness()).toBe(pciResult);

    getSpy.mockResolvedValueOnce({ data: { success: true, result: nistResult } } as any);
    expect(await securityHubService.getNistReadiness()).toBe(nistResult);
  });

  it('triggerSync resolves to undefined regardless of the response body', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, message: 'Security Hub sync completed', outcome: { syncStatus: 'COMPLETED' } },
    } as any);

    await expect(securityHubService.triggerSync()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D. Error mapping: backend message + status preserved; safe fallback otherwise.
// ---------------------------------------------------------------------------

describe('security-hub.service -- error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a 401 preserves the backend error message and the HTTP status (not the generic Axios text)', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(axiosHttpError(401, { success: false, error: 'No authentication token provided' }));

    const error = await securityHubService.getCapability().catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('No authentication token provided');
    expect(error.statusCode).toBe(401);
    expect(error.message).not.toMatch(/Request failed with status code/);
  });

  it('every method preserves backend message + status on failure', async () => {
    const body = { success: false, error: 'Boom from backend' };
    vi.spyOn(api, 'get').mockRejectedValue(axiosHttpError(500, body));
    vi.spyOn(api, 'post').mockRejectedValue(axiosHttpError(402, { success: false, error: 'Subscription tier insufficient', code: 'TIER_REQUIRED' }));

    for (const call of [
      () => securityHubService.getCapability(),
      () => securityHubService.getCisReadiness(),
      () => securityHubService.getPciReadiness(),
      () => securityHubService.getNistReadiness(),
    ]) {
      await expect(call()).rejects.toMatchObject({ message: 'Boom from backend', statusCode: 500 });
    }
    await expect(securityHubService.triggerSync()).rejects.toMatchObject({
      message: 'Subscription tier insufficient',
      statusCode: 402,
    });
  });

  it('a network-style failure (no HTTP response) gets the per-method safe fallback, with no status', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(axiosNetworkError());
    vi.spyOn(api, 'post').mockRejectedValue(axiosNetworkError());

    await expect(securityHubService.getCapability()).rejects.toMatchObject({ message: FALLBACKS.capability });
    await expect(securityHubService.getCisReadiness()).rejects.toMatchObject({ message: FALLBACKS.cis });
    await expect(securityHubService.getPciReadiness()).rejects.toMatchObject({ message: FALLBACKS.pci });
    await expect(securityHubService.getNistReadiness()).rejects.toMatchObject({ message: FALLBACKS.nist });
    await expect(securityHubService.triggerSync()).rejects.toMatchObject({ message: FALLBACKS.sync });

    const error = await securityHubService.getCapability().catch((e) => e);
    expect(error.statusCode).toBeUndefined();
    expect(error.message).not.toMatch(/Network Error/);
  });

  it('a non-Axios failure gets the safe fallback rather than leaking its own message', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('Cannot read properties of undefined (reading internalDetail)'));

    const error = await securityHubService.getCisReadiness().catch((e) => e);

    expect(error.message).toBe(FALLBACKS.cis);
    expect(error.statusCode).toBeUndefined();
  });

  it('an error body without a usable string message falls back safely and keeps the status', async () => {
    const getSpy = vi.spyOn(api, 'get');

    for (const data of ['<html>502 Bad Gateway</html>', { success: false }, { error: { nested: 'object' } }, { error: '' }, null]) {
      getSpy.mockRejectedValueOnce(axiosHttpError(502, data));
      const error = await securityHubService.getPciReadiness().catch((e) => e);
      expect(error.message).toBe(FALLBACKS.pci);
      expect(error.statusCode).toBe(502);
    }
  });
});

// ---------------------------------------------------------------------------
// E. Authentication contract: real shared `api` client + real interceptor, fake transport.
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  withCredentials: boolean | undefined;
}

function getAuthHeader(config: InternalAxiosRequestConfig): string | undefined {
  const value = AxiosHeaders.from(config.headers as any).get('Authorization');
  return typeof value === 'string' ? value : undefined;
}

/** Mirrors backend/src/middleware/auth.middleware.ts's `authenticate` exactly: reject with
 * the real 401 body when Authorization is missing or not Bearer, otherwise answer from
 * `responses` keyed by URL. Records every request it sees. */
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
    return { data: responses[config.url ?? ''], status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  return calls;
}

const FAKE_RESPONSES: Record<string, unknown> = {
  [CAPABILITY_PATH]: capabilityPayload,
  [CIS_PATH]: { success: true, result: cisResult },
  [PCI_PATH]: { success: true, result: pciResult },
  [NIST_PATH]: { success: true, result: nistResult },
  [SYNC_PATH]: { success: true, message: 'Security Hub sync completed' },
};

const ALL_METHODS: Array<[string, () => Promise<unknown>]> = [
  ['getCapability', () => securityHubService.getCapability()],
  ['getCisReadiness', () => securityHubService.getCisReadiness()],
  ['getPciReadiness', () => securityHubService.getPciReadiness()],
  ['getNistReadiness', () => securityHubService.getNistReadiness()],
  ['triggerSync', () => securityHubService.triggerSync()],
];

describe('security-hub.service -- authentication contract (real api client + real interceptor)', () => {
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
    // No accessToken in localStorage -- the shared interceptor has nothing to inject,
    // exactly reproducing the request the old raw fetch() sent in production.
    installFakeBackend(FAKE_RESPONSES);

    await expect(call()).rejects.toMatchObject({
      statusCode: 401,
      message: 'No authentication token provided',
    });
  });

  it('hits the exact backend method + path for each call, and never opts into cookie credentials', async () => {
    localStorage.setItem('accessToken', SYNTHETIC_TOKEN);
    const calls = installFakeBackend(FAKE_RESPONSES);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await securityHubService.getCapability();
    await securityHubService.getCisReadiness();
    await securityHubService.getPciReadiness();
    await securityHubService.getNistReadiness();
    await securityHubService.triggerSync();

    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['get', CAPABILITY_PATH],
      ['get', CIS_PATH],
      ['get', PCI_PATH],
      ['get', NIST_PATH],
      ['post', SYNC_PATH],
    ]);
    expect(calls.every((c) => !c.withCredentials)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the same mapped values end to end through the real client', async () => {
    localStorage.setItem('accessToken', SYNTHETIC_TOKEN);
    installFakeBackend(FAKE_RESPONSES);

    expect(await securityHubService.getCapability()).toEqual({
      capabilityStatus: 'ENABLED',
      syncStatus: 'COMPLETED',
      checkedAt: '2026-09-19T00:00:00.000Z',
      error: null,
      enabledStandards: capabilityPayload.enabledStandards,
    });
    expect(await securityHubService.getCisReadiness()).toEqual(cisResult);
    expect(await securityHubService.getPciReadiness()).toEqual(pciResult);
    expect(await securityHubService.getNistReadiness()).toEqual(nistResult);
    expect(await securityHubService.triggerSync()).toBeUndefined();
  });

  it('propagates a non-auth failure (e.g. 500) with its own status and message, not a synthesized 401', async () => {
    localStorage.setItem('accessToken', SYNTHETIC_TOKEN);
    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      throw {
        isAxiosError: true,
        message: 'Request failed with status code 500',
        config,
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: { success: false, error: 'Unknown error' },
          headers: {},
          config,
        },
      };
    }) as AxiosAdapter;

    await expect(securityHubService.getCapability()).rejects.toMatchObject({
      statusCode: 500,
      message: 'Unknown error',
    });
  });
});
