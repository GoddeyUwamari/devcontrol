import { Router } from 'express';
import authRoutes from './auth.routes';
import organizationsRoutes from './organizations.routes';
import servicesRoutes from './services.routes';
import dependenciesRoutes from './dependencies.routes';
import deploymentsRoutes from './deployments.routes';
import infrastructureRoutes from './infrastructure.routes';
import teamsRoutes from './teams.routes';
import platformRoutes from './platform.routes';
import awsRoutes from './aws.routes';
import costRecommendationsRoutes from './cost-recommendations.routes';
import doraMetricsRoutes from './dora-metrics.routes';
import alertHistoryRoutes from './alert-history.routes';

const router = Router();

// Authentication routes (public)
router.use('/auth', authRoutes);

// Organization routes (protected)
router.use('/organizations', organizationsRoutes);

// API routes (will need authentication middleware)
router.use('/services', servicesRoutes);
router.use('/dependencies', dependenciesRoutes);
router.use('/deployments', deploymentsRoutes);
router.use('/infrastructure', infrastructureRoutes);
router.use('/teams', teamsRoutes);
router.use('/platform', platformRoutes);
router.use('/aws', awsRoutes);
router.use('/cost-recommendations', costRecommendationsRoutes);
router.use('/metrics/dora', doraMetricsRoutes);
router.use('/alerts', alertHistoryRoutes);

// API root
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'DevControl API - Multi-Tenant Platform Engineering Portal',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth',
      organizations: '/api/organizations',
      services: '/api/services',
      dependencies: '/api/dependencies',
      deployments: '/api/deployments',
      infrastructure: '/api/infrastructure',
      teams: '/api/teams',
      platform: '/api/platform',
      aws: '/api/aws',
      costRecommendations: '/api/cost-recommendations',
      doraMetrics: '/api/metrics/dora',
      alerts: '/api/alerts',
    },
  });
});

export default router;
