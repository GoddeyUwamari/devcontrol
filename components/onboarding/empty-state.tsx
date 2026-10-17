/**
 * EmptyState Component
 * High-converting empty state with action-oriented CTAs
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '@/lib/stores/onboarding-store';
import { logError } from '@/lib/safe-log';

export interface EmptyStateProps {
  // Content
  icon?: React.ReactNode | string;
  headline: string;
  description: string;
  tip?: string;

  // CTAs
  primaryCTA: {
    label: string;
    action: 'route' | 'modal' | 'function' | 'external';
    route?: string;
    modalId?: string;
    onClick?: () => void | Promise<void>;
    href?: string;
  };
  secondaryCTA?: {
    label: string;
    action: 'route' | 'external';
    route?: string;
    href?: string;
  };

  // Onboarding integration
  onboardingStep?: string; // e.g., 'create_service'

  // Visual
  illustration?: string; // URL to SVG
  className?: string;
}

export function EmptyState({
  icon,
  headline,
  description,
  tip,
  primaryCTA,
  secondaryCTA,
  onboardingStep,
  illustration,
  className = '',
}: EmptyStateProps) {
  const router = useRouter();
  const { completeStep } = useOnboarding();
  const [loading, setLoading] = useState(false);

  // Track view on mount
  useEffect(() => {
    if (onboardingStep) {
      // Track analytics
      if (typeof window !== 'undefined' && (window as any).analytics) {
        (window as any).analytics.track('onboarding_empty_state_viewed', {
          step: onboardingStep,
          headline,
        });
      }
    }
  }, [onboardingStep, headline]);

  const handlePrimaryCTA = async () => {
    setLoading(true);

    // Track click
    if (onboardingStep && typeof window !== 'undefined' && (window as any).analytics) {
      (window as any).analytics.track('onboarding_cta_clicked', {
        step: onboardingStep,
        cta: primaryCTA.label,
        action: primaryCTA.action,
      });
    }

    try {
      switch (primaryCTA.action) {
        case 'route':
          if (primaryCTA.route) {
            router.push(primaryCTA.route);
          }
          break;

        case 'modal':
          // Dispatch custom event to open modal
          if (primaryCTA.modalId) {
            window.dispatchEvent(
              new CustomEvent('open-modal', {
                detail: { modalId: primaryCTA.modalId },
              })
            );
          }
          break;

        case 'function':
          if (primaryCTA.onClick) {
            await primaryCTA.onClick();
          }
          break;

        case 'external':
          if (primaryCTA.href) {
            window.open(primaryCTA.href, '_blank');
          }
          break;
      }

      // Auto-complete step if defined (for manual steps only)
      if (onboardingStep && ['welcome', 'discover_resources'].includes(onboardingStep)) {
        setTimeout(() => {
          completeStep(onboardingStep);
        }, 1000);
      }
    } catch (error) {
      logError('Error handling CTA', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSecondaryCTA = () => {
    if (onboardingStep && typeof window !== 'undefined' && (window as any).analytics) {
      (window as any).analytics.track('onboarding_secondary_cta_clicked', {
        step: onboardingStep,
        cta: secondaryCTA?.label,
      });
    }

    if (secondaryCTA?.action === 'route' && secondaryCTA.route) {
      router.push(secondaryCTA.route);
    } else if (secondaryCTA?.action === 'external' && secondaryCTA.href) {
      window.open(secondaryCTA.href, '_blank');
    }
  };

  return (
    <div
      className={`flex flex-col items-center justify-center min-h-[400px] p-8 ${className}`}
    >
      {/* Illustration or Icon */}
      {illustration && (
        <img
          src={illustration}
          alt=""
          className="w-64 h-64 mb-6 opacity-80"
          aria-hidden="true"
        />
      )}

      {!illustration && icon && (
        <div className="text-6xl mb-6" aria-hidden="true">
          {typeof icon === 'string' ? icon : icon}
        </div>
      )}

      {/* Headline */}
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-3 text-center max-w-md">
        {headline}
      </h2>

      {/* Description */}
      <p className="text-base text-gray-600 dark:text-gray-400 mb-6 text-center max-w-lg leading-relaxed">
        {description}
      </p>

      {/* CTAs */}
      <div className="flex items-center gap-3 mb-4">
        <Button size="lg" onClick={handlePrimaryCTA} disabled={loading}>
          {loading ? 'Loading...' : primaryCTA.label}
        </Button>

        {secondaryCTA && (
          <Button size="lg" variant="outline" onClick={handleSecondaryCTA}>
            {secondaryCTA.label}
          </Button>
        )}
      </div>

      {/* Tip */}
      {tip && (
        <div className="flex items-start gap-2 mt-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg max-w-md">
          <span className="text-lg flex-shrink-0" aria-hidden="true">
            💡
          </span>
          <p className="text-sm text-blue-900 dark:text-blue-100">
            <strong>Tip:</strong> {tip}
          </p>
        </div>
      )}
    </div>
  );
}
