import { Router } from 'express';
import { Pool } from 'pg';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePro } from '../middleware/subscription.middleware';
import { ForecastController } from '../controllers/forecast.controller';

export const createForecastRoutes = (pool: Pool): Router => {
  const router = Router();
  const controller = new ForecastController(pool);

  // All routes require authentication — scopes forecast generation to the
  // caller's own organization instead of falling back to the hardcoded default.
  // Forecasting is a Pro feature, checked on the server for every route.
  router.use(authenticateToken);
  router.use(requirePro);

  /**
   * GET /api/forecast
   * Get cost forecast with AI analysis
   */
  router.get('/', controller.getForecast);

  /**
   * POST /api/forecast/scenario
   * Generate scenario planning forecast
   */
  router.post('/scenario', controller.generateScenario);

  return router;
};
