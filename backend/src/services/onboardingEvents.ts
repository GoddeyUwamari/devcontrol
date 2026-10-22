/**
 * Onboarding Events System
 * Emits events when key actions happen that complete onboarding steps
 * This allows onboarding to auto-complete based on user actions
 */

import { EventEmitter } from 'events';
import { pool } from '../config/database';

// =====================================================
// EVENT EMITTER
// =====================================================

class OnboardingEventEmitter extends EventEmitter {}
export const onboardingEvents = new OnboardingEventEmitter();

// =====================================================
// EVENT LISTENERS
// =====================================================

/**
 * Listen for service creation
 * Auto-completes "create_service" step
 */
onboardingEvents.on('service:created', async (data: { organizationId: string; userId: string; serviceId: string }) => {
  try {
    console.log(`[Onboarding] Service created for org ${data.organizationId}`);

    await pool.query(
      `UPDATE onboarding_progress
       SET first_service_created_at = NOW(),
           updated_at = NOW()
       WHERE organization_id = $1 AND first_service_created_at IS NULL`,
      [data.organizationId]
    );

    console.log(`[Onboarding] Step 'create_service' auto-completed for org ${data.organizationId}`);
  } catch (error) {
    console.error('[Onboarding] Error auto-completing service step:', error);
  }
});

/**
 * Listen for deployment creation
 * Auto-completes "log_deployment" step
 */
onboardingEvents.on('deployment:created', async (data: { organizationId: string; userId: string; deploymentId: string }) => {
  try {
    console.log(`[Onboarding] Deployment created for org ${data.organizationId}`);

    await pool.query(
      `UPDATE onboarding_progress
       SET first_deployment_created_at = NOW(),
           updated_at = NOW()
       WHERE organization_id = $1 AND first_deployment_created_at IS NULL`,
      [data.organizationId]
    );

    console.log(`[Onboarding] Step 'log_deployment' auto-completed for org ${data.organizationId}`);
  } catch (error) {
    console.error('[Onboarding] Error auto-completing deployment step:', error);
  }
});

/**
 * Listen for resource discovery completion
 * Auto-completes "discover_resources" step
 */
onboardingEvents.on('resources:discovered', async (data: { organizationId: string; userId: string; resourceCount: number }) => {
  try {
    console.log(`[Onboarding] Resources discovered for org ${data.organizationId} (${data.resourceCount} resources)`);

    await pool.query(
      `UPDATE onboarding_progress
       SET resources_discovered_at = NOW(),
           updated_at = NOW()
       WHERE organization_id = $1 AND resources_discovered_at IS NULL`,
      [data.organizationId]
    );

    console.log(`[Onboarding] Step 'discover_resources' auto-completed for org ${data.organizationId}`);
  } catch (error) {
    console.error('[Onboarding] Error auto-completing resources step:', error);
  }
});

/**
 * Listen for onboarding completion
 * Used for analytics and notifications
 */
onboardingEvents.on('onboarding:completed', async (data: { organizationId: string; userId: string; completedAt: Date }) => {
  try {
    console.log(`[Onboarding] ✅ Onboarding completed for org ${data.organizationId}`);

    // Could trigger:
    // - Celebration email
    // - Slack notification
    // - Analytics event
    // - Enable advanced features

    // Example: Track analytics event
    await pool.query(
      `INSERT INTO analytics_events (user_id, organization_id, event_name, event_category, properties)
       VALUES ($1, $2, 'onboarding_completed', 'onboarding', $3)`,
      [
        data.userId,
        data.organizationId,
        JSON.stringify({
          completed_at: data.completedAt,
          timestamp: new Date(),
        }),
      ]
    );
  } catch (error) {
    console.error('[Onboarding] Error handling completion event:', error);
  }
});

/**
 * Listen for onboarding dismissal
 * Track when users skip onboarding
 */
onboardingEvents.on('onboarding:dismissed', async (data: { organizationId: string; userId: string; progress: number }) => {
  try {
    console.log(`[Onboarding] Onboarding dismissed by org ${data.organizationId} at ${data.progress}% progress`);

    // Track analytics
    await pool.query(
      `INSERT INTO analytics_events (user_id, organization_id, event_name, event_category, properties)
       VALUES ($1, $2, 'onboarding_dismissed', 'onboarding', $3)`,
      [
        data.userId,
        data.organizationId,
        JSON.stringify({
          progress: data.progress,
          timestamp: new Date(),
        }),
      ]
    );
  } catch (error) {
    console.error('[Onboarding] Error handling dismissal event:', error);
  }
});

// =====================================================
// HELPER: Emit event with error handling
// =====================================================

export function emitOnboardingEvent(eventName: string, data: any) {
  try {
    onboardingEvents.emit(eventName, data);
  } catch (error) {
    console.error(`[Onboarding] Error emitting event ${eventName}:`, error);
  }
}

// =====================================================
// EXPORT
// =====================================================

export default onboardingEvents;
