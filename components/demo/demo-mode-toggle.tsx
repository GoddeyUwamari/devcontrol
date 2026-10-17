/**
 * DemoModeToggle Component
 * Allows toggling between real data and empty state previews
 * Useful for testing onboarding flows and empty states
 */

'use client';

export function DemoModeToggle() {
  return null;
}

/**
 * Demo mode is switched off for everyone. The 'devcontrol_demo_mode' flag is
 * no longer read (lib/legacy-demo-cleanup.ts removes it on load), so this
 * always reports real mode. The demo branches that call it are removed per
 * area later.
 */
export function useDemoMode(): boolean {
  return false;
}
