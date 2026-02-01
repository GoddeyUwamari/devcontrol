import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostForecastService } from '../services/cost-forecast.service';
import { ForecastAIService } from '../services/forecast-ai.service';
import { ScenarioPlanningService } from '../services/scenario-planning.service';

export class ForecastController {
  private forecastService: CostForecastService;
  private aiService: ForecastAIService;
  private scenarioService: ScenarioPlanningService;

  constructor(pool: Pool) {
    this.forecastService = new CostForecastService(pool);
    this.aiService = new ForecastAIService();
    this.scenarioService = new ScenarioPlanningService(pool);
  }

  /**
   * GET /api/forecast
   * Get cost forecast
   */
  getForecast = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId || 'a8ea4c8f-5f93-4073-b627-160c61aa064f';
      const period = (req.query.period as any) || '90d';

      console.log('[Forecast Controller] Generating forecast...');

      // Generate forecast
      let forecast = await this.forecastService.generateForecast(organizationId, period);

      // Enrich with AI analysis
      forecast = await this.aiService.analyzeForecast(forecast);

      res.json({
        success: true,
        forecast,
      });
    } catch (error: any) {
      console.error('[Forecast Controller] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  };

  /**
   * POST /api/forecast/scenario
   * Generate scenario forecast
   */
  generateScenario = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId || 'a8ea4c8f-5f93-4073-b627-160c61aa064f';
      const { type, params } = req.body;

      if (!type) {
        return res.status(400).json({ error: 'Scenario type required' });
      }

      const scenario = await this.scenarioService.generateScenario(
        organizationId,
        type,
        params || {}
      );

      res.json({
        success: true,
        scenario,
      });
    } catch (error: any) {
      console.error('[Forecast Controller] Scenario error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  };
}
