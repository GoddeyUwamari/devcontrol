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

// Start log stream for deployment
router.post('/logs/stream/:deploymentId', authenticate, async (req: RequestWithWS, res: Response) => {
  try {
    const { deploymentId } = req.params;
    const { logGroupName, logStreamName } = req.body;
    const organizationId = (req as any).organizationId;

    if (!logGroupName || !logStreamName) {
      return res.status(400).json({
        success: false,
        error: 'logGroupName and logStreamName are required',
      });
    }

    // deploymentId is otherwise just a client-supplied label with no DB
    // lookup, and logGroupName/logStreamName are trusted as-is — without
    // this, any authenticated user could stream any CloudWatch log
    // group/stream (including another org's) to themselves by guessing
    // names, since CloudWatch access here uses platform-level credentials,
    // not per-org scoping.
    const deployment = await deploymentsRepository.findById(deploymentId, organizationId);
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: 'Deployment not found',
      });
    }

    const wsServer: WebSocketServer = req.app.get('wsServer');
    const logService = new LogStreamingService(wsServer);

    await logService.startLogStream(
      deploymentId,
      organizationId,
      logGroupName,
      logStreamName
    );

    res.json({
      success: true,
      message: 'Log streaming started',
      deploymentId,
    });
  } catch (error: any) {
    console.error('Error starting log stream:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
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
