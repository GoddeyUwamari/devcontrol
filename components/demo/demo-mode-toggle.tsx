/**
 * DemoModeToggle Component
 * Allows toggling between real data and empty state previews
 * Useful for testing onboarding flows and empty states
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const DEMO_MODE_KEY = 'devcontrol_demo_mode';

export function DemoModeToggle() {
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    // Load demo mode from localStorage
    const stored = localStorage.getItem(DEMO_MODE_KEY);
    if (stored === 'true') {
      setDemoMode(true);
    }
  }, []);

  const toggleDemoMode = () => {
    const newValue = !demoMode;
    setDemoMode(newValue);
    localStorage.setItem(DEMO_MODE_KEY, String(newValue));

    // Dispatch custom event so pages can react to the change
    // No page reload - React state handles the data swap
    window.dispatchEvent(new CustomEvent('demo-mode-changed', {
      detail: { enabled: newValue }
    }));
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={demoMode ? 'default' : 'outline'}
            size="sm"
            onClick={toggleDemoMode}
            className="fixed bottom-4 right-4 z-50 shadow-lg"
          >
            {demoMode ? (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Demo Mode ON
              </>
            ) : (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                Demo Mode OFF
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-xs max-w-xs">
            {demoMode
              ? 'Viewing sample data. Click to return to real data.'
              : 'Viewing real data. Click to see sample data.'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
