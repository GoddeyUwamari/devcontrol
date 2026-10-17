/**
 * Onboarding API Service
 * Handles all onboarding-related API calls
 */

import { api } from '../api';
import type {
  OnboardingStatus,
  OnboardingMetrics,
  OnboardingFunnel,
  ApiResponse,
} from '../types/onboarding';
import { logError } from '@/lib/safe-log';

/**
 * Get current onboarding status for the organization
 */
export async function getOnboardingStatus(): Promise<ApiResponse<OnboardingStatus>> {
  try {
    const response = await api.get('/api/onboarding/status');
    return response.data;
  } catch (error: any) {
    logError('Error fetching onboarding status', error);
    throw error;
  }
}

/**
 * Mark a specific step as complete
 * @param step - The step ID to complete (e.g., 'welcome', 'discover_resources')
 */
export async function markStepComplete(step: string): Promise<ApiResponse<OnboardingStatus>> {
  try {
    const response = await api.post(`/api/onboarding/complete/${step}`);
    return response.data;
  } catch (error: any) {
    logError(`Error completing step ${step}`, error);
    throw error;
  }
}

/**
 * Dismiss/skip onboarding
 */
export async function dismissOnboarding(): Promise<ApiResponse<OnboardingStatus>> {
  try {
    const response = await api.post('/api/onboarding/dismiss');
    return response.data;
  } catch (error: any) {
    logError('Error dismissing onboarding', error);
    throw error;
  }
}

/**
 * Re-enable onboarding if dismissed
 */
export async function reEnableOnboarding(): Promise<ApiResponse<OnboardingStatus>> {
  try {
    const response = await api.post('/api/onboarding/re-enable');
    return response.data;
  } catch (error: any) {
    logError('Error re-enabling onboarding', error);
    throw error;
  }
}

/**
 * Get overall onboarding metrics (admin only)
 */
export async function getOnboardingMetrics(): Promise<ApiResponse<OnboardingMetrics>> {
  try {
    const response = await api.get('/api/onboarding/metrics');
    return response.data;
  } catch (error: any) {
    logError('Error fetching onboarding metrics', error);
    throw error;
  }
}

/**
 * Get funnel conversion rates (admin only)
 */
export async function getOnboardingFunnel(): Promise<ApiResponse<OnboardingFunnel>> {
  try {
    const response = await api.get('/api/onboarding/funnel');
    return response.data;
  } catch (error: any) {
    logError('Error fetching onboarding funnel', error);
    throw error;
  }
}
