-- Migration: 202610051240_teams_name_unique_per_organization.sql
-- Description: Scopes team-name uniqueness to the organization. A team name
--   was unique across every organization (teams_name_key UNIQUE (name), from
--   001_create_platform_tables.sql's inline UNIQUE), so one organization
--   creating a team blocked every other organization from using that name.
--   After this migration a name is unique within its organization only:
--   teams_organization_id_name_key UNIQUE (organization_id, name).
-- Date: 2026-10-05
--
-- ADMINISTRATIVE MIGRATION -- see database/migrations-admin/README.md.
--
-- PLACEMENT NOTE: classified into database/migrations-admin/ from the start,
-- not after a failed ordinary-path attempt. teams is confirmed postgres-owned
-- in production (it is one of the tables covered by the batch ownership audit
-- documented in database/migrations-admin/README.md, and was re-confirmed by
-- this change's own read-only preflight), so ALTER TABLE against it is known
-- in advance to fail under devcontrol's ordinary-path grants with 42501: must
-- be owner of table teams.
--
-- The new constraint is added before the old one is removed, so there is no
-- point at which team names are unconstrained. Both statements run inside the
-- runner's single per-migration transaction: if either fails, neither takes
-- effect. Neither statement is guarded with IF EXISTS / IF NOT EXISTS -- a
-- database whose teams constraints are not what this migration assumes should
-- fail loudly and roll back rather than be recorded as applied.
--
-- Depends on teams.organization_id being NOT NULL (005_migrate_existing_data.sql).
-- A UNIQUE constraint treats NULLs as distinct, so a nullable organization_id
-- would let rows with no organization share a name.
--
-- Unchanged: every teams column, organization_id's nullability and foreign
-- key, RLS and its policies, and the non-unique indexes idx_teams_name,
-- idx_teams_owner and idx_teams_org. Comparison stays exact: names differing
-- only in case or surrounding whitespace remain distinct.
--
-- Reverse:
--   ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name);
--   ALTER TABLE teams DROP CONSTRAINT teams_organization_id_name_key;
-- The reverse cannot succeed once two organizations hold teams with the same
-- name: UNIQUE (name) cannot be recreated while such rows exist.

ALTER TABLE teams
  ADD CONSTRAINT teams_organization_id_name_key UNIQUE (organization_id, name);

ALTER TABLE teams
  DROP CONSTRAINT teams_name_key;

DO $$
BEGIN
  RAISE NOTICE 'Migration 202610051240 completed successfully!';
  RAISE NOTICE 'teams: name is now unique per organization (teams_organization_id_name_key), teams_name_key removed';
END $$;
