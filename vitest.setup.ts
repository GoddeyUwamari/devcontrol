import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { relative } from "node:path";
import { cancelLeftoverTimers, installTimerHygiene, realTimers } from "./vitest.timer-hygiene";

installTimerHygiene();

/** "a.ts:1 ×3, b.tsx:9" -- each creation site once, with how many timers it left. */
function sitesWithCounts(sites: string[]): string {
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(site, (counts.get(site) ?? 0) + 1);
  return [...counts].map(([site, n]) => (n > 1 ? `${site} ×${n}` : site)).join(", ");
}

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
  // Logged, never failed: each leftover is a timer this test started and left.
  const cancelled = cancelLeftoverTimers();
  if (cancelled.length > 0) {
    const { test, file } = cancelled[0];
    const where = file ? relative(process.cwd(), file) : "unknown file";
    process.stderr.write(
      `[timer hygiene] "${test}" (${where}): cancelled ${cancelled.length} leftover timer(s) scheduled at ${sitesWithCounts(cancelled.map((c) => c.site))}\n`
    );
  }
});
