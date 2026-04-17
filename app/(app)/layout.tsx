'use client';

import { useEffect } from 'react';
import { TopNav } from '@/components/layout/top-nav';
import { ErrorBoundary } from '@/components/error-boundary';
import { CommandPalette } from '@/components/command-palette';
import { ConnectionIndicator } from '@/components/ConnectionIndicator';
import { WelcomeModal } from '@/components/onboarding/welcome-modal';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { useOnboardingStore } from '@/lib/stores/onboarding-store';
import { useBreadcrumbs } from '@/lib/hooks/useBreadcrumbs';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { AIChatWidget } from '@/components/ai/AIChatWidget';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { usePlan } from '@/lib/hooks/use-plan';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const fetchStatus = useOnboardingStore((state) => state.fetchStatus);
  const breadcrumbs = useBreadcrumbs();
  const isDemoActive = useDemoMode();
  const { enabled: salesDemo } = useSalesDemo();
  const { isPro } = usePlan();
  const showAIChat = isPro || isDemoActive || salesDemo;

  useEffect(() => {
    if (!isDemoActive) {
      fetchStatus();
    }
  }, [fetchStatus, isDemoActive]);

  return (
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      <DemoBanner />

      {/* Sticky Header */}
      <div className="sticky top-0 z-50 bg-white dark:bg-gray-950 shadow-sm">
        <header role="banner">
          <TopNav />
        </header>

        {breadcrumbs.length > 0 && (
          <div className="border-b border-gray-200 dark:border-gray-800">
            <div className="px-4 sm:px-6 lg:px-8 py-2">
              <Breadcrumb items={breadcrumbs} />
            </div>
          </div>
        )}
      </div>

      <main id="main-content" role="main" tabIndex={-1}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      <CommandPalette />
      <ConnectionIndicator />
      <WelcomeModal />
      {showAIChat && <AIChatWidget />}
    </div>
  );
}