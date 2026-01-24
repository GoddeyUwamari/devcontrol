# Prometheus Setup Complete ✅

## What Was Done

### 1. Verified Existing Infrastructure
- ✅ Prometheus running on port 9090 (container: devcontrol-prometheus)
- ✅ Grafana running on port 3000 (container: devcontrol-grafana)
- ✅ Node Exporter running on port 9100
- ✅ PostgreSQL Exporter running on port 9187
- ✅ Backend exposing metrics at http://localhost:8080/metrics

### 2. Fixed CORS Issue
**Problem**: The frontend couldn't directly query Prometheus due to missing CORS headers.

**Solution**: Created a backend API proxy for Prometheus queries.

**Files Created**:
- `backend/src/controllers/prometheus.controller.ts` - Proxy controller
- `backend/src/routes/prometheus.routes.ts` - Proxy routes

**Files Modified**:
- `backend/src/routes/index.ts` - Added Prometheus routes
- `backend/.env` - Added PROMETHEUS_URL=http://localhost:9090
- `app/(app)/admin/monitoring/page.tsx` - Updated to use backend proxy

### 3. New Backend API Endpoints

All accessible at `http://localhost:8080/api/prometheus/`:

| Endpoint | Description |
|----------|-------------|
| GET `/query?query=<promql>` | Query Prometheus (instant query) |
| GET `/query_range?query=<promql>&start=<time>&end=<time>&step=<duration>` | Range query |
| GET `/targets` | Get Prometheus scrape targets status |
| GET `/health` | Check Prometheus health |
| GET `/config` | Get Prometheus configuration |

## Verification Steps

### 1. Check All Containers Are Running

```bash
docker ps | grep -E "(prometheus|grafana)"
```

Expected output:
```
devcontrol-grafana         (running)
devcontrol-prometheus      (running)
devcontrol-postgres-exporter (running)
```

### 2. Check Prometheus Health

```bash
curl http://localhost:8080/api/prometheus/health
```

Expected output:
```json
{
  "status": "healthy",
  "message": "Prometheus Server is Healthy.",
  "url": "http://localhost:9090"
}
```

### 3. Test Prometheus Query

```bash
curl 'http://localhost:8080/api/prometheus/query?query=up'
```

Should return JSON with all targets showing "value": ["timestamp", "1"]

### 4. Check Backend Metrics

```bash
curl http://localhost:8080/metrics
```

Should return Prometheus-format metrics like:
```
# HELP devcontrol_process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE devcontrol_process_cpu_user_seconds_total counter
devcontrol_process_cpu_user_seconds_total 6.495225999999999
...
```

### 5. Access Web UIs

Open in browser:
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/devcontrol2024)
- **Monitoring Page**: http://localhost:3010/admin/monitoring

## Monitoring Page

Navigate to http://localhost:3010/admin/monitoring

You should now see:
- ✅ System Status: Operational
- ✅ API Uptime: 99.95%
- ✅ Response Time metrics
- ✅ Service Health Table with all services showing status
- ✅ No "Unable to connect to Prometheus" error

## Available Metrics

### DevControl Metrics
```promql
# HTTP Metrics
http_request_duration_seconds
http_requests_total

# Service Metrics
services_total
services_active

# Infrastructure Metrics
infrastructure_cost_monthly_total

# DORA Metrics
dora_deployment_frequency
dora_lead_time_hours
dora_change_failure_rate
dora_mttr_minutes

# Alert Metrics
alerts_active_total
alerts_acknowledged_total
alerts_mttr_minutes
```

### System Metrics (from Node Exporter)
```promql
node_cpu_seconds_total
node_memory_MemTotal_bytes
node_filesystem_avail_bytes
node_network_receive_bytes_total
```

### Database Metrics (from PostgreSQL Exporter)
```promql
pg_up
pg_stat_database_numbackends
pg_stat_database_xact_commit
```

## Example Prometheus Queries

### API Response Time (p95)
```promql
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

### Request Rate (requests per minute)
```promql
rate(http_requests_total[5m]) * 60
```

### Error Rate
```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
```

### Memory Usage
```promql
devcontrol_process_resident_memory_bytes / 1024 / 1024  # in MB
```

### Infrastructure Cost
```promql
infrastructure_cost_monthly_total
```

## Grafana Dashboards

Pre-configured dashboards available in Grafana:
1. **API Performance** - Request rates, response times, error rates
2. **Service Health** - Service status, uptime, incidents
3. **Infrastructure Costs** - Monthly costs, trends, breakdown
4. **System Resources** - CPU, Memory, Disk, Network

Access: http://localhost:3000/dashboards

## Troubleshooting

### Monitoring page shows "Unable to connect"
1. Check backend is running: `curl http://localhost:8080/health`
2. Check Prometheus proxy: `curl http://localhost:8080/api/prometheus/health`
3. Check containers: `docker ps | grep prometheus`

### Prometheus shows targets as "down"
1. Check target health: `curl http://localhost:9090/api/v1/targets`
2. For devcontrol-api: Ensure backend is running on port 8080
3. For postgres-exporter: Check database connection string in docker-compose

### No metrics showing
1. Check backend /metrics endpoint: `curl http://localhost:8080/metrics`
2. Verify Prometheus is scraping: Go to http://localhost:9090/targets
3. Wait 15-30 seconds for next scrape cycle

### CORS errors in browser console
Make sure you're using the backend proxy endpoints (`/api/prometheus/*`) instead of calling Prometheus directly.

## Next Steps

### 1. Set Up Alerts
Edit `monitoring/prometheus/alerts.yml` to add custom alerts:
```yaml
groups:
  - name: devcontrol
    rules:
      - alert: HighResponseTime
        expr: http_request_duration_seconds > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time detected"
```

### 2. Create Custom Dashboards
1. Open Grafana: http://localhost:3000
2. Create new dashboard
3. Add panels with your custom queries
4. Save to `monitoring/grafana/dashboards/`

### 3. Add More Exporters
- Redis Exporter: `redis_exporter`
- Nginx Exporter: `nginx_exporter`
- Blackbox Exporter: For external endpoint monitoring

### 4. Set Up Alertmanager (Optional)
For alert notifications via email, Slack, PagerDuty, etc.

```yaml
# In docker-compose.monitoring.yml
alertmanager:
  image: prom/alertmanager:v0.26.0
  ports:
    - "9093:9093"
  volumes:
    - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
```

## Files Reference

### Configuration Files
- `monitoring/docker-compose.monitoring.yml` - Docker services
- `monitoring/prometheus/prometheus.yml` - Prometheus config
- `monitoring/prometheus/alerts.yml` - Alert rules
- `monitoring/grafana/provisioning/datasources/prometheus.yml` - Grafana datasource
- `backend/.env` - Backend environment (PROMETHEUS_URL)
- `.env.local` - Frontend environment (monitoring URLs)

### Code Files
- `backend/src/controllers/prometheus.controller.ts` - Proxy controller
- `backend/src/routes/prometheus.routes.ts` - Proxy routes
- `backend/src/metrics/index.ts` - Metrics definitions
- `backend/src/middleware/metrics.ts` - Metrics middleware
- `app/(app)/admin/monitoring/page.tsx` - Monitoring UI

## Resources

- **Prometheus Documentation**: https://prometheus.io/docs/
- **Grafana Documentation**: https://grafana.com/docs/
- **PromQL Guide**: https://prometheus.io/docs/prometheus/latest/querying/basics/
- **Node Exporter Metrics**: https://github.com/prometheus/node_exporter

## Support

If you encounter issues:
1. Check container logs: `docker logs devcontrol-prometheus`
2. Check backend logs
3. Verify all services are healthy: `docker ps`
4. Test endpoints with curl as shown above

---

**Setup completed successfully!** 🎉

Your DevControl monitoring is now live with:
- ✅ Real-time metrics collection
- ✅ Prometheus query API
- ✅ Grafana dashboards
- ✅ Service health monitoring
- ✅ Infrastructure cost tracking
- ✅ DORA metrics

Navigate to http://localhost:3010/admin/monitoring to see it in action!
