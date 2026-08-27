-- Migration: 010_create_analytics_events.sql
-- Description: Create analytics events table for tracking user actions and onboarding funnel
-- Date: 2026-01-03

-- =====================================================
-- ANALYTICS EVENTS TABLE
-- =====================================================
-- Stores all user actions for analytics and funnel tracking
-- Complements external analytics tools (Mixpanel, Amplitude, PostHog)

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who & Where
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  session_id VARCHAR(255), -- Browser session ID for tracking multi-event sessions

  -- What happened
  event_name VARCHAR(100) NOT NULL, -- e.g., 'onboarding_cta_clicked', 'service_created'
  event_category VARCHAR(50), -- e.g., 'onboarding', 'service', 'deployment'

  -- Event metadata (flexible JSONB for any properties)
  properties JSONB NOT NULL DEFAULT '{}',

  -- Context
  url TEXT, -- Page where event occurred
  user_agent TEXT, -- Browser/device info
  ip_address INET, -- User IP (for geo tracking)
  referrer TEXT, -- Where user came from

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Optional: Pre-computed dimensions for fast querying
  device_type VARCHAR(20), -- mobile, tablet, desktop
  browser VARCHAR(50), -- chrome, firefox, safari, etc.
  os VARCHAR(50) -- macos, windows, linux, ios, android
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Primary query patterns
CREATE INDEX idx_analytics_user ON analytics_events(user_id, created_at DESC);
CREATE INDEX idx_analytics_org ON analytics_events(organization_id, created_at DESC);
CREATE INDEX idx_analytics_event_name ON analytics_events(event_name, created_at DESC);
CREATE INDEX idx_analytics_category ON analytics_events(event_category, created_at DESC);
CREATE INDEX idx_analytics_session ON analytics_events(session_id, created_at DESC);

-- Time-based queries (for reports)
CREATE INDEX idx_analytics_created_at ON analytics_events(created_at DESC);
-- Note: Removed date index due to immutability requirements. Use WHERE clause instead.

-- JSONB properties index (for filtering by custom properties)
CREATE INDEX idx_analytics_properties ON analytics_events USING GIN(properties);

-- Composite indexes for common onboarding queries
CREATE INDEX idx_analytics_onboarding_funnel ON analytics_events(organization_id, event_name, created_at)
  WHERE event_category = 'onboarding';

-- =====================================================
-- ROW-LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see events for their current organization
CREATE POLICY analytics_org_isolation ON analytics_events
  FOR SELECT
  USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
    OR organization_id IS NULL -- Allow viewing of anonymous events
  );

-- Policy: Users can insert events for their organization
CREATE POLICY analytics_insert ON analytics_events
  FOR INSERT
  WITH CHECK (
    organization_id = current_setting('app.current_organization_id', true)::uuid
    OR organization_id IS NULL
  );

-- =====================================================
-- PARTITIONING (Optional - for high-volume analytics)
-- =====================================================
-- Uncomment if you expect >1M events/month
-- This partitions by month for better query performance

-- ALTER TABLE analytics_events PARTITION BY RANGE (created_at);
--
-- -- Create partitions for 2026
-- CREATE TABLE analytics_events_2026_01 PARTITION OF analytics_events
--   FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- CREATE TABLE analytics_events_2026_02 PARTITION OF analytics_events
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- -- ... create more partitions as needed

-- =====================================================
-- HELPER VIEWS FOR COMMON QUERIES
-- =====================================================

-- Onboarding funnel view (today)
CREATE OR REPLACE VIEW onboarding_funnel_today AS
SELECT
  event_name,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_events,
  AVG((properties->>'timeToComplete')::numeric) as avg_time_seconds
FROM analytics_events
WHERE event_category = 'onboarding'
  AND created_at >= CURRENT_DATE
GROUP BY event_name
ORDER BY MIN(created_at);

-- Onboarding completion rates by organization
CREATE OR REPLACE VIEW onboarding_completion_by_org AS
SELECT
  o.name as organization,
  COUNT(DISTINCT CASE WHEN ae.event_name = 'onboarding_started' THEN ae.user_id END) as started,
  COUNT(DISTINCT CASE WHEN ae.event_name = 'onboarding_step_completed' AND ae.properties->>'step' = 'create_service' THEN ae.user_id END) as completed_service,
  COUNT(DISTINCT CASE WHEN ae.event_name = 'onboarding_step_completed' AND ae.properties->>'step' = 'log_deployment' THEN ae.user_id END) as completed_deployment,
  COUNT(DISTINCT CASE WHEN ae.event_name = 'onboarding_completed' THEN ae.user_id END) as completed_all,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN ae.event_name = 'onboarding_completed' THEN ae.user_id END) /
    NULLIF(COUNT(DISTINCT CASE WHEN ae.event_name = 'onboarding_started' THEN ae.user_id END), 0),
    2
  ) as completion_rate_pct
FROM organizations o
LEFT JOIN analytics_events ae ON ae.organization_id = o.id
WHERE ae.event_category = 'onboarding' OR ae.event_category IS NULL
GROUP BY o.id, o.name
ORDER BY started DESC;

-- Daily active users
CREATE OR REPLACE VIEW daily_active_users AS
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT user_id) as dau,
  COUNT(DISTINCT organization_id) as active_orgs
FROM analytics_events
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- =====================================================
-- FUNCTIONS: Easy event tracking
-- =====================================================

-- Function to track an event (can be called from triggers)
CREATE OR REPLACE FUNCTION track_event(
  p_user_id UUID,
  p_organization_id UUID,
  p_event_name VARCHAR,
  p_event_category VARCHAR DEFAULT NULL,
  p_properties JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO analytics_events (
    user_id,
    organization_id,
    event_name,
    event_category,
    properties
  )
  VALUES (
    p_user_id,
    p_organization_id,
    p_event_name,
    p_event_category,
    p_properties
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- AUTO-TRACKING TRIGGERS (Optional)
-- =====================================================

-- Auto-track service creation
CREATE OR REPLACE FUNCTION track_service_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM track_event(
    NEW.created_by,
    NEW.organization_id,
    'service_created',
    'service',
    jsonb_build_object(
      'service_id', NEW.id,
      'service_name', NEW.name
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_track_service_created ON services;
CREATE TRIGGER trigger_track_service_created
  AFTER INSERT ON services
  FOR EACH ROW
  EXECUTE FUNCTION track_service_created();

-- Auto-track deployment creation
CREATE OR REPLACE FUNCTION track_deployment_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM track_event(
    NEW.created_by,
    NEW.organization_id,
    'deployment_created',
    'deployment',
    jsonb_build_object(
      'deployment_id', NEW.id,
      'service_id', NEW.service_id,
      'environment', NEW.environment,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_track_deployment_created ON deployments;
CREATE TRIGGER trigger_track_deployment_created
  AFTER INSERT ON deployments
  FOR EACH ROW
  EXECUTE FUNCTION track_deployment_created();

-- =====================================================
-- DATA RETENTION POLICY
-- =====================================================
-- Optional: Auto-delete old events to save space
-- Uncomment to enable 90-day retention

-- CREATE OR REPLACE FUNCTION cleanup_old_analytics_events()
-- RETURNS void AS $$
-- BEGIN
--   DELETE FROM analytics_events
--   WHERE created_at < NOW() - INTERVAL '90 days';
-- END;
-- $$ LANGUAGE plpgsql;

-- Schedule with pg_cron (if available):
-- SELECT cron.schedule('cleanup-analytics', '0 2 * * 0', 'SELECT cleanup_old_analytics_events()');

-- =====================================================
-- SEED DATA (Example events)
-- =====================================================

-- Example: Track onboarding started for all existing users
INSERT INTO analytics_events (user_id, organization_id, event_name, event_category, properties)
SELECT
  u.id as user_id,
  om.organization_id,
  'onboarding_started',
  'onboarding',
  jsonb_build_object('signup_date', u.created_at)
FROM users u
JOIN organization_memberships om ON om.user_id = u.id
WHERE om.role = 'owner' -- Only track for org owners
ON CONFLICT DO NOTHING;

-- =====================================================
-- COMMENTS (Documentation)
-- =====================================================

COMMENT ON TABLE analytics_events IS 'Stores all user actions for analytics, funnel tracking, and product insights';
COMMENT ON COLUMN analytics_events.event_name IS 'Unique event identifier (e.g., onboarding_cta_clicked, service_created)';
COMMENT ON COLUMN analytics_events.event_category IS 'Event grouping for filtering (e.g., onboarding, service, deployment)';
COMMENT ON COLUMN analytics_events.properties IS 'Flexible JSONB for any event-specific data';
COMMENT ON COLUMN analytics_events.session_id IS 'Browser session ID to track user journey across events';

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check recent events
-- SELECT
--   event_name,
--   event_category,
--   COUNT(*) as count,
--   COUNT(DISTINCT user_id) as unique_users
-- FROM analytics_events
-- WHERE created_at >= NOW() - INTERVAL '24 hours'
-- GROUP BY event_name, event_category
-- ORDER BY count DESC;

-- Check onboarding funnel
-- SELECT * FROM onboarding_funnel_today;

-- Check completion rates
-- SELECT * FROM onboarding_completion_by_org;

-- =====================================================
-- ROLLBACK (if needed)
-- =====================================================

-- DROP VIEW IF EXISTS onboarding_funnel_today;
-- DROP VIEW IF EXISTS onboarding_completion_by_org;
-- DROP VIEW IF EXISTS daily_active_users;
-- DROP TRIGGER IF EXISTS trigger_track_service_created ON services;
-- DROP TRIGGER IF EXISTS trigger_track_deployment_created ON deployments;
-- DROP FUNCTION IF EXISTS track_event;
-- DROP FUNCTION IF EXISTS track_service_created();
-- DROP FUNCTION IF EXISTS track_deployment_created();
-- DROP TABLE IF EXISTS analytics_events CASCADE;
