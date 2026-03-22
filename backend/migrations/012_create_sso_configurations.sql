-- Migration 012: Create SSO/SAML configurations table

CREATE TABLE IF NOT EXISTS sso_configurations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_name     VARCHAR(100) NOT NULL DEFAULT 'SAML IdP',
  idp_entity_id     TEXT NOT NULL,
  idp_sso_url       TEXT NOT NULL,
  idp_certificate   TEXT NOT NULL,           -- AES-256-GCM encrypted X.509 cert (base64)
  sp_entity_id      TEXT NOT NULL,           -- e.g. https://devcontrol.app/saml/{orgId}
  attribute_mapping JSONB NOT NULL DEFAULT '{"email":"email","name":"displayName"}',
  allowed_domains   JSONB NOT NULL DEFAULT '[]',  -- array of email domain strings
  is_active         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_sso_configurations_org_id ON sso_configurations(organization_id);
CREATE INDEX IF NOT EXISTS idx_sso_configurations_active  ON sso_configurations(is_active) WHERE is_active = true;
