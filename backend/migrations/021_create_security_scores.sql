-- Migration 021: Create security_scores table
CREATE TABLE IF NOT EXISTS security_scores (
  id         SERIAL PRIMARY KEY,
  org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
  score      INTEGER,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_scores_org_id ON security_scores(org_id);
CREATE INDEX IF NOT EXISTS idx_security_scores_created_at ON security_scores(created_at DESC);
