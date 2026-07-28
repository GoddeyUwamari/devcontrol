/**
 * WelcomeModal Component
 * Auto-opens on first login to introduce DevControl
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, DollarSign, Zap, Target, Clock, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '@/lib/stores/onboarding-store';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';

export function WelcomeModal() {
  const { status, currentStage, completedStages, completeStep, dismiss } = useOnboarding();
  const [open, setOpen] = useState(false);
  const isDemoActive = useDemoMode();

  useEffect(() => {
    if (isDemoActive) return;
    // status is null until fetchStatus() (kicked off in app/(app)/layout.tsx) resolves —
    // currentStage/completedStages fall back to 'welcome'/[] until then. Without this
    // guard, the effect below fires on those stale defaults before the real (possibly
    // already-completed) status arrives, and nothing closes the modal back down once
    // it does — it can only ever open, never un-open itself on a later state update.
    if (!status) return;
    // Auto-open on welcome stage only when AWS is not yet connected
    if (currentStage === 'welcome' && !completedStages.includes('connect_aws')) {
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
  }, [status, currentStage, completedStages, isDemoActive]);

  const handleGetStarted = async () => {
    // Track analytics
    if (typeof window !== 'undefined' && (window as any).analytics) {
      (window as any).analytics.track('onboarding_welcome_completed');
    }

    await completeStep('welcome');
    setOpen(false);
  };

  const handleSkip = async () => {
    setOpen(false);
    try {
      await dismiss(); // calls POST /api/onboarding/dismiss
    } catch {
      // silently fail — modal is already closed
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
       <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pt-4">
  <DialogTitle className="text-lg sm:text-2xl flex items-center gap-2">
    <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600 shrink-0" />
    Let's find your AWS cost waste
  </DialogTitle>
</DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-gray-600 dark:text-gray-400">
            Most AWS environments have <strong>measurable cost-saving opportunities</strong>. DevControl finds them automatically — idle resources, oversized instances, security gaps — and tells you exactly what to fix first.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4">
            <div className="text-center">
              <DollarSign className="h-8 w-8 mx-auto mb-2 text-green-600" aria-hidden="true" />
              <h4 className="font-semibold text-sm mb-1">Find Cost Waste</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                See exactly where AWS money is being wasted — idle resources, oversized instances, unused storage
              </p>
            </div>
            <div className="text-center">
              <Zap className="h-8 w-8 mx-auto mb-2 text-amber-500" aria-hidden="true" />
              <h4 className="font-semibold text-sm mb-1">Detect Risks Early</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Catch security gaps, cost spikes, and reliability issues before they become incidents
              </p>
            </div>
            <div className="text-center">
              <Target className="h-8 w-8 mx-auto mb-2 text-purple-600" aria-hidden="true" />
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
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" /> Takes ~5 minutes</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" /> Read-only · No infrastructure changes</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
          <Button variant="outline" className="w-full sm:w-auto" onClick={handleSkip}>
            I&apos;ll Do This Later
          </Button>
          <Button className="w-full sm:w-auto" onClick={handleGetStarted}>Connect AWS &amp; Find Savings →</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
