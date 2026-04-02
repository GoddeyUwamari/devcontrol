/**
 * WelcomeModal Component
 * Auto-opens on first login to introduce DevControl
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '@/lib/stores/onboarding-store';

export function WelcomeModal() {
  const { currentStage, completeStep } = useOnboarding();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Auto-open on welcome stage
    if (currentStage === 'welcome') {
      // Small delay for better UX
      const timer = setTimeout(() => {
        setOpen(true);

        // Track analytics
        if (typeof window !== 'undefined' && (window as any).analytics) {
          (window as any).analytics.track('onboarding_welcome_shown');
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [currentStage]);

  const handleGetStarted = async () => {
    // Track analytics
    if (typeof window !== 'undefined' && (window as any).analytics) {
      (window as any).analytics.track('onboarding_welcome_completed');
    }

    await completeStep('welcome');
    setOpen(false);
  };

  const handleSkip = () => {
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Let's find your AWS cost waste 👋</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-gray-600 dark:text-gray-400">
            Most AWS environments have <strong>$500–$2,000/month in recoverable waste</strong>. DevControl finds it automatically — idle resources, oversized instances, security gaps — and tells you exactly what to fix first.
          </p>

          <div className="grid grid-cols-3 gap-4 py-4">
            <div className="text-center">
              <div className="text-3xl mb-2" aria-hidden="true">💸</div>
              <h4 className="font-semibold text-sm mb-1">Find Cost Waste</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                See exactly where AWS money is being wasted — idle resources, oversized instances, unused storage
              </p>
            </div>
            <div className="text-center">
              <div className="text-3xl mb-2" aria-hidden="true">⚡</div>
              <h4 className="font-semibold text-sm mb-1">Detect Risks Early</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Catch security gaps, cost spikes, and reliability issues before they become incidents
              </p>
            </div>
            <div className="text-center">
              <div className="text-3xl mb-2" aria-hidden="true">🎯</div>
              <h4 className="font-semibold text-sm mb-1">Act on Intelligence</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Ranked recommendations with one-click fixes — not raw data dumps
              </p>
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
            <h4 className="font-semibold text-sm mb-2">Get your first insight in 5 minutes:</h4>
            <ol className="text-sm text-gray-700 dark:text-gray-300 space-y-2 ml-4 list-decimal">
              <li><strong>Connect AWS</strong> — read-only access, no changes to your infrastructure</li>
              <li><strong>Run a scan</strong> — DevControl finds cost waste and risks automatically</li>
              <li><strong>See your savings</strong> — ranked list of fixes with estimated impact</li>
            </ol>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">⏱ Takes ~5 minutes · 🔒 Read-only · No infrastructure changes</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleSkip}>
            I'll Do This Later
          </Button>
          <Button onClick={handleGetStarted}>Connect AWS & Find Savings →</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
