/**
 * Onboarding Store (Zustand)
 * Manages onboarding state across the application
 */

import { create } from 'zustand';
import type { OnboardingStatus } from '../types/onboarding';
import {
  getOnboardingStatus,
  markStepComplete,
  dismissOnboarding,
  reEnableOnboarding,
} from '../services/onboarding.service';
import { logError } from '@/lib/safe-log';

interface OnboardingStore {
  // State
  status: OnboardingStatus | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;

  // Actions
  fetchStatus: () => Promise<void>;
  completeStep: (step: string) => Promise<void>;
  dismiss: () => Promise<void>;
  reEnable: () => Promise<void>;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  // Initial state
  status: null,
  loading: false,
  error: null,
  lastFetched: null,

  // Fetch onboarding status
  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const response = await getOnboardingStatus();

      if (response.success && response.data) {
        set({
          status: response.data,
          loading: false,
          lastFetched: Date.now(),
        });
      } else {
        set({
          error: response.error || 'Failed to fetch onboarding status',
          loading: false,
        });
      }
    } catch (error: any) {
      logError('Error fetching onboarding status', error);
      set({
        error: error.message || 'Failed to fetch onboarding status',
        loading: false,
      });
    }
  },

  // Complete a specific step
  completeStep: async (step: string) => {
    try {
      const response = await markStepComplete(step);

      if (response.success && response.data) {
        set({ status: response.data });
      } else {
        set({ error: response.error || 'Failed to complete step' });
      }
    } catch (error: any) {
      logError(`Error completing step ${step}`, error);
      set({ error: error.message || 'Failed to complete step' });
    }
  },

  // Dismiss onboarding
  dismiss: async () => {
    try {
      const response = await dismissOnboarding();

      if (response.success && response.data) {
        set({ status: response.data });
      } else {
        set({ error: response.error || 'Failed to dismiss onboarding' });
      }
    } catch (error: any) {
      logError('Error dismissing onboarding', error);
      set({ error: error.message || 'Failed to dismiss onboarding' });
    }
  },

  // Re-enable onboarding
  reEnable: async () => {
    try {
      const response = await reEnableOnboarding();

      if (response.success && response.data) {
        set({ status: response.data });
      } else {
        set({ error: response.error || 'Failed to re-enable onboarding' });
      }
    } catch (error: any) {
      logError('Error re-enabling onboarding', error);
      set({ error: error.message || 'Failed to re-enable onboarding' });
    }
  },

  // Reset store
  reset: () => {
    set({
      status: null,
      loading: false,
      error: null,
      lastFetched: null,
    });
  },
}));

// =====================================================
// COMPUTED SELECTORS
// =====================================================

/**
 * Hook with computed selectors for easy access
 */
export function useOnboarding() {
  const store = useOnboardingStore();

  return {
    // State
    status: store.status,
    loading: store.loading,
    error: store.error,

    // Computed values
    currentStage: store.status?.currentStage || 'welcome',
    progress: store.status?.progress || 0,
    isCompleted: store.status?.isCompleted || false,
    isDismissed: store.status?.isDismissed || false,
    nextStep: store.status?.nextStep || null,
    stages: store.status?.stages || [],
    completedStages: store.status?.completedStages || [],

    // Actions
    fetchStatus: store.fetchStatus,
    completeStep: store.completeStep,
    dismiss: store.dismiss,
    reEnable: store.reEnable,
    reset: store.reset,
  };
}

/**
 * Hook to check if onboarding should be shown
 * Returns true if onboarding is active and not completed/dismissed
 */
export function useShouldShowOnboarding(): boolean {
  const { isCompleted, isDismissed, status } = useOnboarding();
  return !!(status && !isCompleted && !isDismissed);
}

/**
 * Hook to get a specific stage's status
 */
export function useOnboardingStage(stageId: string) {
  const { stages } = useOnboarding();
  return stages.find(stage => stage.id === stageId) || null;
}
