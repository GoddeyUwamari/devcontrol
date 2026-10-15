import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Minimal Vitest setup, added solely to cover the invitation-acceptance fix
// (lib/services/organizations.service.ts, app/(auth)/accept-invitation/page.tsx).
// No broader frontend test architecture is implied by this file's presence.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Half the cores, not the default cores - 1. These tests render whole
    // pages in jsdom, and a CPU-starved worker ran a file's first (cold) test
    // past the 5s test timeout or a 1s findBy*/waitFor budget: flaky failures
    // under load with no ordering bug behind them. Fewer, unstarved workers
    // keep each test's own timing honest.
    maxWorkers: "50%",
    include: [
      "lib/**/__tests__/**/*.test.{ts,tsx}",
      "app/**/__tests__/**/*.test.{ts,tsx}",
      "components/**/__tests__/**/*.test.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
});
