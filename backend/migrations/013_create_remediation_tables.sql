-- Migration 013: Auto-Remediation Workflows

CREATE TABLE IF NOT EXISTS remediation_workflows (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_id     UUID,
  resource_id           VARCHAR(255) NOT NULL,
  resource_type         VARCHAR(50)  NOT NULL,
  action_type           VARCHAR(50)  NOT NULL CHECK (action_type IN (
                          'stop_instance',
                          'rightsize_instance',
                          'delete_snapshot',
                          'delete_unattached_volume',
                          'enable_s3_lifecycle',
                          'downgrade_rds_instance',
                          'delete_unused_elasticip'
                        )),
  action_params         JSONB        NOT NULL DEFAULT '{}',
  estimated_savings     NUMERIC(10,2) NOT NULL DEFAULT 0,
  risk_level            VARCHAR(10)  NOT NULL CHECK (risk_level IN ('low','medium','high')),
  status                VARCHAR(20)  NOT NULL DEFAULT 'pending_approval'
                          CHECK (status IN (
                            'pending_approval','approved','rejected',
                            'executing','completed','failed','rolled_back'
                          )),
  approved_by           UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  rejected_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  executed_by           UUID REFERENCES users(id),
  executed_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  execution_log         TEXT,
  rollback_available    BOOLEAN NOT NULL DEFAULT false,
  rollback_snapshot_id  VARCHAR(255),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remediation_workflows_org_id ON remediation_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_status  ON remediation_workflows(status);
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_rec_id  ON remediation_workflows(recommendation_id) WHERE recommendation_id IS NOT NULL;

-- Audit log — records every status transition
CREATE TABLE IF NOT EXISTS remediation_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  UUID NOT NULL REFERENCES remediation_workflows(id) ON DELETE CASCADE,
  old_status   VARCHAR(20),
  new_status   VARCHAR(20) NOT NULL,
  changed_by   UUID REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   VARCHAR(45),
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_remediation_audit_workflow_id ON remediation_audit_log(workflow_id);
