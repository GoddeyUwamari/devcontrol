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
import { DemoModeToggle } from '@/components/demo/demo-mode-toggle';
import { SalesDemoToggle } from '@/components/demo/sales-demo-toggle';
import { AnnouncementBar } from '@/components/announcement-bar';
import { Footer } from '@/components/footer';
import { AIChatWidget } from '@/components/ai/AIChatWidget';

/**
 * App Layout - Authenticated Users Only
 *
 * TODO: Add authentication check - redirect non-authenticated users to /login
 * Example (use server component or middleware):
 *   const session = await getServerSession();
 *   if (!session) {
 *     redirect('/login');
 *   }
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const fetchStatus = useOnboardingStore((state) => state.fetchStatus);
  const breadcrumbs = useBreadcrumbs();

  // Fetch onboarding status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="min-h-screen bg-background">
      {/* Skip to Content - Accessibility */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Announcement Bar */}
      <AnnouncementBar
        message="🚀 Limited Time Offer: Get 20% off annual plans!"
        linkText="Learn More"
        linkHref="/pricing"
      />

      {/* Top Navigation - Shows on all authenticated pages */}
      <header role="banner">
        <TopNav />
      </header>

      {/* Breadcrumb Navigation */}
      {breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
            <Breadcrumb items={breadcrumbs} />
          </div>
        </nav>
      )}

      {/* Main Content Area */}
      <main id="main-content" role="main" tabIndex={-1}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette />

      {/* WebSocket Connection Indicator */}
      <ConnectionIndicator />

      {/* Welcome Modal (Auto-opens on first login) */}
      <WelcomeModal />

      {/* Demo Mode Toggle (for testing empty states) */}
      <DemoModeToggle />

      {/* Sales Demo Mode Toggle (for sales presentations) */}
      <SalesDemoToggle />

      {/* Footer */}
      <Footer />

      {/* AI Chat Widget */}
      <AIChatWidget />
    </div>
  );
}
