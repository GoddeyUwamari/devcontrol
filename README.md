# DevControl

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**Open source internal developer portal for AWS teams.**

Track services, deployments, and infrastructure costs in 2 minutes. Backstage alternative built specifically for AWS.

[View Demo](#screenshots) • [Quick Start](#installation) • [Documentation](docs/)

</div>

![DevControl Dashboard](docs/screenshots/dashboard.png)

---

## Why DevControl?

🚀 **2-minute setup** - `npm install && docker-compose up`. No YAML hell.  
💰 **Real-time AWS costs** - Tracks actual spend via Cost Explorer API. Backstage doesn't do this.  
⚡ **Fast & beautiful** - Vercel-quality UI, not enterprise gray boxes.  
🔍 **Command palette (⌘K)** - Spotlight-style search across everything.  
📊 **Production monitoring** - Prometheus + Grafana stack included.  
🎯 **AWS-native** - Built for teams already on AWS. No Kubernetes required.

**Perfect for:** Startups scaling from 5 to 50 engineers managing microservices on AWS.

---

## Features

### 🎯 Core Platform
- **Service catalog** - Track all microservices with GitHub links, owners, templates
- **Deployment history** - Every deploy across dev/staging/prod with status tracking
- **Team management** - Service ownership, Slack integration, member lists

### 💰 Real-Time AWS Cost Tracking
- **Real-time sync** from AWS Cost Explorer API
- **Manual refresh** - Click "Sync AWS" button to update instantly
- **Free tier compatible** - Accurately shows $0 when using free tier
- **Cost breakdown** - By service (EC2, RDS, S3, Lambda, etc.)
- **Graceful fallback** - Works offline with cached data

### 🎯 Cost Optimization Recommendations (NEW!)
- **AI-powered savings detection** - Identify idle EC2 instances, oversized databases, unused resources
- **CloudWatch integration** - Analyzes 7-day CPU utilization patterns via AWS API
- **Actionable insights** - HIGH/MEDIUM/LOW severity scoring with potential monthly savings
- **One-click resolution** - Mark recommendations as resolved or dismissed
- **Real-time analysis** - Scan your AWS account on-demand
- **Proven results** - Helping teams save 15-30% on infrastructure costs

![Cost Recommendations](docs/screenshots/cost-optimization/recommendations-page.png)

### 📊 DORA Metrics Dashboard (NEW!)
- **Industry-standard DevOps metrics** - Track the 4 key DORA metrics used by elite engineering teams
- **Deployment Frequency** - Measure deployment velocity per service, team, and environment
- **Lead Time for Changes** - Track time between consecutive deployments
- **Change Failure Rate** - Monitor deployment success rates and quality
- **Mean Time to Recovery (MTTR)** - Measure incident response effectiveness
- **Benchmark comparison** - Elite/High/Medium/Low performance classification
- **Service breakdown** - Compare performance across teams and services
- **Trend analysis** - Track improvements over time with visual indicators
- **Smart filters** - By service, team, environment, time range (7d/30d/90d)

Based on Google Cloud's DevOps Research and Assessment (DORA) research.

![DORA Metrics Dashboard](docs/screenshots/dora-metrics/dashboard-overview.png)

### 📊 Monitoring & Observability
- **Prometheus + Grafana** - Industry-standard monitoring stack
- **Real-time metrics** - HTTP requests, errors, response times
- **Business KPIs** - Services, deployments, infrastructure costs
- **Auto-refresh dashboard** - Updates every 30 seconds
- **Alert rules** - Automated notifications for critical issues

### 🎨 Modern UX
- **Horizontal navigation** - Clean, Vercel-inspired design
- **Command palette** - Press ⌘K to search everything
- **Empty states** - Helpful guidance when starting fresh
- **Mobile responsive** - Works on desktop, tablet, phone
- **Loading states** - Skeleton screens, toast notifications

---

## Screenshots

### Dashboard - Real-time Metrics
![Dashboard](docs/screenshots/01-dashboard.png)

### AWS Cost Sync - Your Differentiator
![Infrastructure with AWS Sync](docs/screenshots/04-infrastructure.png)

### Command Palette - Instant Search
![Command Palette](docs/screenshots/command-palette.png)

---

## Installation

### Prerequisites
- Node.js 20+
- Docker
- AWS account (optional, for cost tracking)

### Quick Start
```bash
# Clone and install
git clone https://github.com/GoddeyUwamari/devcontrol.git
cd devcontrol
npm install

# Start PostgreSQL + monitoring stack
docker run -d --name platform-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=platform_portal \
  -p 5432:5432 postgres:14

cd monitoring && docker-compose -f docker-compose.monitoring.yml up -d && cd ..

# Configure (optional: add AWS credentials)
cp backend/.env.example backend/.env

# Start everything
npm run dev
```

**Access:**
- Frontend: http://localhost:3010
- API: http://localhost:8080
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/devcontrol2024)

### AWS Cost Integration (Optional)
```bash
# 1. Enable Cost Explorer in AWS Console (takes 24hrs)
# 2. Create IAM user with CostExplorerReadOnlyAccess policy
# 3. Add to backend/.env:
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012

# 4. Restart backend
npm run dev:backend

# 5. Click "Sync AWS" in Infrastructure page
```

**See [AWS Integration Guide](docs/AWS_INTEGRATION.md) for detailed setup.**

---

## Tech Stack

**Frontend:** Next.js 15 • React 19 • TypeScript • Tailwind v4 • Radix UI  
**Backend:** Express.js • PostgreSQL • Node.js 20+ • Zod validation  
**Monitoring:** Prometheus • Grafana • Node Exporter • prom-client  
**Cloud:** AWS SDK (Cost Explorer, CloudWatch) • Docker  

**See [Architecture Guide](docs/ARCHITECTURE.md) for system design details.**

---

## API Examples

### Sync AWS Costs
```bash
curl -X POST http://localhost:8080/api/infrastructure/sync-aws
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCost": 0.00,
    "resourcesSynced": 1,
    "lastSyncedAt": "2025-12-27T18:33:34.008Z",
    "byService": [...]
  }
}
```

### Get Cost Recommendations
```bash
curl http://localhost:8080/api/cost-recommendations
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "resourceType": "EC2",
      "resourceId": "i-1234567890abcdef0",
      "issue": "Idle instance (1.97% CPU utilization)",
      "potentialSavings": 7.50,
      "severity": "LOW",
      "status": "active"
    }
  ]
}
```

### Get DORA Metrics
```bash
curl "http://localhost:8080/api/metrics/dora?date_range=30d&environment=production"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "deploymentFrequency": {
      "value": 1.2,
      "unit": "per day",
      "benchmark": "high",
      "trend": "improving"
    },
    "leadTime": {
      "value": 4.5,
      "unit": "hours",
      "benchmark": "elite"
    },
    "changeFailureRate": {
      "value": 0,
      "unit": "percentage",
      "benchmark": "elite"
    },
    "mttr": {
      "value": 0,
      "unit": "minutes",
      "benchmark": "elite"
    }
  }
}
```

### List Services
```bash
curl http://localhost:8080/api/services
```

### Get Prometheus Metrics
```bash
curl http://localhost:8080/metrics
```

**See [API Documentation](docs/API.md) for complete reference.**

---

## Documentation

- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design, tech stack, patterns
- **[AWS Integration](docs/AWS_INTEGRATION.md)** - Complete Cost Explorer setup
- **[Monitoring Setup](docs/MONITORING.md)** - Prometheus + Grafana configuration
- **[API Reference](docs/API.md)** - All endpoints with examples
- **[Contributing](CONTRIBUTING.md)** - Development guidelines

---

## Roadmap

**✅ Completed (Weeks 1-4):**
- Production UI with Vercel-inspired design
- Real-time AWS cost tracking via Cost Explorer
- Prometheus + Grafana monitoring stack
- Command palette (⌘K) and quick actions
- Mobile responsive design

**✅ Completed (Weeks 5-6):**
- **Cost Optimization Engine** - AWS CloudWatch integration detecting idle resources
  - Idle EC2 detection (CPU <5% for 7 days)
  - Oversized RDS databases in non-production environments
  - Unused Elastic IP identification
  - Reserved Instance opportunity analysis
  - Potential savings calculator with severity scoring
  - Prometheus metrics: cost_optimization_potential_savings_total
- **DORA Metrics Dashboard** - Industry-standard DevOps performance tracking
  - 4 core metrics: Deployment Frequency, Lead Time, Change Failure Rate, MTTR
  - Elite/High/Medium/Low benchmark classification
  - Service and team breakdown analytics
  - Trend indicators (improving/stable/declining)
  - Time-series analysis with PostgreSQL window functions
  - Prometheus integration for real-time monitoring

**🚧 In Progress (Weeks 7-8):**
- Grafana dashboard templates
- Alert history UI
- Service dependency graphs

**📋 Planned (Weeks 9-12):**
- Multi-tenancy support
- SSO integration (SAML, OAuth)
- Role-based access control
- Deployment logs streaming
- Terraform state tracking

---

## For Businesses

**Need implementation help?**

- Custom deployments: Starting at $10,000
- Team training: $2,000/day workshop
- Enterprise support: Custom SLA
- AWS integration consulting: $150-250/hour

**Contact:** projectmanager@wayuptechn.com • +1 (848) 228-9890  
**Schedule:** [calendly.com/goddeyuwamari](https://calendly.com/goddeyuwamari)

---

## Related Projects

- **[Platform Engineering Toolkit](https://github.com/GoddeyUwamari/platform-engineering-toolkit)** - CLI tool for service creation and AWS deployment

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repo
2. Create feature branch
3. Commit changes
4. Open pull request

---

## License

MIT License - see [LICENSE](LICENSE)

---

## Author

**Goddey Uwamari**  
Founder & CEO, [WayUP Technology](https://wayuptechn.com)  
Senior Platform Engineer

📧 projectmanager@wayuptechn.com  
🔗 [LinkedIn](https://www.linkedin.com/in/goddey-uwamari) • [GitHub](https://github.com/GoddeyUwamari)  
📍 Newark, NJ (NYC Metro)

---

<div align="center">

**Built with ❤️ for platform engineers managing AWS infrastructure**

⭐ Star this repo • 🐦 Share on Twitter • 🤝 Contribute improvements

[⬆ Back to Top](#devcontrol)

</div>