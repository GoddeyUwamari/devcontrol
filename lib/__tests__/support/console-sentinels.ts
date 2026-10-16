/**
 * Shared fixtures for tests that check what reaches the browser console when
 * an API call fails: an AxiosError shaped like a real one, carrying sentinel
 * values in its request body and headers, and a spy over every console method.
 */
import { inspect } from "node:util";
import { vi, expect } from "vitest";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { api } from "@/lib/api";

export const SENTINEL_PASSWORD = "Sentinel-Passw0rd!7f3a9c";
export const SENTINEL_TOKEN = "sentinel-token-4b8e2d61";
export const SENTINEL_BEARER = "sentinel-bearer-9c1f5a07";
export const SENTINEL_SECRET = "sentinel-secret-2e6d8b13";

const SENTINELS = [SENTINEL_PASSWORD, SENTINEL_TOKEN, SENTINEL_BEARER, SENTINEL_SECRET];

/**
 * A rejected request as axios produces it: the sent body in config.data, the
 * Authorization header in config.headers, and a response with the API's error
 * shape. `body` is merged over sentinel credential fields.
 */
export function axiosErrorWithSentinels(
  status = 400,
  body: Record<string, unknown> = {},
  responseData: Record<string, unknown> = { success: false, error: "Request rejected", code: "BAD_REQUEST" },
): AxiosError {
  const headers = new AxiosHeaders({
    "Content-Type": "application/json",
    Authorization: `Bearer ${SENTINEL_BEARER}`,
  });
  const config = {
    url: "/api/endpoint",
    method: "post",
    headers,
    data: JSON.stringify({
      password: SENTINEL_PASSWORD,
      newPassword: SENTINEL_PASSWORD,
      token: SENTINEL_TOKEN,
      secretAccessKey: SENTINEL_SECRET,
      ...body,
    }),
  } as InternalAxiosRequestConfig;
  const request = { _header: `POST /api/endpoint\r\nAuthorization: Bearer ${SENTINEL_BEARER}`, responseText: "" };
  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    request,
    { status, statusText: "", headers: {}, config, data: responseData },
  );
}

/**
 * Makes every request through the shared api client fail at the adapter, so
 * the caller sees a genuine AxiosError built from the request it really sent
 * (body, Authorization header from localStorage, interceptors applied).
 * Stores SENTINEL_BEARER as the access token. Returns a restore function.
 */
export function rejectEveryApiRequest(
  status = 400,
  responseData: Record<string, unknown> = { success: false, error: "Request rejected", code: "BAD_REQUEST" },
): () => void {
  const previous = api.defaults.adapter;
  localStorage.setItem("accessToken", SENTINEL_BEARER);
  api.defaults.adapter = async (config) => {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      { status, statusText: "", headers: {}, config, data: responseData },
    );
  };
  return () => {
    api.defaults.adapter = previous;
    localStorage.removeItem("accessToken");
  };
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

/** Spies on every console method (output suppressed); returns the spies. */
export function spyOnConsole() {
  return CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
}

function renderings(arg: unknown): string[] {
  const out = [String(arg), inspect(arg, { depth: 8, showHidden: true, getters: true })];
  try {
    out.push(JSON.stringify(arg) ?? "");
  } catch {
    // circular -- inspect above already covers it
  }
  return out;
}

/**
 * Fails if any console call so far received an argument containing a
 * sentinel, or any of `alsoForbidden` (values a flow sent, e.g. an email).
 */
export function expectNoSentinelInConsole(spies: ReturnType<typeof spyOnConsole>, alsoForbidden: string[] = []) {
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        for (const text of renderings(arg)) {
          for (const sentinel of [...SENTINELS, ...alsoForbidden]) {
            expect(text, `console argument contained a sentinel value`).not.toContain(sentinel);
          }
        }
      }
    }
  }
}

/** Sanity check for the fixture: the sentinels really are on the error. */
export function expectFixtureCarriesSentinels(error: AxiosError) {
  const text = inspect(error, { depth: 8, showHidden: true });
  expect(text).toContain(SENTINEL_PASSWORD);
  expect(text).toContain(SENTINEL_BEARER);
}
