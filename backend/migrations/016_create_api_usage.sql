CREATE TABLE IF NOT EXISTS api_usage (
  id SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  hour TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, hour)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_org_hour
  ON api_usage(organization_id, hour);
