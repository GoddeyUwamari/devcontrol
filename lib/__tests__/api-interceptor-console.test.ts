/**
 * The shared api client's 500 handling logs the logError line only -- not
 * the response payload, request body or Authorization header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../api";
import {
  SENTINEL_SECRET,
  expectNoSentinelInConsole,
  rejectEveryApiRequest,
  spyOnConsole,
} from "./support/console-sentinels";

let restoreApi: () => void;
let spies: ReturnType<typeof spyOnConsole>;

beforeEach(() => {
  restoreApi = rejectEveryApiRequest(500, { success: false, error: `failed for ${SENTINEL_SECRET}`, code: "INTERNAL_SERVER_ERROR" });
  spies = spyOnConsole();
});

afterEach(() => {
  restoreApi();
  vi.restoreAllMocks();
});

describe("api response interceptor", () => {
  it("500: status and code only", async () => {
    await expect(api.post("/api/anything", { password: "x" })).rejects.toMatchObject({ response: { status: 500 } });

    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["Server error: Request failed with status code 500 (status 500, code INTERNAL_SERVER_ERROR)"],
    ]);
    expectNoSentinelInConsole(spies);
  });
});
