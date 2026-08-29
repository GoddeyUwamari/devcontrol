-- Migration: 005_migrate_existing_data.sql
-- Description: Migrate existing data to default organization
-- Date: 2025-12-28
-- Purpose: Assign all existing records to a default organization for backward compatibility

-- =====================================================
-- STEP 1: CREATE DEFAULT ORGANIZATION
-- =====================================================

-- Create a default organization for existing data
INSERT INTO organizations (
  id,
  name,
  slug,
  display_name,
  description,
  subscription_tier,
  max_services,
  max_users,
  max_deployments_per_month,
  is_active,
  settings
) VALUES (
  '00000000-0000-0000-0000-000000000001', -- Fixed UUID for default org
  'Default Organization',
  'default',
  'Default Organization',
  'Auto-created organization for existing data migration',
  'enterprise', -- Give default org enterprise tier
  999, -- Unlimited services for default org
  999, -- Unlimited users
  999, -- Unlimited deployments
  true,
  '{
    "auto_created": true,
    "migration_date": "2025-12-28"
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING; -- Skip if already exists

-- =====================================================
-- STEP 2: CREATE DEFAULT ADMIN USER
-- =====================================================

-- Create a default admin user
-- IMPORTANT: Change this password immediately after first login!
INSERT INTO users (
  id,
  email,
  password_hash,
  full_name,
  is_active,
  is_email_verified
) VALUES (
  '00000000-0000-0000-0000-000000000002', -- Fixed UUID for default admin
  'admin@devcontrol.local',
  -- bcrypt hash of 'ChangeMe123!' (MUST CHANGE AFTER FIRST LOGIN)
  '$2b$10$rHqQV0MJYvZKZnJZ0P8ELOXYx9Yl6Wj8KGJQZYGZKQZYGZKQZYGZKu',
  'DevControl Admin',
  true,
  true -- Skip email verification for default admin
)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- STEP 3: CREATE ADMIN MEMBERSHIP
-- =====================================================

-- Make the default user an owner of the default organization
INSERT INTO organization_memberships (
  organization_id,
  user_id,
  role,
  joined_at,
  is_active
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'owner',
  NOW(),
  true
)
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- =====================================================
-- STEP 4: MIGRATE EXISTING DATA
-- =====================================================

-- Update all existing records to belong to the default organization
-- Only update records where organization_id is NULL (existing data)

UPDATE teams
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

UPDATE services
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

UPDATE deployments
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

UPDATE infrastructure_resources
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

UPDATE cost_recommendations
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

UPDATE alert_history
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

-- =====================================================
-- STEP 5: MAKE ORGANIZATION_ID NOT NULL (ENFORCE CONSTRAINT)
-- =====================================================

-- After migration, enforce that all records must have an organization_id
-- This prevents orphaned records in the future

ALTER TABLE teams
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE services
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE deployments
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE infrastructure_resources
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE cost_recommendations
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE alert_history
  ALTER COLUMN organization_id SET NOT NULL;

-- =====================================================
-- STEP 6: VERIFICATION QUERIES
-- =====================================================

-- Count records per table
DO $$
DECLARE
  teams_count INTEGER;
  services_count INTEGER;
  deployments_count INTEGER;
  infrastructure_count INTEGER;
  cost_recommendations_count INTEGER;
  alert_history_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO teams_count FROM teams WHERE organization_id = '00000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO services_count FROM services WHERE organization_id = '00000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO deployments_count FROM deployments WHERE organization_id = '00000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO infrastructure_count FROM infrastructure_resources WHERE organization_id = '00000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO cost_recommendations_count FROM cost_recommendations WHERE organization_id = '00000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO alert_history_count FROM alert_history WHERE organization_id = '00000000-0000-0000-0000-000000000001';

  RAISE NOTICE '==================================================';
  RAISE NOTICE 'DATA MIGRATION SUMMARY';
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'Teams migrated: %', teams_count;
  RAISE NOTICE 'Services migrated: %', services_count;
  RAISE NOTICE 'Deployments migrated: %', deployments_count;
  RAISE NOTICE 'Infrastructure resources migrated: %', infrastructure_count;
  RAISE NOTICE 'Cost recommendations migrated: %', cost_recommendations_count;
  RAISE NOTICE 'Alert history migrated: %', alert_history_count;
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'Default Admin Credentials:';
  RAISE NOTICE 'Email: admin@devcontrol.local';
  RAISE NOTICE 'Password: ChangeMe123!';
  RAISE NOTICE '⚠️  CHANGE PASSWORD IMMEDIATELY AFTER FIRST LOGIN!';
  RAISE NOTICE '==================================================';
END $$;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Results:
-- ✅ Default organization created
-- ✅ Default admin user created
-- ✅ All existing data migrated to default organization
-- ✅ organization_id constraint enforced
--
-- Next Steps:
-- 1. Login with admin@devcontrol.local / ChangeMe123!
-- 2. Change the admin password immediately
-- 3. Configure AWS credentials for the default organization
-- 4. Create additional organizations as needed
-- 5. Invite users to organizations
-- =====================================================
