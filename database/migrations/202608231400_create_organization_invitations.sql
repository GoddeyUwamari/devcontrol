-- Migration: 202608231400_create_organization_invitations.sql
-- Description: Creates organization_invitations, the durable persistence
--   layer for OrganizationService.inviteUser()'s non-existent-user branch
--   (backend/src/services/organization.service.ts). Previously that branch
--   generated an invitation token but never persisted it anywhere -- there
--   was no row for an accept-invitation link to look up, so the flow could
--   never actually be completed for someone who didn't already have an
--   account. This table closes that gap; see acceptInvitation()'s new
--   fallback to acceptPendingInvitation() for the corresponding read side.
--
--   Deliberately separate from organization_memberships (the existing,
--   unchanged mechanism for inviting an *existing* user) rather than
--   relaxing organization_memberships.user_id to nullable:
--     - organization_memberships.user_id is NOT NULL in production today
--       (confirmed via information_schema) and is the FK target for
--       sessions/RLS-adjacent joins elsewhere -- making it nullable would
--       ripple into every existing query against that table.
--     - The two invitation kinds have genuinely different identity: an
--       organization_memberships invitation already IS a membership row
--       for a known user_id, just not yet joined; a pending invitation for
--       an email with no account yet has no user_id to attach to until
--       registration happens, so it needs its own row shape (email instead
--       of user_id) rather than a nullable column bolted onto the existing
--       table.
--
--   No RLS on this table, matching organization_memberships' own existing
--   precedent (also RLS-disabled) -- and for the same underlying reason,
--   not merely by copying it: accept-invitation is, by design, a cross-org
--   lookup (see organizations.routes.ts's comment on why /accept-invitation
--   is deliberately NOT gated by requireOwnOrg -- "this is how a user joins
--   an org they aren't a member of yet"). The session's
--   app.current_organization_id at accept time is the *accepting user's
--   current* org, not this invitation's target org, so a
--   current_organization_id-scoped isolation policy (the pattern used by
--   202608221112_create_custom_anomaly_rules.sql, appropriate there because
--   every query against that table stays within one already-known org)
--   would incorrectly block the exact cross-org lookup this feature exists
--   to perform.
-- Date: 2026-08-23

CREATE TABLE organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  invited_by UUID REFERENCES users(id),

  invitation_token TEXT NOT NULL,
  invitation_expires_at TIMESTAMPTZ NOT NULL,

  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup path for acceptPendingInvitation(): by raw token, must be unique.
CREATE UNIQUE INDEX idx_org_invitations_token ON organization_invitations(invitation_token);

-- Re-inviting the same not-yet-registered address (inviteUser called again
-- before they sign up) should refresh the existing pending row's token/
-- expiry/role via ON CONFLICT, not accumulate stale duplicate invitations.
-- Partial (WHERE accepted_at IS NULL) so a genuinely new invitation can
-- still be issued after an old one for the same address was accepted.
CREATE UNIQUE INDEX idx_org_invitations_org_email_pending
  ON organization_invitations(organization_id, lower(email))
  WHERE accepted_at IS NULL;

GRANT ALL ON TABLE organization_invitations TO devcontrol;

COMMENT ON TABLE organization_invitations IS
  'Durable invitations for organization_memberships.inviteUser() targets who did not have an account at invite time -- see backend/src/services/organization.service.ts. Deliberately separate from organization_memberships (which handles inviting an existing user) and deliberately not RLS-scoped by organization_id, since acceptance is an inherent cross-org lookup by an as-yet-unaffiliated user.';
COMMENT ON COLUMN organization_invitations.accepted_at IS
  'NULL until acceptPendingInvitation() completes the invitation; a partial unique index enforces at most one pending (accepted_at IS NULL) invitation per (organization_id, lower(email)).';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608231400 completed successfully!';
  RAISE NOTICE 'organization_invitations created (no RLS, by design -- see migration comment)';
END $$;
