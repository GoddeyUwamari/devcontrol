-- Migration: 202609281200_create_saml_request_ids.sql
-- Description: SAML replay protection (PR #140). Durable, shared store of
--   outstanding SP-initiated AuthnRequest IDs, so that every SAML Response
--   must answer (InResponseTo) a request this service actually issued for
--   that organization, and each request ID can be redeemed exactly once.
--
--   Lifecycle (backend/src/services/saml.service.ts):
--     - GET /api/auth/saml/initiate inserts one row per AuthnRequest, and
--       opportunistically deletes already-expired rows in the same call.
--     - POST /api/auth/saml/callback, only after the response's signature,
--       audience, timestamps, Destination and Recipient have validated,
--       consumes the row atomically:
--         DELETE ... WHERE request_id = $1 AND organization_id = $2
--                      AND expires_at > NOW() RETURNING ...
--       A second (replayed or concurrent) submission of the same response
--       finds no row and is rejected.
--   IdP-initiated SSO (a Response with no InResponseTo) is therefore
--   rejected by design.
--
--   Database-backed rather than in-process so replay protection holds with
--   more than one backend process/instance.
--
--   No RLS, deliberately: rows are opaque protocol nonces, not tenant data,
--   and both writers run on unauthenticated routes with no tenant context
--   set. organization_id binds a request ID to the org it was issued for,
--   so a request ID issued for one org can't be redeemed at another org's
--   callback.
--
--   Fail-closed: if this table does not exist, both /initiate and
--   /callback fail (the insert/consume queries error) -- SSO is
--   unavailable until this migration is applied, never unprotected.
-- Date: 2026-09-28

CREATE TABLE saml_request_ids (
  request_id TEXT PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Expired-row cleanup path.
CREATE INDEX idx_saml_request_ids_expires_at ON saml_request_ids(expires_at);

GRANT SELECT, INSERT, DELETE ON TABLE saml_request_ids TO devcontrol;

COMMENT ON TABLE saml_request_ids IS
  'Outstanding SAML AuthnRequest IDs for replay protection; one row per SP-initiated login, consumed exactly once by the callback (DELETE ... RETURNING). Not tenant data -- no RLS. See backend/src/services/saml.service.ts.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609281200 completed successfully!';
  RAISE NOTICE 'saml_request_ids created (no RLS, by design -- see migration comment)';
END $$;
