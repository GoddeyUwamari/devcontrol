/**
 * The shared timer hygiene in vitest.setup.ts / vitest.timer-hygiene.ts:
 * fake timers still replace every timer while active, leftover real timers
 * are cleared only after the test and its own hooks have run, and a throwing
 * callback names the test that scheduled it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { promisify } from "node:util";
import { pendingTimerCount, realTimers } from "../../vitest.timer-hygiene";

describe("fake timers replace the hygiene wrappers entirely", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("vi.useFakeTimers(): setTimeout, setInterval and their clears are all fake, and nothing is tracked", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    setTimeout(() => fired.push("timeout"), 1000);
    const interval = setInterval(() => fired.push("interval"), 400);
    const cleared = setTimeout(() => fired.push("cleared"), 10);
    clearTimeout(cleared);

    expect(vi.getTimerCount()).toBe(2);
    expect(pendingTimerCount()).toBe(0);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual(["interval", "interval", "timeout"]);
    clearInterval(interval);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("vi.useFakeTimers({ toFake: ['setTimeout'] }): setTimeout is fake, setInterval stays real", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let fired = false;
    setTimeout(() => { fired = true; }, 5000);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(fired).toBe(true);

    const interval = setInterval(() => {}, 1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(pendingTimerCount()).toBe(1);
    clearInterval(interval);
    expect(pendingTimerCount()).toBe(0);
  });

  it("vi.useRealTimers() restores the wrappers", async () => {
    vi.useFakeTimers();
    vi.useRealTimers();
    const handle = setTimeout(() => {}, 1000);
    expect(pendingTimerCount()).toBe(1);
    clearTimeout(handle);
    expect(pendingTimerCount()).toBe(0);
  });
});

describe("the wrappers behave like the real timers", () => {
  it("same handle type, arguments, delay, ref/unref and util.promisify", async () => {
    const handle = setTimeout(() => {}, 50);
    expect(handle.constructor).toBe(realTimers.setTimeout(() => {}, 0).constructor);
    expect(typeof handle.unref).toBe("function");
    clearTimeout(handle);

    const args = await new Promise<unknown[]>((resolve) => setTimeout((...a: unknown[]) => resolve(a), 1, "a", 2));
    expect(args).toEqual(["a", 2]);

    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);

    await expect(promisify(setTimeout)(1, "value")).resolves.toBe("value");
  });

  it("a timer that fires is no longer pending; clearing by numeric id works", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(pendingTimerCount()).toBe(0);
    const handle = setTimeout(() => {}, 1000);
    clearTimeout(Number(handle));
    expect(pendingTimerCount()).toBe(0);
  });
});

describe("leftover timers are cleared only after the test and its hooks", () => {
  let leftoverFired = false;

  afterEach(() => {
    // This file's own afterEach runs before the shared one: the leftover from
    // the first test below is still pending here.
    if (expect.getState().currentTestName?.endsWith("leaves a timer behind")) {
      expect(pendingTimerCount()).toBe(1);
    }
  });

  it("leaves a timer behind", () => {
    setTimeout(() => { leftoverFired = true; }, 20);
    expect(pendingTimerCount()).toBe(1);
  });

  it("the previous test's timer was cleared before this test started", async () => {
    expect(pendingTimerCount()).toBe(0);
    await new Promise((resolve) => realTimers.setTimeout(resolve, 60));
    expect(leftoverFired).toBe(false);
  });
});

describe("a throwing callback names the test that scheduled it", () => {
  it("rethrows the same error with the scheduling test and site", async () => {
    const original = new Error("boom");
    const caught = await new Promise<unknown>((resolve) => {
      const onError = (error: unknown) => { process.off("uncaughtException", onError); restore(); resolve(error); };
      // Take over the uncaught-exception path for this one throw only, so the
      // deliberate error doesn't fail the run.
      const listeners = process.listeners("uncaughtException");
      process.removeAllListeners("uncaughtException");
      const restore = () => listeners.forEach((l) => process.on("uncaughtException", l));
      process.on("uncaughtException", onError);
      setTimeout(() => { throw original; }, 0);
    });
    expect(caught).toBe(original);
    expect((caught as Error).message).toContain('scheduled during the test "a throwing callback names the test that scheduled it > rethrows the same error with the scheduling test and site"');
    expect((caught as Error).message).toContain("timer-hygiene.test.ts");
  });
});
