import { WebSocketServer } from '../websocket/server';

export class MetricsEvents {
  private wsServer: WebSocketServer;

  constructor(wsServer: WebSocketServer) {
    this.wsServer = wsServer;
  }

  // Emit when new alert is created
  public alertCreated(organizationId: string, alert: any) {
    this.wsServer.emitToOrganization(organizationId, 'alert:created', {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      source: alert.source,
      timestamp: new Date(),
    });
  }

  // Emit when alert is resolved
  public alertResolved(organizationId: string, alert: any) {
    this.wsServer.emitToOrganization(organizationId, 'alert:resolved', {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      timestamp: new Date(),
    });
  }

  // Emit when service health changes
  public serviceHealthChanged(organizationId: string, service: any) {
    this.wsServer.emitToOrganization(organizationId, 'service:health', {
      serviceId: service.id,
      serviceName: service.name,
      status: service.status,
      healthScore: service.health_score,
      timestamp: new Date(),
    });
  }

  // Emit when infrastructure metrics update
  public infrastructureUpdated(organizationId: string, infrastructure: any) {
    this.wsServer.emitToOrganization(organizationId, 'metrics:infrastructure', {
      totalResources: infrastructure.totalResources,
      activeResources: infrastructure.activeResources,
      regions: infrastructure.regions,
      timestamp: new Date(),
    });
  }
}
