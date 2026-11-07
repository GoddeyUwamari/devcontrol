/**
 * Sources DevControl does not have, registered so that every context says so
 * from a provider state ('not_built'), never from a hard-coded sentence, and
 * never as "none found".
 *
 *   anomalies.cost  (S20, A-D11): anomaly detection produces nothing while
 *                   ANOMALY_DETECTION_ACTIVE is false, so it is not_built --
 *                   'available, none found' would claim detection ran.
 *   alerts.history  (S21, A-D10): alert_history (the Prometheus sync) stores
 *                   no organization, so it can never be read for one.
 *                   CloudWatch alarms (ops.cloudwatch_alarms) are the alerts
 *                   source; this provider is only the history of past alerts.
 */
import { collectSection, notBuilt } from '../../../ai-context-contract';
import { ANOMALY_DETECTION_ACTIVE } from '../../../anomaly-detection.service';
import { defineProvider } from './shared';

/** Model-facing and repeated to customers: names no internal mechanism. */
export const ANOMALIES_NOT_BUILT_REASON = 'DevControl does not detect cost anomalies yet';
export const ALERT_HISTORY_NOT_BUILT_REASON =
  'DevControl does not keep a history of past alerts for your organization yet; CloudWatch alarms show the current alarm state';

export const anomaliesProvider = defineProvider<never>({
  id: 'anomalies.cost',
  version: 1,
  title: 'Cost anomalies',
  source: 'DevControl anomaly detection',
  dataSourceIds: ['S20'],
  topics: ['cost', 'ops'],
  priority: 3,
  maxTokens: 200,
  async collect() {
    if (!ANOMALY_DETECTION_ACTIVE) return notBuilt<never>({ source: 'DevControl anomaly detection' }, ANOMALIES_NOT_BUILT_REASON);
    // Detection on but not read into evidence yet: missing, never "none".
    return collectSection<never>({ source: 'DevControl anomaly detection' }, async () => ({
      state: 'unavailable',
      reason: 'anomaly results are not part of this evidence yet',
    }));
  },
});

export const alertHistoryProvider = defineProvider<never>({
  id: 'alerts.history',
  version: 1,
  title: 'Alert history (past alerts)',
  source: 'DevControl alert history',
  dataSourceIds: ['S21'],
  topics: ['ops'],
  priority: 3,
  maxTokens: 200,
  async collect() {
    return notBuilt<never>({ source: 'DevControl alert history' }, ALERT_HISTORY_NOT_BUILT_REASON);
  },
});
