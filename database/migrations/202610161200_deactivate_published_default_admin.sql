-- Migration: 202610161200_deactivate_published_default_admin.sql
-- Description: Deactivate the default admin that
--   database/migrations-admin/005_migrate_existing_data.sql creates, on every
--   database where it is still exactly as 005 left it.
--
--   005 inserts a user with the fixed id 00000000-0000-0000-0000-000000000002,
--   an owner membership of the default organization, and a password hash whose
--   password is published in that file. 005 is never edited (it is part of the
--   migration ledger); this migration makes every database built from it safe.
--
--   Acts ONLY when all three hold for the user row:
--     - id = 00000000-0000-0000-0000-000000000002;
--     - is_active is true;
--     - the stored password_hash is byte-for-byte the one 005 publishes,
--       compared by its SHA-256 digest so this file never contains the hash.
--   When they hold, in this order: the user's active memberships are
--   deactivated, its active sessions are revoked (as auth.service.ts revokes
--   them), and the user is deactivated. When they do not hold -- the user was
--   already deactivated, its password was changed, or it does not exist --
--   nothing is changed, including memberships and sessions.
--
--   Idempotent: a second run finds no active user and changes nothing.
--   Production: the user was already deactivated by hand, so this changes 0
--   rows there. CI and fresh local databases (005 sorts before this file in
--   .github/scripts/ci-bootstrap-schema.js's merged sweep): deactivates the
--   user, its membership and any sessions.
--
--   Ordinary migration: UPDATEs only, which devcontrol is already granted on
--   all three tables. No DDL.

DO $$
DECLARE
  default_admin_id CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  -- SHA-256 (hex) of the password_hash literal in 005_migrate_existing_data.sql.
  published_hash_sha256 CONSTANT TEXT := 'fa28829f65ec169a80ecb9c09ae497c669d0bbb32c8df85af6f66d0caf50d1f6';
  target_id UUID;
BEGIN
  IF to_regclass('users') IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO target_id
    FROM users
   WHERE id = default_admin_id
     AND is_active
     AND encode(sha256(convert_to(password_hash, 'UTF8')), 'hex') = published_hash_sha256
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF to_regclass('organization_memberships') IS NOT NULL THEN
    UPDATE organization_memberships
       SET is_active = false, updated_at = NOW()
     WHERE user_id = target_id AND is_active;
  END IF;

  IF to_regclass('sessions') IS NOT NULL THEN
    UPDATE sessions
       SET is_active = false, revoked_at = NOW()
     WHERE user_id = target_id AND is_active;
  END IF;

  UPDATE users
     SET is_active = false, updated_at = NOW()
   WHERE id = target_id;
END $$;
