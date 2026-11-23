import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostForecastService, InsufficientForecastHistoryError } from '../services/cost-forecast.service';
import { ForecastAIService } from '../services/forecast-ai.service';
import { ScenarioPlanningService } from '../services/scenario-planning.service';
import { releaseRequestConnection } from '../middleware/request-lifecycle';
import { isAwsAccountNotConnected } from '../repositories/aws-accounts.repository';
import { AWS_NOT_CONNECTED_CODE, FORECAST_NOT_CONNECTED_MESSAGE } from '../services/aws-connection-messages';

/**
 * Logs a failed forecast without the error object. The response never
 * carries the error's text: AWS errors can name accounts and roles.
 */
function logForecastError(label: string, error: any): void {
  console.error(`[Forecast Controller] ${label}:`, {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });
}

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
      // The authenticated caller's organization; there is no fallback.
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const period = (req.query.period as any) || '90d';

      console.log('[Forecast Controller] Generating forecast...');

      // Generate forecast
      let forecast = await this.forecastService.generateForecast(organizationId, period);

      // The model call needs no database: no pooled connection is held while it runs.
      releaseRequestConnection(res);

      // Enrich with AI analysis
      forecast = await this.aiService.analyzeForecast(forecast);

      res.json({
        success: true,
        forecast,
      });
    } catch (error: any) {
      // No eligible AWS account (PR4a): a state, not a failure, so nothing is
      // logged. By class only: a connected account's failures (AssumeRole
      // refused, a client without credentials) carry the same AWS_NOT_CONNECTED
      // text and keep the 500 below.
      if (isAwsAccountNotConnected(error)) {
        return res.status(409).json({
          success: false,
          code: AWS_NOT_CONNECTED_CODE,
          error: FORECAST_NOT_CONNECTED_MESSAGE,
        });
      }
      if (error instanceof InsufficientForecastHistoryError) {
        // Not a failure: too few days AWS Cost Explorer has finished (a newly
        // connected account). The page shows a "not enough history yet" state.
        return res.status(422).json({
          success: false,
          code: error.code,
          error: 'Not enough finished days of cost history to forecast yet',
          finishedDays: error.finishedDays,
          requiredDays: error.requiredDays,
        });
      }
      logForecastError('Error', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate forecast'
      });
    }
  };

  /**
   * POST /api/forecast/scenario
   * Generate scenario forecast
   */
  generateScenario = async (req: Request, res: Response) => {
    try {
      // The authenticated caller's organization; there is no fallback.
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const { type, params } = req.body;

      if (!type) {
        return res.status(400).json({ success: false, error: 'Scenario type required' });
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
      logForecastError('Scenario error', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate scenario'
      });
    }
  };
}
