import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api } from '@/lib/api';
import { soc2Service } from '../soc2.service';

/**
 * Regression coverage for the SOC2 frontend authentication bug: soc2.service.ts used to
 * call native fetch() with `credentials: 'include'` and never sent an Authorization
 * header, so production always hit the backend's "No authentication token provided" 401
 * (backend/src/middleware/auth.middleware.ts only ever reads the Authorization header,
 * never cookies). The fix routes every method through the shared `api` Axios client
 * (lib/api.ts), whose request interceptor injects `Authorization: Bearer <accessToken>`
 * from localStorage -- the same mechanism risk-score.service.ts,
 * account-security-findings.service.ts, and stripe.service.ts already use.
 *
 * Two layers of coverage on purpose:
 *  - "uses the shared api client" tests spy on api.get/post/patch to prove every method
 *    routes through the shared client (and not a bespoke fetch()) with the right path.
 *  - "authentication contract" tests below do NOT mock '@/lib/api' or duplicate its
 *    token-injection logic. They let the real shared Axios instance and its real request
 *    interceptor run, and replace only the transport (the Axios adapter) with an
 *    in-memory fake that enforces the exact contract the real backend enforces: a
 *    request without `Authorization: Bearer <token>` is rejected with the real 401 body.
 *    This is what actually proves the Bearer-token mechanism is exercised -- if a future
 *    change swaps `api.get(...)` back for a bare `fetch(...)` that forgets the header,
 *    these tests fail (a plain "was api.get called" spy would not catch that).
 */

describe('soc2.service -- uses the shared api client (no raw fetch)', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let postSpy: ReturnType<typeof vi.spyOn>;
  let patchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as any);
    postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
    patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getReadiness calls api.get on /api/soc2/readiness', async () => {
    getSpy.mockResolvedValue({ data: { success: true, criteria: [] } } as any);
    await soc2Service.getReadiness();
    expect(getSpy).toHaveBeenCalledWith('/api/soc2/readiness');
  });

  it('getReadinessDetail calls api.get on /api/soc2/readiness/:criterionId', async () => {
    getSpy.mockResolvedValue({ data: { success: true, criterion: {}, evidence: [] } } as any);
    await soc2Service.getReadinessDetail('CC6.1');
    expect(getSpy).toHaveBeenCalledWith('/api/soc2/readiness/CC6.1');
  });

  it('getEvidence calls api.get on /api/soc2/evidence with criterionId as params', async () => {
    getSpy.mockResolvedValue({ data: { success: true, evidence: [] } } as any);
    await soc2Service.getEvidence('CC6.1');
    expect(getSpy).toHaveBeenCalledWith('/api/soc2/evidence', { params: { criterionId: 'CC6.1' } });
  });

  it('getCustomerEvidence calls api.get on /api/soc2/customer-evidence', async () => {
    getSpy.mockResolvedValue({ data: { success: true, customerEvidence: [] } } as any);
    await soc2Service.getCustomerEvidence();
    expect(getSpy).toHaveBeenCalledWith('/api/soc2/customer-evidence', { params: undefined });
  });

  it('getCustomerEvidenceDetail calls api.get on /api/soc2/customer-evidence/:evidenceId', async () => {
    getSpy.mockResolvedValue({ data: { success: true, customerEvidence: {} } } as any);
    await soc2Service.getCustomerEvidenceById('e1');
    expect(getSpy).toHaveBeenCalledWith('/api/soc2/customer-evidence/e1');
  });

  it('createCustomerEvidence calls api.post on /api/soc2/customer-evidence', async () => {
    postSpy.mockResolvedValue({ data: { success: true, customerEvidence: {} } } as any);
    const request = { criterionId: 'CC6.1', evidenceType: 'policy' as const, title: 'Policy' };
    await soc2Service.createCustomerEvidence(request);
    expect(postSpy).toHaveBeenCalledWith('/api/soc2/customer-evidence', request);
  });

  it('updateCustomerEvidenceMetadata calls api.patch on /api/soc2/customer-evidence/:evidenceId', async () => {
    patchSpy.mockResolvedValue({ data: { success: true, customerEvidence: {} } } as any);
    const request = { title: 'Updated title' };
    await soc2Service.updateCustomerEvidenceMetadata('e1', request);
    expect(patchSpy).toHaveBeenCalledWith('/api/soc2/customer-evidence/e1', request);
  });

  it('has no raw fetch() call sites left in the source (regex over the file content)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.join(process.cwd(), 'lib/services/soc2.service.ts'),
      'utf-8'
    );
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/localStorage\.getItem/);
    expect(source).not.toMatch(/credentials:\s*['"]include['"]/);
  });
});

// ---------------------------------------------------------------------------
// Authentication contract: real shared `api` client + real interceptor, fake transport.
// ---------------------------------------------------------------------------

function getAuthHeader(config: InternalAxiosRequestConfig): string | undefined {
  const headers = AxiosHeaders.from(config.headers as any);
  const value = headers.get('Authorization');
  return typeof value === 'string' ? value : undefined;
}

/** Mirrors backend/src/middleware/auth.middleware.ts's `authenticate` exactly: reject
 * with the real 401 body when Authorization is missing/not Bearer, otherwise resolve. */
function installFakeBackend(fixtureData: unknown): void {
  const adapter: AxiosAdapter = async (config) => {
    const authHeader = getAuthHeader(config);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
    return {
      data: fixtureData,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  api.defaults.adapter = adapter;
}

describe('soc2.service -- authentication contract (real api client + real interceptor)', () => {
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    vi.restoreAllMocks();
  });

  it('getReadiness succeeds when the shared interceptor supplies Authorization: Bearer <token>', async () => {
    localStorage.setItem('accessToken', 'test-only-synthetic-token');
    installFakeBackend({ success: true, criteria: [{ criterionId: 'CC6.1' }] });

    const result = await soc2Service.getReadiness();

    expect(result).toEqual([{ criterionId: 'CC6.1' }]);
  });

  it('getReadiness rejects with the real 401 contract when no token exists in localStorage', async () => {
    // No accessToken set -- the shared interceptor has nothing to inject, exactly
    // reproducing the production bug this regression test guards against.
    installFakeBackend({ success: true, criteria: [] });

    await expect(soc2Service.getReadiness()).rejects.toMatchObject({
      statusCode: 401,
      message: 'No authentication token provided',
    });
  });

  it('getCustomerEvidence succeeds with a token and fails the same way without one', async () => {
    installFakeBackend({ success: true, customerEvidence: [] });
    await expect(soc2Service.getCustomerEvidence()).rejects.toMatchObject({ statusCode: 401 });

    localStorage.setItem('accessToken', 'test-only-synthetic-token');
    installFakeBackend({ success: true, customerEvidence: [{ evidenceId: 'e1' }] });
    await expect(soc2Service.getCustomerEvidence()).resolves.toEqual([{ evidenceId: 'e1' }]);
  });

  it('propagates a non-auth failure (e.g. 500) with its own status and message, not a synthesized 401', async () => {
    localStorage.setItem('accessToken', 'test-only-synthetic-token');
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

    await expect(soc2Service.getReadiness()).rejects.toMatchObject({
      statusCode: 500,
      message: 'Unknown error',
    });
  });
});
