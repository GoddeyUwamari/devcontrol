import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { corsMiddleware } from './middleware/cors';
import { pool, testConnection } from './config/database';
import { metricsMiddleware } from './middleware/metrics';
import metricsRoutes from './routes/metrics.routes';
import { updateBusinessMetrics } from './metrics';
import { AlertSyncJob } from './jobs/alert-sync.job';
import { ResourceDiscoveryJob } from './jobs/resourceDiscovery.job';
import { WebSocketServer } from './websocket/server';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security middleware
app.use(helmet());

// CORS middleware
app.use(corsMiddleware);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
app.use(requestLogger);

// Metrics middleware
app.use(metricsMiddleware);

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

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();

    // Create HTTP server (required for WebSocket)
    const httpServer = createServer(app);

    // Initialize WebSocket server
    const wsServer = new WebSocketServer(httpServer);

    // Make wsServer available to all routes
    app.set('wsServer', wsServer);

    httpServer.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log(`🚀 Platform Portal API Server`);
      console.log('='.repeat(50));
      console.log(`Environment: ${NODE_ENV}`);
      console.log(`Port: ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`API root: http://localhost:${PORT}/api`);
      console.log(`Metrics: http://localhost:${PORT}/metrics`);
      console.log(`🔌 WebSocket server ready at ws://localhost:${PORT}`);
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
