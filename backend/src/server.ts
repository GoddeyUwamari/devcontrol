import express from 'express';
import { createServer } from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { corsMiddleware } from './middleware/cors';
import { pool, testConnection } from './config/database';
import { metricsMiddleware } from './middleware/metrics';
import { auditLogger } from './middleware/auditLogger';
import { standardRateLimiter } from './middleware/rateLimiter';
import { sanitizerMiddleware } from './middleware/sanitizer';
import metricsRoutes from './routes/metrics.routes';
import { updateBusinessMetrics } from './metrics';
import { AlertSyncJob } from './jobs/alert-sync.job';
import { ResourceDiscoveryJob } from './jobs/resourceDiscovery.job';
import { RiskScoreSnapshotJob } from './jobs/risk-score-snapshot.job';
import { ScheduledReportsJob } from './jobs/scheduled-reports.job';
import { WeeklyAISummaryJob } from './jobs/weekly-ai-summary.job';
import { AnomalyDetectionJob } from './jobs/anomaly-detection.job';
import { WebSocketServer } from './websocket/server';
import { validateEnv } from './config/validateEnv';
import { createForecastRoutes } from './routes/forecast.routes';

dotenv.config();

// Validate environment variables before starting
validateEnv();

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security middleware - Helmet with comprehensive configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "https://api.stripe.com",
        "ws://localhost:*",
        "wss://localhost:*",
        process.env.FRONTEND_URL || "http://localhost:3010"
      ],
      frameSrc: ["'self'", "https://js.stripe.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny', // Prevent clickjacking
  },
  noSniff: true, // Prevent MIME type sniffing
  xssFilter: true, // Enable XSS filter
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
}));

// CORS middleware
app.use(corsMiddleware);

// ✅ Stripe webhook endpoint needs RAW body (not parsed JSON)
app.use(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' })
);

// Body parsing middleware - skip webhook route to preserve raw body
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') {
    return next();
  }
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') {
    return next();
  }
  express.urlencoded({ extended: true })(req, res, next);
});

// Input sanitization (after body parser, prevents XSS) - skip webhook route
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') {
    return next();
  }
  sanitizerMiddleware(req, res, next);
});

// Logging middleware
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
app.use(requestLogger);

// Metrics middleware
app.use(metricsMiddleware);

// Audit logger middleware (after auth, before routes)
app.use(auditLogger);

// Rate limiting middleware (protects all API routes)
app.use('/api', standardRateLimiter);

// Metrics endpoint
app.use(metricsRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      environment: NODE_ENV,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      environment: NODE_ENV,
    });
  }
});

// API routes
app.use('/api', routes);

// Anomaly detection routes (needs to be registered before 404 handler)
// Note: Job is started in startServer(), but routes work independently
import { AnomalyRepository } from './repositories/anomaly.repository';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { AnomalyAIService } from './services/anomaly-ai.service';
import { Router } from 'express';
import { authenticateToken } from './middleware/auth.middleware';

const anomalyRouter = Router();
const anomalyRepository = new AnomalyRepository(pool);
const anomalyDetectionService = new AnomalyDetectionService(pool);
const anomalyAIService = new AnomalyAIService();

// Make authentication optional for testing
// TODO: Re-enable in production
// anomalyRouter.use(authenticateToken);

// Set default org for demo when not authenticated
anomalyRouter.use((req, res, next) => {
  if (!req.headers.authorization && !(req as any).user) {
    (req as any).user = { organizationId: 'a8ea4c8f-5f93-4073-b627-160c61aa064f' };
  }
  next();
});

anomalyRouter.get('/', async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    const { status } = req.query;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

    const anomalies = status === 'all'
      ? await anomalyRepository.getAllAnomalies(organizationId)
      : await anomalyRepository.getActiveAnomalies(organizationId);
    const stats = await anomalyRepository.getStats(organizationId);

    res.json({ success: true, anomalies, stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

anomalyRouter.post('/scan', async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

    let anomalies = await anomalyDetectionService.scanForAnomalies(organizationId);
    if (anomalies.length > 0) {
      anomalies = await anomalyAIService.explainAnomalies(anomalies);
      await anomalyRepository.saveAnomalies(anomalies);
    }

    res.json({
      success: true,
      anomalies,
      count: anomalies.length,
      message: anomalies.length > 0
        ? `Found ${anomalies.length} anomalies`
        : 'No anomalies detected - infrastructure is healthy',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

anomalyRouter.get('/stats', async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
    const stats = await anomalyRepository.getStats(organizationId);
    res.json({ success: true, stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

anomalyRouter.patch('/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await anomalyRepository.acknowledge(id, userId);
    res.json({ success: true, message: 'Anomaly acknowledged' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

anomalyRouter.patch('/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    await anomalyRepository.resolve(id, notes);
    res.json({ success: true, message: 'Anomaly resolved' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

anomalyRouter.patch('/:id/false-positive', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    await anomalyRepository.markFalsePositive(id, notes);
    res.json({ success: true, message: 'Anomaly marked as false positive' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.use('/api/anomalies', anomalyRouter);
console.log('[Anomaly Detection] Routes registered');

// Forecast routes
app.use('/api/forecast', createForecastRoutes(pool));
console.log('[Forecast] Routes registered');

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();

    // Check for SSL certificates
    const certPath = path.join(__dirname, '../certs/cert.pem');
    const keyPath = path.join(__dirname, '../certs/key.pem');
    const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);
    const useHTTPS = hasCerts || NODE_ENV === 'production';

    let httpServer;
    let protocol = 'http';
    let wsProtocol = 'ws';

    if (useHTTPS && hasCerts) {
      // Create HTTPS server
      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      httpServer = https.createServer(options, app);
      protocol = 'https';
      wsProtocol = 'wss';
      console.log('🔒 HTTPS enabled with SSL certificates');
    } else {
      // Create HTTP server
      httpServer = createServer(app);
      if (NODE_ENV === 'production') {
        console.warn('⚠️  WARNING: Running HTTP in production! SSL certificates not found.');
        console.warn('   Expected certificates at:');
        console.warn(`   - ${certPath}`);
        console.warn(`   - ${keyPath}`);
      } else {
        console.log('⚠️  Running HTTP (development mode)');
        console.log('   Run ./scripts/generate-ssl-cert.sh to enable HTTPS');
      }
    }

    // Initialize WebSocket server
    const wsServer = new WebSocketServer(httpServer);

    // Make wsServer available to all routes
    app.set('wsServer', wsServer);

    httpServer.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log(`🚀 Platform Portal API Server`);
      console.log('='.repeat(50));
      console.log(`Environment: ${NODE_ENV}`);
      console.log(`Protocol: ${protocol.toUpperCase()}`);
      console.log(`Port: ${PORT}`);
      console.log(`Health check: ${protocol}://localhost:${PORT}/health`);
      console.log(`API root: ${protocol}://localhost:${PORT}/api`);
      console.log(`Metrics: ${protocol}://localhost:${PORT}/metrics`);
      console.log(`🔌 WebSocket server ready at ${wsProtocol}://localhost:${PORT}`);
      console.log('='.repeat(50));
      console.log('Available endpoints:');
      console.log(`  - GET    /api/services`);
      console.log(`  - POST   /api/services`);
      console.log(`  - GET    /api/deployments`);
      console.log(`  - POST   /api/deployments`);
      console.log(`  - GET    /api/infrastructure`);
      console.log(`  - GET    /api/infrastructure/costs`);
      console.log(`  - GET    /api/teams`);
      console.log(`  - GET    /api/platform/stats/dashboard`);
      console.log('='.repeat(50));
    });

    // Update business metrics every 30s
    setInterval(async () => {
      await updateBusinessMetrics(pool, wsServer);
    }, 30000);

    // Initial metrics update
    await updateBusinessMetrics(pool, wsServer);

    // Start alert sync job (syncs alerts from Prometheus every minute)
    const alertSyncJob = new AlertSyncJob(pool);
    alertSyncJob.start();

    // Start resource discovery job (discovers AWS resources every 6 hours)
    const resourceDiscoveryJob = new ResourceDiscoveryJob(pool);
    resourceDiscoveryJob.start();

    // Start risk score snapshot job (captures daily risk snapshots at 2 AM UTC)
    const riskSnapshotJob = new RiskScoreSnapshotJob(pool);
    riskSnapshotJob.start();

    // Start scheduled reports job (checks for due reports every 15 minutes)
    const scheduledReportsJob = new ScheduledReportsJob(pool);
    scheduledReportsJob.start();

    // Start weekly AI summary job (runs every Monday at 9 AM)
    const weeklyAISummaryJob = new WeeklyAISummaryJob(pool);
    weeklyAISummaryJob.start();

    // Start anomaly detection job (runs every 5 minutes)
    const anomalyDetectionJob = new AnomalyDetectionJob(pool);
    anomalyDetectionJob.start();
    console.log('[Anomaly Detection] Job started');
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('\n📛 Shutting down gracefully...');
  try {
    await pool.end();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
startServer();
