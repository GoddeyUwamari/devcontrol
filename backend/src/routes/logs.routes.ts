import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { LogStreamingService } from '../services/logStreaming';
import { WebSocketServer } from '../websocket/server';
import { DeploymentsRepository } from '../repositories/deployments.repository';

const router = Router();
const deploymentsRepository = new DeploymentsRepository();

// Extend Request type to include WebSocket server
interface RequestWithWS extends Request {
  app: any;
}

// Start log stream for deployment.
// Temporarily disabled: live log streaming is unavailable until it is
// reimplemented. The request body is intentionally not read.
router.post('/logs/stream/:deploymentId', authenticate, (_req: RequestWithWS, res: Response) => {
  res.status(503).json({
    success: false,
    error: 'Live log streaming is temporarily unavailable',
  });
});

// Stop log stream
router.post('/logs/stop/:deploymentId', authenticate, async (req: RequestWithWS, res: Response) => {
  try {
    const { deploymentId } = req.params;
    const organizationId = (req as any).organizationId;

    const deployment = await deploymentsRepository.findById(deploymentId, organizationId);
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: 'Deployment not found',
      });
    }

    const wsServer: WebSocketServer = req.app.get('wsServer');
    const logService = new LogStreamingService(wsServer);

    logService.stopLogStream(deploymentId);

    res.json({
      success: true,
      message: 'Log streaming stopped',
      deploymentId,
    });
  } catch (error: any) {
    console.error('Error stopping log stream:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get active streams count
router.get('/logs/streams/active', authenticate, async (req: RequestWithWS, res: Response) => {
  try {
    const wsServer: WebSocketServer = req.app.get('wsServer');
    const logService = new LogStreamingService(wsServer);

    const activeCount = logService.getActiveStreamCount();

    res.json({
      success: true,
      activeStreams: activeCount,
    });
  } catch (error: any) {
    console.error('Error getting active streams:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
