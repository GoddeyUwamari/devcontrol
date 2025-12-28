import { Router } from 'express';
import { pool } from '../config/database';
import { DORAMetricsRepository } from '../repositories/dora-metrics.repository';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { DORAMetricsController } from '../controllers/dora-metrics.controller';

const router = Router();

// Initialize repository, service, and controller
const repository = new DORAMetricsRepository(pool);
const service = new DORAMetricsService(repository);
const controller = new DORAMetricsController(service);

/**
 * GET /api/metrics/dora
 * Get comprehensive DORA metrics
 *
 * Query parameters:
 * - date_range: 7d | 30d | 90d (default: 30d)
 * - service_id: Filter by service UUID
 * - team_id: Filter by team UUID
 * - environment: Filter by environment (production, staging, development)
 */
router.get('/', (req, res) => controller.getDORAMetrics(req, res));

export default router;
