/**
 * Demo mode used to live in two localStorage keys that survived logout and
 * carried over to the next account on the same browser. Demo mode is now off
 * for everyone; this removes both keys once on app load so browsers that were
 * left in demo mode come out of it. Storage can throw (private mode, blocked
 * site data), and the cleanup must never break the page.
 */
export const LEGACY_DEMO_KEYS = ['devcontrol_demo_mode', 'sales-demo-mode'] as const;

export function clearLegacyDemoFlags(): void {
  try {
    for (const key of LEGACY_DEMO_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
