/**
 * WelcomeModal Component
 * Auto-opens on first login to introduce DevControl
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cloud, Lock } from 'lucide-react';
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
  const router = useRouter();

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
    router.push('/connect-aws');
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
    <Cloud className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600 shrink-0" aria-hidden="true" />
    Connect AWS to get started
  </DialogTitle>
</DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-gray-600 dark:text-gray-400">
            DevControl reads your AWS account through a read-only IAM role and lists what it finds.
            Cost findings (idle EC2 instances, unattached EBS volumes, unused Elastic IPs, and EBS and S3
            storage settings that cost more than needed) show estimated monthly savings. Security findings
            are listed alongside.
          </p>

          <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
            <ol className="text-sm text-gray-700 dark:text-gray-300 space-y-2 ml-4 list-decimal">
              <li data-testid="welcome-step"><strong>Connect AWS</strong>: create a read-only IAM role. DevControl makes no changes to your account.</li>
              <li data-testid="welcome-step"><strong>DevControl scans</strong>: right after you connect, then on a regular schedule.</li>
              <li data-testid="welcome-step"><strong>Review findings</strong>: cost findings show estimated monthly savings; security findings are listed alongside.</li>
            </ol>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 flex items-center gap-1">
              <Lock className="h-3 w-3" aria-hidden="true" /> Read-only · No infrastructure changes
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
          <Button variant="outline" className="w-full sm:w-auto" onClick={handleSkip}>
            I&apos;ll Do This Later
          </Button>
          <Button className="w-full sm:w-auto" onClick={handleGetStarted}>Connect AWS →</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
