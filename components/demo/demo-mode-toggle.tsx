/**
 * DemoModeToggle Component
 * Allows toggling between real data and empty state previews
 * Useful for testing onboarding flows and empty states
 */

'use client';

import { useState, useEffect } from 'react';

const DEMO_MODE_KEY = 'devcontrol_demo_mode';

export function DemoModeToggle() {
  return null;
}

/**
 * Hook to check if demo mode is enabled
 */
export function useDemoMode() {
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    // Check initial state
    const stored = localStorage.getItem(DEMO_MODE_KEY);
    setDemoMode(stored === 'true');

    // Listen for changes
    const handleDemoModeChange = (e: CustomEvent) => {
      setDemoMode(e.detail.enabled);
    };

    window.addEventListener('demo-mode-changed', handleDemoModeChange as EventListener);

    return () => {
      window.removeEventListener('demo-mode-changed', handleDemoModeChange as EventListener);
    };
  }, []);

  return demoMode;
}
