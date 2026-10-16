/**
 * logError writes one string: context, message, HTTP status and the API's
 * error code -- and nothing else read from the error.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { describeError, logError } from "../safe-log";
import {
  axiosErrorWithSentinels,
  expectFixtureCarriesSentinels,
  expectNoSentinelInConsole,
  spyOnConsole,
} from "./support/console-sentinels";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeError", () => {
  it("HTTP error: message, status and code", () => {
    const error = axiosErrorWithSentinels(409, {}, { success: false, error: "Taken", code: "EMAIL_TAKEN" });
    expect(describeError("Registration failed", error)).toBe(
      "Registration failed: Request failed with status code 409 (status 409, code EMAIL_TAKEN)",
    );
  });

  it("HTTP error without a code: message and status", () => {
    const error = axiosErrorWithSentinels(500, {}, { success: false, error: "boom" });
    expect(describeError("Load failed", error)).toBe("Load failed: Request failed with status code 500 (status 500)");
  });

  it("ignores a code that is not a short identifier", () => {
    const error = axiosErrorWithSentinels(400, {}, { code: "has spaces and a value: x" });
    expect(describeError("ctx", error)).toBe("ctx: Request failed with status code 400 (status 400)");
    const objectCode = axiosErrorWithSentinels(400, {}, { code: { nested: true } });
    expect(describeError("ctx", objectCode)).toBe("ctx: Request failed with status code 400 (status 400)");
  });

  it("plain Error: message only", () => {
    expect(describeError("Export failed", new Error("no rows"))).toBe("Export failed: no rows");
  });

  it("truncates long messages", () => {
    const text = describeError("ctx", new Error("x".repeat(500)));
    expect(text).toBe(`ctx: ${"x".repeat(200)}…`);
  });

  it("non-Error values are not stringified", () => {
    expect(describeError("ctx", "a string that could hold anything")).toBe("ctx: non-Error value (string)");
    expect(describeError("ctx", { token: "t" })).toBe("ctx: non-Error value (object)");
    expect(describeError("ctx", null)).toBe("ctx: non-Error value (null)");
    expect(describeError("ctx", undefined)).toBe("ctx: non-Error value (undefined)");
  });
});

describe("logError", () => {
  it("writes exactly one string argument to console.error", () => {
    const spies = spyOnConsole();
    const error = axiosErrorWithSentinels(400);
    expectFixtureCarriesSentinels(error);

    logError("Reset password error", error);

    const errorSpy = vi.mocked(console.error);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toEqual([
      "Reset password error: Request failed with status code 400 (status 400, code BAD_REQUEST)",
    ]);
    expectNoSentinelInConsole(spies);
  });
});
