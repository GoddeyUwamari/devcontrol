import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { cancelLeftoverTimers, installTimerHygiene, realTimers } from "./vitest.timer-hygiene";

installTimerHygiene();

// Registered first, so it runs after every test file's own afterEach hooks
// (vitest runs afterEach hooks in reverse order): the test and its hooks
// have finished before anything here touches its timers.
afterEach(async () => {
  cleanup();
  // One real macrotask, so zero-delay leftovers and unhandled rejections from
  // this test surface while it is still the current test.
  await new Promise((resolve) => realTimers.setTimeout(resolve, 0));
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  cancelLeftoverTimers();
});
