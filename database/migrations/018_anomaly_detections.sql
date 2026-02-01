-- Anomaly detections table for AI-powered anomaly detection
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Anomaly classification
  type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,

  -- Resource identification (optional - can be org-wide)
  resource_id VARCHAR(255),
  resource_type VARCHAR(50),
  resource_name VARCHAR(255),
  region VARCHAR(50),

  -- Metric details
  metric VARCHAR(100) NOT NULL,
  current_value DECIMAL(15, 2) NOT NULL,
  expected_value DECIMAL(15, 2) NOT NULL,
  deviation DECIMAL(10, 2) NOT NULL,
  historical_average DECIMAL(15, 2),
  historical_std_dev DECIMAL(15, 2),

  -- Detection metadata
  detected_at TIMESTAMP NOT NULL,
  time_window VARCHAR(20) NOT NULL,

  -- AI-generated insights
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  ai_explanation TEXT,
  impact TEXT,
  recommendation TEXT,
  confidence INTEGER NOT NULL,

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  acknowledged_at TIMESTAMP,
  acknowledged_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  notes TEXT,

  -- Related data
  related_events JSONB,
  affected_resources TEXT[],

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_anomaly_org ON anomaly_detections(organization_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_status ON anomaly_detections(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_severity ON anomaly_detections(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_detected ON anomaly_detections(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_detections(type);
CREATE INDEX IF NOT EXISTS idx_anomaly_resource ON anomaly_detections(resource_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_org_status_detected ON anomaly_detections(organization_id, status, detected_at DESC);

-- Comments
COMMENT ON TABLE anomaly_detections IS 'AI-powered anomaly detections for AWS infrastructure monitoring';
COMMENT ON COLUMN anomaly_detections.deviation IS 'Percentage or z-score deviation from expected value';
COMMENT ON COLUMN anomaly_detections.confidence IS 'AI confidence score (0-100)';
COMMENT ON COLUMN anomaly_detections.ai_explanation IS 'AI-generated explanation of why this anomaly occurred';
COMMENT ON COLUMN anomaly_detections.impact IS 'AI-generated business/technical impact assessment';
COMMENT ON COLUMN anomaly_detections.recommendation IS 'AI-generated recommended actions';
