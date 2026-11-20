import { Router } from 'express';
import { pool } from '../config/database';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEntitlement } from '../middleware/subscription.middleware';
import { DORAMetricsRepository } from '../repositories/dora-metrics.repository';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { DORAMetricsController } from '../controllers/dora-metrics.controller';

const router = Router();

// Initialize repository, service, and controller
// Pass pool to service so it can resolve custom benchmarks from DB
const repository = new DORAMetricsRepository(pool);
const service = new DORAMetricsService(repository, pool);
const controller = new DORAMetricsController(service);

router.use(authenticateToken);
// Plan before anything is computed (PLAN_ENTITLEMENTS.doraMetrics).
router.use(requireEntitlement('doraMetrics'));

/**
 * GET /api/metrics/dora
 * DORA metrics for the authenticated organization. The organization always
 * comes from the authenticated request; a query-string organization is ignored.
 *
 * Query parameters (anything invalid is a 400 with a plain message):
 * - date_range: 7d | 30d | 90d (default: 30d). N below.
 * - service_id: a service UUID (absent = all services)
 * - team_id: a team UUID (absent = all teams)
 * - environment: all | development | staging | production (absent or all = all environments)
 *
 * Windows, from ONE captured `now` per request, half-open:
 *   current  [now − N×24h, now)      previous [now − 2N×24h, now − N×24h)
 * "Finished" = status success + failed; 'deploying' and unknown statuses never count.
 *
 * Response `data` (nullable fields say when; 0 never means "unavailable"):
 * - deploymentFrequency { tracked, value, unit, benchmark, isCustomBenchmark, breakdown, description }
 *     value = successful ÷ N (2 dp); null when nothing finished. benchmark null iff value null.
 * - changeFailureRate { ...same } value = failed ÷ finished × 100 (2 dp); null when nothing finished.
 * - leadTime, mttr: { tracked: false, reason }.
 * - deployments { successful, failed, finished } (current period).
 * - period { start, end, days, startAt, endAt }: start/end = first/last UTC date
 *     the window touches; startAt inclusive, endAt exclusive (= now), ISO 8601.
 * - previousPeriod { start, end, days, startAt, endAt, deployments,
 *     deploymentsPerDay (null when previous finished = 0),
 *     changeFailureRate (null when previous finished = 0) }.
 * - change { finishedPercent, deploymentsPerDayPercent, changeFailureRatePercent }:
 *     relative % (1 dp); each null unless both periods have finished
 *     deployments and the previous value is > 0.
 * - daily [{ date, succeeded, failed, total, partial }]: every UTC day
 *     (00:00–24:00 UTC) the current window touches, ascending, zero-filled:
 *     N+1 days with the first and last partial (N whole days when now is
 *     exactly 00:00:00.000Z). Σ total = deployments.finished.
 * - busiestDay { date, total, succeeded, failed, partial, tiedDays } | null:
 *     max daily total; ties -> most recent tied day; null when nothing finished.
 * - filters { environment, serviceId, teamId }: what was applied; null = all.
 * - bands: the standard comparison bands (config/dora-bands.ts), with their
 *     levels, numeric bounds, labels and description.
 */
router.get('/', (req, res) => controller.getDORAMetrics(req, res));

export default router;
