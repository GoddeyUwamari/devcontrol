-- Migration: Rename Services to Professional Names
-- Description: Update test/demo service names to professional production names
-- Date: 2025-12-28
-- IMPORTANT: This migration only updates service names, descriptions, owners, and templates.
--            It does NOT change UUIDs, so all foreign key relationships remain intact.

-- ============================================================================
-- STEP 1: VERIFICATION - Check current services before migration
-- ============================================================================

-- Find organization ID (if needed)
SELECT
  id,
  name,
  'Found organization' AS status
FROM organizations
WHERE name = 'Default Organization';

-- Verify current services exist
SELECT
  id,
  name,
  template,
  owner,
  organization_id,
  'Current service - will be renamed' AS status
FROM services
WHERE name IN (
  'test-api',
  'user-service',
  'payment-service',
  'analytics-pipeline',
  'frontend-app',
  'ml-service'
)
AND organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;

-- Show what will be updated (dry run preview)
SELECT
  name AS old_name,
  CASE
    WHEN name = 'test-api' THEN 'auth-gateway'
    WHEN name = 'user-service' THEN 'customer-portal-api'
    WHEN name = 'payment-service' THEN 'checkout-service'
    WHEN name = 'analytics-pipeline' THEN 'data-ingestion-pipeline'
    WHEN name = 'frontend-app' THEN 'web-dashboard'
    WHEN name = 'ml-service' THEN 'recommendation-engine'
  END AS new_name,
  template AS old_template,
  CASE
    WHEN template = 'api' THEN 'REST API'
    WHEN template = 'microservices' THEN 'Microservice'
    WHEN name = 'analytics-pipeline' THEN 'Data Pipeline'
    WHEN name = 'frontend-app' THEN 'Frontend App'
    ELSE template
  END AS new_template,
  owner AS old_owner,
  CASE
    WHEN name = 'test-api' THEN 'Platform Team'
    WHEN name = 'user-service' THEN 'Frontend Team'
    WHEN name = 'payment-service' THEN 'Payments Team'
    WHEN name = 'analytics-pipeline' THEN 'Data Team'
    WHEN name = 'frontend-app' THEN 'Frontend Team'
    WHEN name = 'ml-service' THEN 'ML Team'
  END AS new_owner
FROM services
WHERE name IN (
  'test-api',
  'user-service',
  'payment-service',
  'analytics-pipeline',
  'frontend-app',
  'ml-service'
)
AND organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;

-- ============================================================================
-- STEP 2: CREATE BACKUP TABLE (Optional but recommended)
-- ============================================================================

-- Create temporary backup table before making changes
DROP TABLE IF EXISTS services_backup_20251228;
CREATE TABLE services_backup_20251228 AS
SELECT * FROM services
WHERE organization_id = '00000000-0000-0000-0000-000000000001';

SELECT
  COUNT(*) AS backed_up_services,
  'Backup created successfully' AS status
FROM services_backup_20251228;

-- ============================================================================
-- STEP 3: EXECUTE MIGRATION - Update service names and details
-- ============================================================================

BEGIN;

-- Update 1: test-api -> auth-gateway
UPDATE services
SET
  name = 'auth-gateway',
  template = 'REST API',
  owner = 'Platform Team',
  description = 'Authentication and authorization gateway with JWT/OAuth support',
  updated_at = NOW()
WHERE name = 'test-api'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Update 2: user-service -> customer-portal-api
UPDATE services
SET
  name = 'customer-portal-api',
  template = 'REST API',
  owner = 'Frontend Team',
  description = 'Customer-facing portal backend handling profiles and preferences',
  updated_at = NOW()
WHERE name = 'user-service'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Update 3: payment-service -> checkout-service
UPDATE services
SET
  name = 'checkout-service',
  template = 'Microservice',
  owner = 'Payments Team',
  description = 'Payment processing with Stripe integration and fraud detection',
  updated_at = NOW()
WHERE name = 'payment-service'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Update 4: analytics-pipeline -> data-ingestion-pipeline
UPDATE services
SET
  name = 'data-ingestion-pipeline',
  template = 'Data Pipeline',
  owner = 'Data Team',
  description = 'Real-time event streaming and analytics data processing',
  updated_at = NOW()
WHERE name = 'analytics-pipeline'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Update 5: frontend-app -> web-dashboard
UPDATE services
SET
  name = 'web-dashboard',
  template = 'Frontend App',
  owner = 'Frontend Team',
  description = 'React-based admin dashboard for platform management',
  updated_at = NOW()
WHERE name = 'frontend-app'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Update 6: ml-service -> recommendation-engine
UPDATE services
SET
  name = 'recommendation-engine',
  template = 'Microservice',
  owner = 'ML Team',
  description = 'ML-powered product recommendations using collaborative filtering',
  updated_at = NOW()
WHERE name = 'ml-service'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Fix any remaining generic templates for consistency
UPDATE services
SET template = 'REST API', updated_at = NOW()
WHERE template = 'api'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

UPDATE services
SET template = 'Microservice', updated_at = NOW()
WHERE template = 'microservices'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

COMMIT;

-- ============================================================================
-- STEP 4: VERIFICATION - Confirm changes were applied correctly
-- ============================================================================

-- Verify all services renamed correctly
SELECT
  id,
  name,
  template,
  owner,
  description,
  updated_at,
  'Successfully renamed' AS status
FROM services
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;

-- Count services by template type
SELECT
  template,
  COUNT(*) AS count
FROM services
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
GROUP BY template
ORDER BY template;

-- Verify service dependencies still intact
SELECT
  sd.id,
  s1.name AS source_service,
  s2.name AS target_service,
  sd.dependency_type,
  'Dependency link intact' AS status
FROM service_dependencies sd
JOIN services s1 ON sd.source_service_id = s1.id
JOIN services s2 ON sd.target_service_id = s2.id
WHERE sd.organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY s1.name, s2.name;

-- Verify deployments still linked correctly
SELECT
  d.id,
  s.name AS service_name,
  d.environment,
  d.version,
  d.status,
  d.created_at,
  'Deployment link intact' AS status
FROM deployments d
JOIN services s ON d.service_id = s.id
WHERE d.organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY d.created_at DESC
LIMIT 20;

-- Verify no orphaned records (should return 0 rows)
SELECT
  d.id,
  d.service_id,
  'WARNING: Orphaned deployment' AS status
FROM deployments d
WHERE d.organization_id = '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM services s
    WHERE s.id = d.service_id
  );

-- ============================================================================
-- MIGRATION SUMMARY
-- ============================================================================

SELECT
  'Migration completed successfully!' AS summary,
  COUNT(*) AS total_services,
  STRING_AGG(name, ', ' ORDER BY name) AS renamed_services
FROM services
WHERE organization_id = '00000000-0000-0000-0000-000000000001';
