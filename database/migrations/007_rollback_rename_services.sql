-- Rollback Migration: Revert Professional Service Names to Original Names
-- Description: Rollback script for 007_rename_services_professional.sql
-- Date: 2025-12-28
-- IMPORTANT: Only run this if you need to revert the service name changes

-- ============================================================================
-- STEP 1: VERIFICATION - Check current state before rollback
-- ============================================================================

-- Verify services that will be rolled back
SELECT
  id,
  name,
  template,
  owner,
  organization_id,
  'Will be rolled back to original name' AS status
FROM services
WHERE name IN (
  'auth-gateway',
  'customer-portal-api',
  'checkout-service',
  'data-ingestion-pipeline',
  'web-dashboard',
  'recommendation-engine'
)
AND organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;

-- Show what will be reverted (dry run preview)
SELECT
  name AS current_name,
  CASE
    WHEN name = 'auth-gateway' THEN 'test-api'
    WHEN name = 'customer-portal-api' THEN 'user-service'
    WHEN name = 'checkout-service' THEN 'payment-service'
    WHEN name = 'data-ingestion-pipeline' THEN 'analytics-pipeline'
    WHEN name = 'web-dashboard' THEN 'frontend-app'
    WHEN name = 'recommendation-engine' THEN 'ml-service'
  END AS original_name
FROM services
WHERE name IN (
  'auth-gateway',
  'customer-portal-api',
  'checkout-service',
  'data-ingestion-pipeline',
  'web-dashboard',
  'recommendation-engine'
)
AND organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;

-- ============================================================================
-- STEP 2: EXECUTE ROLLBACK - Revert to original names
-- ============================================================================

BEGIN;

-- Rollback 1: auth-gateway -> test-api
UPDATE services
SET
  name = 'test-api',
  template = 'api',
  owner = 'Engineering',
  description = 'Test API service',
  updated_at = NOW()
WHERE name = 'auth-gateway'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Rollback 2: customer-portal-api -> user-service
UPDATE services
SET
  name = 'user-service',
  template = 'microservices',
  owner = 'Engineering',
  description = 'User management service',
  updated_at = NOW()
WHERE name = 'customer-portal-api'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Rollback 3: checkout-service -> payment-service
UPDATE services
SET
  name = 'payment-service',
  template = 'microservices',
  owner = 'Engineering',
  description = 'Payment processing service',
  updated_at = NOW()
WHERE name = 'checkout-service'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Rollback 4: data-ingestion-pipeline -> analytics-pipeline
UPDATE services
SET
  name = 'analytics-pipeline',
  template = 'microservices',
  owner = 'Engineering',
  description = 'Analytics data pipeline',
  updated_at = NOW()
WHERE name = 'data-ingestion-pipeline'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Rollback 5: web-dashboard -> frontend-app
UPDATE services
SET
  name = 'frontend-app',
  template = 'microservices',
  owner = 'Engineering',
  description = 'Frontend application',
  updated_at = NOW()
WHERE name = 'web-dashboard'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

-- Rollback 6: recommendation-engine -> ml-service
UPDATE services
SET
  name = 'ml-service',
  template = 'microservices',
  owner = 'Engineering',
  description = 'Machine learning service',
  updated_at = NOW()
WHERE name = 'recommendation-engine'
  AND organization_id = '00000000-0000-0000-0000-000000000001';

COMMIT;

-- ============================================================================
-- STEP 3: VERIFICATION - Confirm rollback was applied correctly
-- ============================================================================

-- Verify all services reverted correctly
SELECT
  id,
  name,
  template,
  owner,
  description,
  updated_at,
  'Successfully rolled back' AS status
FROM services
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY name;

-- Verify dependencies still intact after rollback
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

-- ============================================================================
-- ROLLBACK SUMMARY
-- ============================================================================

SELECT
  'Rollback completed - services reverted to original names' AS summary,
  COUNT(*) AS total_services,
  STRING_AGG(name, ', ' ORDER BY name) AS current_services
FROM services
WHERE organization_id = '00000000-0000-0000-0000-000000000001';
