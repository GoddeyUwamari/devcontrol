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
    include: [
      "lib/**/__tests__/**/*.test.{ts,tsx}",
      "app/**/__tests__/**/*.test.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
});
