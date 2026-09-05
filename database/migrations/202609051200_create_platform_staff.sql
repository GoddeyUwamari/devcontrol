-- Migration: 202609051200_create_platform_staff.sql
-- Description: Creates `platform_staff`, the persistence layer for TRUE
--   platform-level (DevControl employee/operator) authorization -- distinct
--   from and independent of `organization_memberships.role`
--   (owner/admin/member/viewer), which is a per-tenant identity concern.
--
--   Design notes:
--   - Deliberately has NO organization_id and NO RLS. Platform staff status
--     represents a privilege independent of tenant membership, not a
--     tenant-scoped resource -- adding organization_id here would defeat
--     the entire point (see the architecture audit that preceded this
--     migration). This is a brand-new table created (and owned) by
--     devcontrol itself, so -- like refunds
--     (202608311500_create_refunds.sql) -- it belongs in the ordinary
--     database/migrations/ path, not database/migrations-admin/.
--   - user_id is UNIQUE: a user is either platform staff or not -- there is
--     no scenario requiring multiple rows per user, and the UNIQUE
--     constraint's own index is exactly the lookup
--     `requirePlatformStaff` needs (no separate index required).
--   - role is free text with a documented default, matching this
--     repository's existing convention for `organization_memberships.role`
--     (004_add_multi_tenancy.sql) rather than a CHECK-constrained enum --
--     deliberately NOT differentiating platform roles in this migration
--     (single 'staff' value for now); a future differentiated role can be
--     introduced without a schema change.
--   - status IS a CHECK-constrained closed set (active/revoked): unlike
--     role, this is a stable, exhaustive pair the authorization middleware
--     directly branches on, matching the precedent in refunds.status.
--   - added_by is nullable and ON DELETE SET NULL (not CASCADE): if the
--     staff member who granted access is later removed, the grant record
--     for the person who RECEIVED access must not disappear with them --
--     only the "who granted it" attribution is lost. This is the same
--     two-FKs-into-users pattern already used by
--     organization_memberships.invited_by, not a circular reference.
--   - No rows are inserted by this migration. Table starts empty in every
--     environment, including production -- the first real grant is a
--     deliberate, separate operational action (see
--     backend/scripts/manage-platform-staff.js), never part of a migration.
--     That script deliberately lives under backend/scripts/, not database/:
--     .github/workflows/ci.yml's deploy-migration-tooling job tars up the
--     entire database/ directory (minus seeds/ and migrations-admin/) as
--     the production migration-deploy artifact, and migrate-deploy.test.ts
--     asserts that artifact contains only migrate.js + migrations/** -- an
--     unrelated ops script under database/ would silently ship inside it.
-- Date: 2026-09-05

CREATE TABLE platform_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  role VARCHAR(50) NOT NULL DEFAULT 'staff', -- currently only 'staff' is used; reserved for future differentiated platform roles

  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT ALL ON TABLE platform_staff TO devcontrol;

CREATE OR REPLACE FUNCTION update_platform_staff_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_staff_updated_at
  BEFORE UPDATE ON platform_staff
  FOR EACH ROW
  EXECUTE FUNCTION update_platform_staff_updated_at();

COMMENT ON TABLE platform_staff IS
  'TRUE platform-level (DevControl employee/operator) authorization, independent of organization_memberships. Never reachable or writable through any customer-facing API -- grants/revokes happen exclusively via backend/scripts/manage-platform-staff.js, run with direct database access.';
COMMENT ON COLUMN platform_staff.user_id IS
  'The DevControl user account (already authenticated via the normal login flow) being granted platform-staff privilege. UNIQUE: a user is either platform staff or not.';
COMMENT ON COLUMN platform_staff.role IS
  'Free text, currently always ''staff''. Not CHECK-constrained -- deliberately left open for a future differentiated role without requiring a migration.';
COMMENT ON COLUMN platform_staff.status IS
  'active | revoked. requirePlatformStaff (backend/src/middleware/platformAuth.middleware.ts) checks this on every request -- revoking takes effect immediately, with no dependency on JWT expiry.';
COMMENT ON COLUMN platform_staff.added_by IS
  'The platform-staff user who granted this row, if known. Nullable and ON DELETE SET NULL: losing the grantor''s own account must never remove the grantee''s row.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609051200 completed successfully!';
  RAISE NOTICE 'platform_staff created (user_id UNIQUE, no organization_id, no RLS) -- table is empty; no grants were made by this migration';
END $$;
