-- Migration: Add unique constraint to prevent duplicate active anomalies
-- Prevents duplicate active anomalies at database level

-- Step 1: Delete existing duplicates (keep oldest for each group)
-- This keeps the first detected anomaly and removes later duplicates
DELETE FROM anomaly_detections a
USING anomaly_detections b
WHERE a.id > b.id
  AND a.organization_id = b.organization_id
  AND a.type = b.type
  AND COALESCE(a.resource_id, '') = COALESCE(b.resource_id, '')
  AND a.metric = b.metric
  AND a.status = 'active'
  AND b.status = 'active';

-- Step 2: Add partial unique index
-- This constraint ensures only ONE active anomaly per (org, type, resource, metric)
-- When anomaly is resolved/acknowledged, constraint no longer applies
-- So historical data is preserved and can have duplicates
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_anomaly
ON anomaly_detections (organization_id, type, COALESCE(resource_id, ''), metric)
WHERE status = 'active';

-- Step 3: Add comment explaining the constraint
COMMENT ON INDEX unique_active_anomaly IS
  'Ensures only one active anomaly per organization/type/resource/metric combination. Resolved and acknowledged anomalies are not subject to this constraint.';
