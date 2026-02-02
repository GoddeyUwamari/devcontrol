-- ================================================
-- Migration: Add Email Preferences to Users
-- Purpose: Enable opt-in/opt-out for email notifications
-- CAN-SPAM Act Compliance
-- ================================================

-- Add email preference columns
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_weekly_summary BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS email_anomaly_alerts BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS email_cost_alerts BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS email_deployment_alerts BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS email_preferences_updated_at TIMESTAMP WITH TIME ZONE;

-- Add index for performance (only index true values for efficiency)
CREATE INDEX IF NOT EXISTS idx_users_email_weekly_summary
ON users(email_weekly_summary)
WHERE email_weekly_summary = true;

CREATE INDEX IF NOT EXISTS idx_users_email_verified
ON users(is_email_verified)
WHERE is_email_verified = true;

-- Add comments for documentation
COMMENT ON COLUMN users.email_weekly_summary IS 'User opt-in for weekly AI summary emails (sent every Monday at 9 AM)';
COMMENT ON COLUMN users.email_anomaly_alerts IS 'User opt-in for real-time anomaly detection alerts';
COMMENT ON COLUMN users.email_cost_alerts IS 'User opt-in for cost spike alerts';
COMMENT ON COLUMN users.email_deployment_alerts IS 'User opt-in for deployment failure alerts';
COMMENT ON COLUMN users.email_preferences_updated_at IS 'Timestamp of last email preference update';

-- Ensure existing users are opted-in by default (grandfather clause)
-- This respects existing users' implicit consent
UPDATE users
SET email_weekly_summary = true,
    email_anomaly_alerts = true,
    email_cost_alerts = true,
    email_deployment_alerts = true,
    email_preferences_updated_at = NOW()
WHERE email_weekly_summary IS NULL;

-- Display success message
DO $$
BEGIN
  RAISE NOTICE 'Email preferences migration completed successfully';
  RAISE NOTICE 'All existing users have been opted-in by default';
  RAISE NOTICE 'Users can opt-out via /settings/notifications';
END $$;
