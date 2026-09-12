-- Migration: 202609121200_create_slo_definitions.sql
-- Description: Creates slo_definitions, the backing table for the Enterprise-tier
--   "SLO Dashboard & Management" capability (backend/src/services/slo.service.ts,
--   routed at /api/slos in backend/src/routes/slo.routes.ts, consumed by
--   app/(app)/monitoring/slos/page.tsx). This is Enterprise Workstream 3A.
--
--   Prior state (see the 3A read-only audits): the pricing page advertised
--   "SLO Dashboard & Management" but no backend existed at all -- the frontend
--   page rendered either hardcoded demo data (gated by a client-side-only
--   localStorage flag) or an honest empty array for real customers. This
--   migration, together with the accompanying service/route/frontend work,
--   replaces that with a real, narrowly-scoped, evidence-based implementation.
--
--   Scope is deliberately small, per the completed audit's "smallest truthful
--   MVP": only the three resource types with `live_verified` CloudWatch
--   telemetry in cloudwatch.service.ts (EC2 availability, ALB average latency,
--   ALB error rate, Lambda error rate) are representable here. resource_type
--   and sli are both CHECK-constrained closed sets -- deliberately not open
--   strings -- because the whole point of this table is to prevent the UI or
--   API from ever representing an SLO the backend cannot actually evaluate
--   (e.g. RDS, ECS, EKS, DynamoDB, or a p95/p99 latency claim). Widening this
--   set is a deliberate, separate follow-up once those capabilities reach
--   live_verified status, not a migration to relax casually.
--
--   evaluation_window is likewise constrained to '24h'/'7d' -- CloudWatch is
--   the only telemetry source (there is no historical metrics warehouse in
--   this codebase as of this migration), and GetMetricStatistics' own
--   retention/period limits are what actually bound what a 30-day or 90-day
--   claim could ever honestly mean here. Do not widen this set without first
--   building real historical storage.
--
--   target_value's valid range depends on the SLI's unit (percent vs.
--   milliseconds) and is enforced by a CHECK referencing sli directly, mirroring
--   custom_anomaly_rules' condition/severity CHECK convention
--   (202608221112_create_custom_anomaly_rules.sql). Percent-based SLIs are
--   constrained to the open interval (0, 100) -- a target of exactly 100%
--   has a zero-width error budget by definition (allowed_failure_rate = 0),
--   which would require division-by-zero handling for no real-world benefit;
--   see slo-evaluation.ts's computeErrorBudget for where this constraint is
--   assumed.
--
--   organization_id is UUID with a REFERENCES/ON DELETE CASCADE FK and full
--   RLS (isolation + insert policy pair), matching every other org-scoped
--   table's convention -- most directly custom_anomaly_rules' version of the
--   same pair, since this is the same Enterprise-tier CRUD shape.
--
--   resource_id is intentionally NOT a foreign key into aws_resources: a
--   resource can be deleted/re-discovered (a new discovery run can assign a
--   new internal row while the underlying AWS resource_id string stays
--   stable), and an SLO pointing at a resource that has since disappeared
--   from inventory is a legitimate, distinctly-reportable state
--   ("resource_not_found" in slo.service.ts's evaluate()) rather than a
--   constraint violation that would silently prevent the SLO definition
--   itself from existing.
-- Date: 2026-09-12

CREATE TABLE slo_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('ec2', 'load-balancer', 'lambda')),
  resource_id VARCHAR(255) NOT NULL,
  sli VARCHAR(30) NOT NULL CHECK (sli IN ('ec2_availability', 'alb_latency_avg', 'alb_error_rate', 'lambda_error_rate')),
  target_value NUMERIC(7,3) NOT NULL,
  evaluation_window VARCHAR(10) NOT NULL DEFAULT '7d' CHECK (evaluation_window IN ('24h', '7d')),
  enabled BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Defense in depth: the service layer also validates this pairing before
  -- ever reaching the database, but the constraint is what actually
  -- guarantees a row can never exist for a combination cloudwatch.service.ts
  -- has no capability to evaluate.
  CONSTRAINT slo_definitions_sli_matches_resource_type CHECK (
    (sli = 'ec2_availability' AND resource_type = 'ec2') OR
    (sli = 'alb_latency_avg' AND resource_type = 'load-balancer') OR
    (sli = 'alb_error_rate' AND resource_type = 'load-balancer') OR
    (sli = 'lambda_error_rate' AND resource_type = 'lambda')
  ),

  -- Percent-based SLIs (availability, error-rate targets expressed as a
  -- required success rate) must fall in the open interval (0, 100) -- see
  -- migration header. Latency has no natural upper bound; only > 0 is
  -- required.
  CONSTRAINT slo_definitions_target_value_valid CHECK (
    (sli IN ('ec2_availability', 'alb_error_rate', 'lambda_error_rate') AND target_value > 0 AND target_value < 100) OR
    (sli = 'alb_latency_avg' AND target_value > 0)
  )
);

-- evaluate() (real-time, on-demand evaluation triggered by the dashboard/API,
-- not a background sweep) only ever reads enabled SLOs per org; the CRUD list
-- endpoint reads all rows per org regardless of enabled state and is
-- low-volume/admin-facing, so it doesn't need its own index -- same reasoning
-- as custom_anomaly_rules' idx_custom_anomaly_rules_org_enabled.
CREATE INDEX idx_slo_definitions_org_enabled ON slo_definitions(organization_id) WHERE enabled = true;

ALTER TABLE slo_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY slo_definitions_isolation_policy ON slo_definitions
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY slo_definitions_insert_policy ON slo_definitions
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE slo_definitions TO devcontrol;

COMMENT ON TABLE slo_definitions IS
  'Enterprise-tier customer-defined Service Level Objectives (backend/src/services/slo.service.ts). Evaluated on demand against live CloudWatch telemetry via cloudwatch.service.ts -- no historical metrics warehouse exists, so only 24h/7d windows are supported. Enterprise Workstream 3A.';
COMMENT ON COLUMN slo_definitions.resource_id IS
  'The AWS resource''s resource_id as stored in aws_resources -- NOT a foreign key. A resource that has since been deleted/re-discovered still leaves this SLO definition intact; evaluate() reports resource_not_found rather than the row being unable to exist.';
COMMENT ON COLUMN slo_definitions.target_value IS
  'Meaning depends on sli: for ec2_availability/alb_error_rate/lambda_error_rate this is a required success-rate percentage (e.g. 99.9 = 99.9% success); for alb_latency_avg this is a maximum allowed average latency in milliseconds. See slo-evaluation.ts.';
COMMENT ON COLUMN slo_definitions.evaluation_window IS
  'CloudWatch-sourced lookback window, not a stored historical range -- this codebase has no metrics warehouse as of this migration. Widening beyond 24h/7d requires building real historical storage first.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609121200 completed successfully!';
  RAISE NOTICE 'slo_definitions created with organization_id (UUID, FK, NOT NULL), RLS enabled, and both policies';
END $$;
