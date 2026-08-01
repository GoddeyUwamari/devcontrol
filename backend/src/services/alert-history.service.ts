import axios from 'axios';
import { Pool } from 'pg';
import { AlertHistoryRepository, Alert, AlertFilters, AlertStats } from '../repositories/alert-history.repository';

interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt?: string;
  value: string;
}

export class AlertHistoryService {
  private repository: AlertHistoryRepository;
  private prometheusUrl: string;

  constructor(pool: Pool, prometheusUrl: string = 'http://localhost:9090') {
    this.repository = new AlertHistoryRepository(pool);
    this.prometheusUrl = prometheusUrl;
  }

  async syncAlertsFromPrometheus(): Promise<void> {
    try {
      // Fetch alerts from Prometheus API
      const response = await axios.get(`${this.prometheusUrl}/api/v1/alerts`, {
        timeout: 5000,
      });

      if (response.data.status !== 'success') {
        console.error('Failed to fetch alerts from Prometheus');
        return;
      }

      const prometheusAlerts: PrometheusAlert[] = response.data.data.alerts || [];

      // Process each alert
      for (const promAlert of prometheusAlerts) {
        await this.processPrometheusAlert(promAlert);
      }

      // Resolve alerts that are no longer firing in Prometheus
      await this.resolveStaleAlerts(prometheusAlerts);
    } catch (error: any) {
      console.error('Error syncing alerts from Prometheus:', error.message);
    }
  }

  private async processPrometheusAlert(promAlert: PrometheusAlert): Promise<void> {
    const alertName = promAlert.labels.alertname;
    const severity = this.determineSeverity(promAlert.labels.severity);
    const description = promAlert.annotations.summary || promAlert.annotations.description || '';
    const serviceId = promAlert.labels.service_id; // Optional service link

    if (promAlert.state === 'firing') {
      // Check if this alert already exists and is firing
      const existingAlert = await this.repository.findByAlertName(alertName, 'firing');

      if (!existingAlert) {
        // Create new alert
        await this.repository.create({
          alertName,
          serviceId,
          severity,
          status: 'firing',
          description,
          labels: promAlert.labels,
          annotations: promAlert.annotations,
          startedAt: promAlert.activeAt ? new Date(promAlert.activeAt) : new Date(),
        });

        console.log(`[Alert Sync] New alert created: ${alertName}`);
      }
    } else if (promAlert.state === 'inactive') {
      // Resolve the alert if it exists
      const existingAlert = await this.repository.findByAlertName(alertName, 'firing');

      if (existingAlert) {
        await this.repository.resolveUnscoped(existingAlert.id);
        console.log(`[Alert Sync] Alert resolved: ${alertName}`);
      }
    }
  }

  private async resolveStaleAlerts(prometheusAlerts: PrometheusAlert[]): Promise<void> {
    // Get all currently firing alerts from database
    const firingAlerts = await this.repository.findAllFiringUnscoped(1000);

    // Get set of alert names that are currently firing in Prometheus
    const firingAlertNames = new Set(
      prometheusAlerts
        .filter((a) => a.state === 'firing')
        .map((a) => a.labels.alertname)
    );

    // Resolve alerts that are no longer firing in Prometheus
    for (const dbAlert of firingAlerts) {
      if (!firingAlertNames.has(dbAlert.alertName)) {
        await this.repository.resolveUnscoped(dbAlert.id);
        console.log(`[Alert Sync] Stale alert resolved: ${dbAlert.alertName}`);
      }
    }
  }

  private determineSeverity(severity?: string): 'critical' | 'warning' {
    if (severity && severity.toLowerCase() === 'critical') {
      return 'critical';
    }
    return 'warning';
  }

  async getAlertHistory(filters: AlertFilters): Promise<{ alerts: Alert[]; total: number; page: number; limit: number }> {
    const result = await this.repository.findAll(filters);
    return {
      ...result,
      page: filters.page || 1,
      limit: filters.limit || 50,
    };
  }

  async getAlert(id: string, organizationId: string): Promise<Alert | null> {
    return this.repository.findById(id, organizationId);
  }

  async acknowledgeAlert(id: string, organizationId: string, user: string = 'admin'): Promise<Alert | null> {
    const alert = await this.repository.findById(id, organizationId);

    if (!alert) {
      throw new Error('Alert not found');
    }

    if (alert.status === 'resolved') {
      throw new Error('Cannot acknowledge a resolved alert');
    }

    return this.repository.acknowledge(id, user, organizationId);
  }

  async resolveAlert(id: string, organizationId: string): Promise<Alert | null> {
    const alert = await this.repository.findById(id, organizationId);

    if (!alert) {
      throw new Error('Alert not found');
    }

    if (alert.status === 'resolved') {
      throw new Error('Alert is already resolved');
    }

    return this.repository.resolve(id, organizationId);
  }

  async deleteAlert(id: string, organizationId: string): Promise<boolean> {
    return this.repository.delete(id, organizationId);
  }

  async getAlertStats(filters: Omit<AlertFilters, 'page' | 'limit'>): Promise<AlertStats> {
    return this.repository.getStats(filters);
  }
}
