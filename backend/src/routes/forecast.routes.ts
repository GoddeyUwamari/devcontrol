import { Router } from 'express';
import { Pool } from 'pg';
import { ForecastController } from '../controllers/forecast.controller';

export const createForecastRoutes = (pool: Pool): Router => {
  const router = Router();
  const controller = new ForecastController(pool);

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
