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
🔐 **Multi-tenant** - Complete authentication with organization workspaces.

**Perfect for:** Startups scaling from 5 to 50 engineers managing microservices on AWS.

---

## Features

### 🎯 Core Platform
- **Service catalog** - Track all microservices with GitHub links, owners, templates
- **Deployment history** - Every deploy across dev/staging/prod with status tracking
- **Team management** - Service ownership, Slack integration, member lists
- **Multi-tenancy** - Multiple organizations with complete data isolation
- **Authentication** - JWT-based auth with login, register, password reset

### 💰 Real-Time AWS Cost Tracking
- **Real-time sync** from AWS Cost Explorer API
- **Manual refresh** - Click "Sync AWS" button to update instantly
- **Free tier compatible** - Accurately shows $0 when using free tier
- **Cost breakdown** - By service (EC2, RDS, S3, Lambda, etc.)
- **Graceful fallback** - Works offline with cached data
- **Per-organization** - Encrypted AWS credentials for each workspace

### 🎯 Cost Optimization Recommendations
- **AI-powered savings detection** - Identify idle EC2 instances, oversized databases, unused resources
- **CloudWatch integration** - Analyzes 7-day CPU utilization patterns via AWS API
- **Actionable insights** - HIGH/MEDIUM/LOW severity scoring with potential monthly savings
- **One-click resolution** - Mark recommendations as resolved or dismissed
- **Real-time analysis** - Scan your AWS account on-demand
- **Proven results** - Helping teams save 15-30% on infrastructure costs

![Cost Recommendations](docs/screenshots/cost-optimization/recommendations-page.png)

### 📊 DORA Metrics Dashboard
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

### 🔐 Multi-Tenancy & Authentication
- **Complete authentication system** - Email/password login, registration, password reset
- **Multiple organizations** - Users can belong to multiple workspaces
- **Organization switching** - Instant context switching in UI
- **Team collaboration** - Invite members, assign roles, manage permissions
- **Role-based access control** - Owner, Admin, Member, Viewer roles
- **Encrypted credentials** - AES-256 encryption for AWS credentials per organization
- **Data isolation** - PostgreSQL Row-Level Security ensures complete separation
- **Organization settings** - Manage name, members, AWS integration, and more

![Login Page](docs/screenshots/auth/login-page.png)

### 📊 Monitoring & Observability
- **Prometheus + Grafana** - Industry-standard monitoring stack
- **4 pre-built dashboards** - API Performance, Infrastructure Costs, Service Health, System Resources
- **Real-time metrics** - HTTP requests, errors, response times
- **Business KPIs** - Services, deployments, infrastructure costs
- **Auto-refresh dashboard** - Updates every 30 seconds
- **Alert rules** - Automated notifications for critical issues
- **Alert history** - Track, acknowledge, and resolve Prometheus alerts

### 🎨 Modern UX
- **Horizontal navigation** - Clean, Vercel-inspired design
- **Command palette** - Press ⌘K to search everything
- **Organization switcher** - Quick switching between workspaces
- **User menu** - Profile settings, organization settings, sign out
- **Empty states** - Helpful guidance when starting fresh
- **Mobile responsive** - Works on desktop, tablet, phone
- **Dark mode** - Beautiful dark theme throughout
- **Loading states** - Skeleton screens, toast notifications

---

## Screenshots

### Dashboard - Real-time Metrics
![Dashboard](docs/screenshots/01-dashboard.png)

### Login - Authentication
![Login Page](docs/screenshots/auth/login-page.png)

### AWS Cost Sync - Your Differentiator
![Infrastructure with AWS Sync](docs/screenshots/04-infrastructure.png)

### Organization Settings - Multi-Tenancy
![Organization Settings](docs/screenshots/organization/settings-page.png)

### Command Palette - Instant Search
![Command Palette](docs/screenshots/command-palette.png)

---

## Installation

### Prerequisites
- Node.js 20+
- Docker
- AWS account (optional, for cost tracking)

### Quick Start: local stack (recommended)

Runs the whole app on your machine against a throwaway Postgres in Docker,
logged in as the owner of an empty organization. The app makes no calls to
AWS, AI (Anthropic), billing (Stripe), email, Slack or analytics (Google
Analytics). Next.js's dev server itself checks the npm registry for its own
version; that request carries no app data.

```bash
git clone https://github.com/GoddeyUwamari/devcontrol.git
cd devcontrol
npm ci            # from the repository root (npm workspaces)
npm run dev:local # Docker must be running
```

`npm run dev:local`:
- starts `postgres:14` on `127.0.0.1:55432` (database `devcontrol_local`,
  `dev/local/docker-compose.yml`);
- builds the schema exactly as CI does (`.github/scripts/ci-bootstrap-schema.js`),
  plus `dev/local/reconstructed-tables.sql` for the few tables no migration creates;
- runs the backend as `devcontrol_local`, a non-superuser, NOBYPASSRLS, DML-only
  role, so row-level security applies as in production;
- creates `owner@example.test` in an empty organization, with a password
  generated on first run and written only to `dev/local/.state/db/owner-login.txt`;
- starts the backend (http://localhost:8080) and frontend (http://localhost:3010)
  on loopback with an allowlisted environment, not your shell's.

Everything it generates lives in `dev/local/.state/`, which is git-ignored.
The backend runs with `DEVCONTROL_LOCAL_STACK=1`: it reads only
`dev/local/.state/backend.env` (never `backend/.env`), runs no background jobs,
refuses every AWS call, and refuses to start if anything points outside this
machine (a production `NODE_ENV`, a non-loopback database, any Stripe, SMTP,
Anthropic, Resend, Slack or AWS credential). Next.js loads `.env*` files from the
repository root by itself, so `dev:local` also refuses to run if one exists
there; use a checkout without them (e.g. a `git worktree`).

Ctrl-C stops the servers; Postgres keeps running. Stop it with
`docker compose -f dev/local/docker-compose.yml down` (add `-v` to delete the data).

`npm run dev:local -- --seed` adds an invented demo workspace (Example SaaS Inc.,
login `founder@example.com`), and `--reset` starts from an empty database. All
worktrees share one local database, so run `dev:local` from one worktree at a
time. See [dev/local/README.md](dev/local/README.md).

### Running against your own Postgres

```bash
cp backend/.env.example backend/.env   # fake local values; integrations empty = disabled
psql -h localhost -U postgres -d platform_portal -c "CREATE ROLE devcontrol;"
DB_NAME=platform_portal node .github/scripts/ci-bootstrap-schema.js
npm run dev
```

**Access:**
- Frontend: http://localhost:3010
- API: http://localhost:8080
- Prometheus: http://localhost:9090 (optional monitoring stack:
  `cd monitoring && docker-compose -f docker-compose.monitoring.yml up -d`)
- Grafana: http://localhost:3000 (admin/devcontrol2024)

Migration `database/migrations-admin/005_migrate_existing_data.sql` creates a
default admin whose password is published in that file. Never leave it active:
`npm run dev:local` deactivates it, and any other database must do the same.

### First-Time Setup

1. **Register your account** at http://localhost:3010/register
   - Auto-creates your personal organization
   - Logs you in automatically

2. **Configure AWS (optional):**
   - Settings → Organization → AWS tab
   - Add Access Key ID and Secret Key
   - Credentials are encrypted with AES-256

3. **Invite team members:**
   - Settings → Organization → Members tab
   - Send email invitations with roles

### AWS Cost Integration (Optional)
```bash
# 1. Enable Cost Explorer in AWS Console (takes 24hrs)
# 2. Create IAM user with CostExplorerReadOnlyAccess + CloudWatchReadOnlyAccess
# 3. Add credentials in Organization Settings → AWS tab
# 4. Click "Test Connection" to verify
# 5. Click "Sync AWS" in Infrastructure page
```

**See [AWS Integration Guide](docs/AWS_INTEGRATION.md) for detailed setup.**

---

## Tech Stack

**Frontend:** Next.js 15 • React 19 • TypeScript • Tailwind v4 • Radix UI  
**Backend:** Express.js • PostgreSQL with RLS • Node.js 20+ • Zod validation • JWT Auth  
**Security:** AES-256 encryption • bcrypt • Row-Level Security • RBAC  
**Monitoring:** Prometheus • Grafana • Node Exporter • prom-client  
**Cloud:** AWS SDK (Cost Explorer, CloudWatch) • Docker  

**See [Architecture Guide](docs/ARCHITECTURE.md) for system design details.**

---

## API Examples

### Authentication

**Register:**
```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "fullName": "John Doe"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### Sync AWS Costs
```bash
curl -X POST http://localhost:8080/api/infrastructure/sync-aws \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCost": 0.00,
    "resourcesSynced": 1,
    "lastSyncedAt": "2025-12-28T18:33:34.008Z",
    "byService": [...]
  }
}
```

### Get Cost Recommendations
```bash
curl http://localhost:8080/api/cost-recommendations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get DORA Metrics
```bash
curl "http://localhost:8080/api/metrics/dora?date_range=30d&environment=production" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Organization Management
```bash
# List organizations
curl http://localhost:8080/api/organizations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Create organization
curl -X POST http://localhost:8080/api/organizations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "slug": "my-company"
  }'

# Switch organization
curl -X POST http://localhost:8080/api/organizations/switch \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "organizationId": "uuid" }'
```

**See [API Documentation](docs/API.md) for complete reference.**

---

## Documentation

- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design, tech stack, patterns
- **[AWS Integration](docs/AWS_INTEGRATION.md)** - Complete Cost Explorer setup
- **[Monitoring Setup](docs/MONITORING.md)** - Prometheus + Grafana configuration
- **[Multi-Tenancy Setup](MULTI_TENANCY_SETUP.md)** - Authentication and organization management
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
- Cost Optimization Engine (CloudWatch integration, idle resource detection)
- DORA Metrics Dashboard (4 core metrics with benchmarks)
- Grafana dashboard templates (4 pre-built dashboards)
- Alert History UI (Prometheus alert management)

**✅ Completed (Weeks 7-9):**
- **Multi-Tenancy Backend** - PostgreSQL Row-Level Security, JWT authentication
- **Multi-Tenancy Frontend** - Login, register, organization switching
- **Organization Management** - Create, invite members, assign roles
- **Encrypted AWS Credentials** - Per-organization credential storage
- **Team Collaboration** - Invite members, manage permissions
- **Complete Authentication** - Email/password, forgot password, reset flow

**📋 Planned (Future):**
- SSO integration (Google, GitHub, Okta)
- Advanced RBAC with custom permissions
- Deployment logs streaming
- Service dependency graphs
- Terraform state tracking
- Audit logs and compliance features

---

## Security

DevControl implements enterprise-grade security:

- **Authentication:** JWT with 7-day access tokens, 30-day refresh tokens
- **Password Hashing:** bcrypt with 10 rounds
- **Data Isolation:** PostgreSQL Row-Level Security (RLS)
- **Encryption:** AES-256-GCM for sensitive data (AWS credentials)
- **RBAC:** 4 roles (Owner, Admin, Member, Viewer) with granular permissions
- **CSRF Protection:** Ready for production (commented placeholders)
- **Rate Limiting:** Infrastructure ready for protection

---

## For Businesses

**Need implementation help?**

DevControl is production-ready for enterprise deployments:

### Self-Hosted Implementation ($10,000 - $20,000)
- Deploy to your infrastructure (AWS, GCP, Azure)
- Multi-organization setup
- AWS integration configuration
- Team training (2-day workshop)
- 30-day support included

### Multi-Tenant Hosting ($30,000 - $50,000)
- Host multiple clients on your infrastructure
- Custom branding per organization
- SSO integration (Google, Okta, Azure AD)
- Enterprise support with SLA
- Dedicated account management

### SaaS Subscription (Coming Soon)
- **Free:** 1 org, 5 users, 10 services
- **Pro ($49/month):** 3 orgs, 20 users, 50 services
- **Enterprise ($999/month):** Unlimited everything + priority support

### Consulting
- AWS integration setup: $150-250/hour
- Custom feature development: $200-300/hour
- Architecture review: $2,000/day
- Team training: $2,000/day

**Contact:** projectmanager@wayuptechn.com • +1 (848) 228-9890  
**Schedule:** [calendly.com/goddeyuwamari](https://calendly.com/goddeyuwamari)

---

## Related Projects

- **[Platform Engineering Toolkit](https://github.com/GoddeyUwamari/platform-engineering-toolkit)** - CLI tool for service creation and AWS deployment
- **[CloudBill](https://github.com/GoddeyUwamari/cloudbill)** - Multi-tenant SaaS billing platform

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repo
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open pull request

---

## License

MIT License - see [LICENSE](LICENSE)

---

## Author

**Goddey Uwamari**  
Founder & CEO, [WayUP Technology](https://wayuptechn.com)  
Senior Full-Stack & Platform Engineer

📧 projectmanager@wayuptechn.com  
🔗 [LinkedIn](https://www.linkedin.com/in/goddey-uwamari) • [GitHub](https://github.com/GoddeyUwamari)  
📍 Newark, NJ (NYC Metro)

---

<div align="center">

**Built with ❤️ for platform engineers managing AWS infrastructure**

⭐ Star this repo • 🐦 Share on Twitter • 🤝 Contribute improvements

[⬆ Back to Top](#devcontrol)

</div>