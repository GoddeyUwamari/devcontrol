import { WebSocketServer } from '../websocket/server';

/**
 * Bookkeeping for deployment log streams. Starting a stream is unavailable
 * (see logs.routes.ts): the previous implementation read CloudWatch Logs on
 * the server's ambient credentials rather than the organization's own, and
 * has been removed. This class builds no AWS client.
 */
export class LogStreamingService {
  private wsServer: WebSocketServer;
  private activeStreams: Map<string, NodeJS.Timeout> = new Map();

  constructor(wsServer: WebSocketServer) {
    this.wsServer = wsServer;
  }

  // Stop log stream for a specific deployment
  stopLogStream(deploymentId: string) {
    const interval = this.activeStreams.get(deploymentId);
    if (interval) {
      clearInterval(interval);
      this.activeStreams.delete(deploymentId);
      console.log(`📝 Stopped log stream for deployment ${deploymentId}`);
    }
  }

  // Stop all active log streams
  stopAllStreams() {
    this.activeStreams.forEach((interval, deploymentId) => {
      clearInterval(interval);
      console.log(`📝 Stopped log stream for deployment ${deploymentId}`);
    });
    this.activeStreams.clear();
  }

  // Get count of active streams
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  // Check if a deployment has an active stream
  hasActiveStream(deploymentId: string): boolean {
    return this.activeStreams.has(deploymentId);
  }
}
