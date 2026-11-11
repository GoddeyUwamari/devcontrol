/**
 * Features that are listed (pricing, navigation) but not built yet. While a
 * flag is false the page shows "Coming soon", makes no request for the
 * feature, and offers no action that would fail. Nothing is deleted: the
 * existing code stays behind the flag and returns when it is turned on.
 */

/**
 * Anomaly detection on measured AWS data. False while the backend detector
 * returns nothing (backend AnomalyDetectionService) and custom rules are
 * stored but never evaluated.
 */
export const ANOMALY_DETECTION_ACTIVE = false

/**
 * Developer API keys. False until the `api_keys` table exists in production;
 * until then /api/keys answers 501 FEATURE_NOT_AVAILABLE
 * (backend/src/middleware/require-feature-table.ts).
 */
export const API_KEYS_AVAILABLE = false

/**
 * Outbound webhooks. False until the `webhook_endpoints` table exists in
 * production and a sender delivers events; until then /api/webhooks answers
 * 501 FEATURE_NOT_AVAILABLE.
 */
export const WEBHOOKS_AVAILABLE = false

export const COMING_SOON = 'Coming soon'
