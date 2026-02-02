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
import alertConfigRoutes from './alert-config.routes';
import awsResourcesRoutes from './awsResources.routes';
import logsRoutes from './logs.routes';
import auditLogsRoutes from './auditLogs.routes';
import stripeRoutes from './stripe.routes';
import onboardingRoutes from './onboarding.routes';
import prometheusRoutes from './prometheus.routes';
import riskScoreRoutes from './risk-score.routes';
import scheduledReportsRoutes from './scheduled-reports.routes';
import complianceFrameworksRoutes from './compliance-frameworks.routes';
import aiInsightsRoutes from './ai-insights.routes';
import aiChatRoutes from './ai-chat.routes';
import nlQueryRoutes from './nl-query.routes';
import aiReportsRoutes from './ai-reports.routes';
import optimizationRoutes from './optimization.routes';
import userPreferencesRoutes from './user-preferences.routes';

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
router.use('/aws-resources', awsResourcesRoutes);
router.use('/cost-recommendations', costRecommendationsRoutes);
router.use('/metrics/dora', doraMetricsRoutes);
router.use('/alerts', alertHistoryRoutes);
router.use('/alert-config', alertConfigRoutes);
router.use('/audit-logs', auditLogsRoutes);
router.use('/stripe', stripeRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/prometheus', prometheusRoutes);
router.use('/risk-score', riskScoreRoutes);
router.use('/scheduled-reports', scheduledReportsRoutes);
router.use('/compliance-frameworks', complianceFrameworksRoutes);
router.use('/ai-insights', aiInsightsRoutes);
router.use('/ai-chat', aiChatRoutes);
router.use('/nl-query', nlQueryRoutes);
router.use('/ai-reports', aiReportsRoutes);
router.use('/optimizations', optimizationRoutes);
router.use('/user/preferences', userPreferencesRoutes);
router.use('/', logsRoutes);

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
      awsResources: '/api/aws-resources',
      costRecommendations: '/api/cost-recommendations',
      doraMetrics: '/api/metrics/dora',
      alerts: '/api/alerts',
      alertConfig: '/api/alert-config',
      auditLogs: '/api/audit-logs',
      stripe: '/api/stripe',
      onboarding: '/api/onboarding',
      prometheus: '/api/prometheus',
      riskScore: '/api/risk-score',
      scheduledReports: '/api/scheduled-reports',
      complianceFrameworks: '/api/compliance-frameworks',
      aiInsights: '/api/ai-insights',
      aiChat: '/api/ai-chat',
      nlQuery: '/api/nl-query',
      aiReports: '/api/ai-reports',
      optimizations: '/api/optimizations',
      userPreferences: '/api/user/preferences',
      logs: '/api/logs',
    },
  });
});

export default router;
