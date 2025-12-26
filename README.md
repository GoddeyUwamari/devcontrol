# DevControl

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Stars](https://img.shields.io/github/stars/GoddeyUwamari/devcontrol?style=for-the-badge)

**Take control of your development infrastructure**

Track services, deployments, and AWS infrastructure from a beautiful dashboard.

[Live Demo](#) • [Documentation](#quick-start) • [Get Started](#installation)

</div>

![Dashboard Preview](docs/screenshots/01-dashboard.png)

---

## 🎯 Built For

- **Startups** scaling from 5 to 50+ engineers
- **Platform teams** managing 10-100+ microservices  
- **DevOps engineers** tracking AWS costs and deployments
- **Engineering managers** needing service visibility

## ⭐ Why DevControl?

✅ **2 minutes to deploy** - Not 2 weeks like Backstage  
✅ **Beautiful UI** - Vercel-quality design, not enterprise gray  
✅ **AWS-native** - Purpose-built for AWS infrastructure  
✅ **Open source** - Free forever, no vendor lock-in  
✅ **Production-ready** - Built with enterprise patterns from day 1

---

## ✨ Features

### 🎨 Modern Vercel-Inspired UI
- **Horizontal Navigation** - Clean, modern top navigation bar
- **Command Palette (⌘K)** - Spotlight-style search across all resources
- **Quick Actions Menu** - One-click create services, deployments, infrastructure
- **Responsive Design** - Beautiful on desktop, tablet, and mobile
- **Smooth Animations** - Polished transitions and micro-interactions
- **Beautiful Empty States** - Helpful guidance when no data exists

### 📊 Comprehensive Dashboard
- Real-time platform metrics (6 services, 5 deployments, $1,675 AWS costs)
- Recent deployment history across all environments
- Service health scores and status tracking
- Monthly AWS cost breakdown with trend analysis
- Production-grade error handling with graceful fallbacks

### 🚀 Service Catalog
- Track all services created via Platform CLI
- Filter by template (API, Microservices), status, owner
- Direct GitHub repository links
- Service metadata and descriptions
- Mobile-optimized tables with horizontal scroll

![Services](docs/screenshots/02-services.png)

### 🔄 Deployment Tracking
- Complete deployment history (dev, staging, production)
- Real-time deployment status (Running, Deploying, Failed)
- AWS region distribution and cost estimates per deployment
- Deployment timeline and user attribution
- Environment-based filtering

![Deployments](docs/screenshots/03-deployments.png)

### ☁️ Infrastructure Monitoring
- AWS resource inventory (EC2, RDS, S3, Lambda, VPC, CloudFront, ELB)
- Monthly cost breakdown: **$1,675 total** across 12 resources
- Resource status monitoring (Running, Stopped, Terminated)
- Filter by resource type for focused analysis
- Service-to-infrastructure mapping

![Infrastructure](docs/screenshots/04-infrastructure.png)

### 👥 Team Management & System Health
- Team-based service ownership
- Member management and Slack integration
- System health monitoring (API, Database, Frontend)
- Service uptime tracking and alerts

### ✅ Production-Grade Form Validation
- **Comprehensive Zod Schemas** - Type-safe validation for all forms
- **Real-time Validation** - Instant feedback as users type
- **Beautiful Error Messages** - Clear, actionable validation errors
- **Service Creation Form** - Create services with team selection, templates, GitHub integration
- **Deployment Form** - Deploy to any environment with AWS region selection
- **Infrastructure Form** - Track AWS resources with cost estimates
- **Loading States** - Smooth loading indicators with toast notifications
- **Graceful Error Handling** - User-friendly error messages throughout

---

## 🏗️ Architecture

### Monorepo Structure
```
devcontrol/
├── backend/              # Express.js + TypeScript API
│   ├── src/
│   │   ├── config/      # Database & environment config
│   │   ├── controllers/ # Business logic handlers
│   │   ├── middleware/  # Auth, CORS, error handling
│   │   ├── repositories/# Data access layer (Repository Pattern)
│   │   ├── routes/      # API route definitions
│   │   ├── validators/  # Zod validation schemas
│   │   ├── utils/       # Custom error classes
│   │   └── server.ts    # Express app entry point
│   ├── package.json
│   └── tsconfig.json
├── app/                 # Next.js 15 App Router
├── components/          # React components
│   ├── layout/         # Navigation, headers
│   ├── ui/             # Shadcn components
│   └── error-boundary.tsx
├── lib/                 # Frontend utilities
│   └── services/       # API client layer
├── database/            # PostgreSQL setup
│   ├── migrations/     # Schema migrations
│   └── seeds/          # Sample data
└── package.json         # Root workspace config
```

### Tech Stack

**Frontend:**
- **Next.js 15** - App Router with React Server Components
- **React 19** - Latest features and performance
- **TypeScript 5** - Strict type safety
- **Tailwind CSS v4** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **React Query** - Server state management
- **Zustand** - Client state management
- **cmdk** - Command palette (⌘K)
- **sonner** - Toast notifications
- **date-fns** - Date formatting

**Backend:**
- **Express.js** - Fast, minimal web framework
- **TypeScript** - End-to-end type safety
- **PostgreSQL** - Relational database
- **Node.js 20+** - Runtime
- **Zod** - Schema validation
- **Repository Pattern** - Clean architecture
- **Custom Error Classes** - Production error handling

**DevOps:**
- **Docker** - PostgreSQL containerization
- **npm workspaces** - Monorepo management
- **Concurrent** - Run frontend + backend simultaneously

---

## 🎯 What's New in v2.0

### Week 1: Real Data Integration & Error Handling ✅
- ✅ **Production Error Handling** - Custom error classes (ValidationError, NotFoundError, DatabaseError)
- ✅ **Backend Validation** - Zod schemas validate all API requests
- ✅ **React Error Boundaries** - Graceful degradation on component failures
- ✅ **Service Name Resolution** - Proper SQL JOINs (displays "ml-service" not "eeeeeeee")
- ✅ **Loading States** - Skeleton screens prevent layout shift
- ✅ **Mobile First** - Responsive tables with horizontal scroll

### Week 2: Vercel-Inspired UI Transformation ✅
- ✅ **Horizontal Navigation** - Modern top nav (killed the sidebar!)
- ✅ **Command Palette (⌘K)** - Instant search across services, deployments, infrastructure
- ✅ **Quick Actions Dropdown** - "+" button for rapid resource creation
- ✅ **Enhanced Empty States** - Beautiful illustrations with clear CTAs
- ✅ **Improved Typography** - Larger headings, better spacing, readable text
- ✅ **Smooth Animations** - Polished transitions and hover effects
- ✅ **Toast Notifications** - Real-time user feedback with sonner

**Impact:** 2000+ lines of production code, 8 new components, enterprise-grade UX

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+**
- **Docker** (for PostgreSQL)
- **npm or yarn**

### Installation
```bash
# 1. Clone the repository
git clone https://github.com/GoddeyUwamari/devcontrol.git
cd devcontrol

# 2. Install dependencies (root + backend)
npm install

# 3. Start PostgreSQL with Docker
docker run -d \
  --name devcontrol-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=devcontrol \
  -p 5432:5432 \
  postgres:14

# 4. Run database migrations
node database/migrate.js

# 5. (Optional) Load sample data
psql -h localhost -U postgres -d devcontrol -f database/seeds/001_platform_seed.sql

# 6. Start both frontend and backend
npm run dev
```

**Your portal is now running:**
- 🌐 Frontend: http://localhost:3010
- 🔌 Backend API: http://localhost:8080
- ❤️ Health check: http://localhost:8080/health

### Development Commands
```bash
# Start both services (recommended)
npm run dev

# Start frontend only
npm run dev:frontend

# Start backend only
npm run dev:backend

# Build for production
npm run build

# Run production servers
npm start
```

---

## 📡 API Reference

### Services API
```
GET    /api/services              # List all services with filters
POST   /api/services              # Create new service
GET    /api/services/:id          # Get service details
PUT    /api/services/:id          # Update service
DELETE /api/services/:id          # Delete service
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "ml-service",
      "template": "microservices",
      "owner": "sarah@company.com",
      "status": "active",
      "github_url": "https://github.com/company/ml-service"
    }
  ]
}
```

### Deployments API
```
GET    /api/deployments           # List deployment history
POST   /api/deployments           # Record new deployment
GET    /api/deployments/:id       # Deployment details
DELETE /api/deployments/:id       # Delete deployment record
```

### Infrastructure API
```
GET    /api/infrastructure        # List AWS resources
POST   /api/infrastructure        # Add infrastructure resource
GET    /api/infrastructure/costs  # Cost breakdown analysis
```

**Cost Breakdown Response:**
```json
{
  "success": true,
  "data": {
    "total_monthly_cost": 1675.00,
    "by_service": [...],
    "by_resource_type": [...],
    "by_team": [...]
  }
}
```

### Platform Stats API
```
GET    /api/platform/stats/dashboard  # Dashboard metrics
```

### Teams API
```
GET    /api/teams                 # List all teams
GET    /api/teams/:id/services    # Get team's services
POST   /api/teams                 # Create new team
```

---

## 🗄️ Database Schema
```sql
-- Teams (Organization units)
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  owner VARCHAR(255) NOT NULL,
  members TEXT[],
  slack_channel VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Services (Microservices catalog)
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  template VARCHAR(50) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  team_id UUID REFERENCES teams(id),
  github_url TEXT,
  status VARCHAR(50) DEFAULT 'active',
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Deployments (Deployment history)
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  environment VARCHAR(50) NOT NULL,
  aws_region VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  cost_estimate DECIMAL(10,2) DEFAULT 0.00,
  deployed_by VARCHAR(255) NOT NULL,
  deployed_at TIMESTAMP DEFAULT NOW(),
  resources JSONB
);

-- Infrastructure Resources (AWS inventory)
CREATE TABLE infrastructure_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  aws_id VARCHAR(255) NOT NULL,
  aws_region VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  cost_per_month DECIMAL(10,2) DEFAULT 0.00,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔗 Integration with Platform CLI

Seamless integration with the [Platform Engineering Toolkit](https://github.com/GoddeyUwamari/platform-engineering-toolkit):
```bash
# CLI creates service → DevControl tracks it
platform create api my-service --github

# CLI deploys → DevControl records deployment
platform deploy aws my-service --env production

# DevControl automatically displays:
# ✅ Service in catalog
# ✅ Deployment in history
# ✅ AWS resources in infrastructure
# ✅ Costs in dashboard
```

---

## 📸 Screenshots

### Command Palette (⌘K)
Press Cmd+K to instantly search across all resources
![Command Palette](docs/screenshots/command-palette.png)

### Dashboard
Real-time metrics and recent deployments
![Dashboard](docs/screenshots/01-dashboard.png)

### Service Catalog
All services with templates, owners, and GitHub links
![Services](docs/screenshots/02-services.png)

### Deployment History
Track deployments across dev, staging, and production
![Deployments](docs/screenshots/03-deployments.png)

### Infrastructure Monitoring
AWS resources with cost breakdown ($1,675/month)
![Infrastructure](docs/screenshots/04-infrastructure.png)

### Teams & Monitoring
Team management and system health
![Teams](docs/screenshots/05-teams.png)
![Monitoring](docs/screenshots/06-monitoring.png)

---

## 💼 For Businesses

Need help implementing DevControl for your team?

**Services Offered:**
- 📞 **Free Consultation** - 30-minute discovery call
- 💻 **Custom Implementation** - Starting at $5,000
- 🎓 **Team Training** - $2,000/day workshop
- 🏢 **Enterprise Support** - Custom SLA, priority fixes
- 🔧 **Custom Development** - $150/hour for modifications

**Contact:**  
📧 projectmanager@wayuptechn.com  
📞 +1 (848) 228-9890  
🔗 [Schedule a Call](https://calendly.com/goddeyuwamari)  
💼 [WayUP Technology](https://wayuptechn.com)

---

## 🤝 Contributing

Contributions welcome! This project follows standard open-source practices.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 📚 Documentation

- **[API Documentation](docs/API.md)** - Complete REST API reference with examples
- **[Contributing Guide](CONTRIBUTING.md)** - Guidelines for contributing to DevControl
- **[Architecture Overview](#architecture)** - System design and technical decisions

---

## 👤 Author

**Goddey Uwamari**

- 🏢 Founder & CEO, [WayUP Technology](https://wayuptechn.com)
- 💼 Senior Full-Stack & Platform Engineer
- 🎯 Building open-source developer tools
- 🌐 GitHub: [@GoddeyUwamari](https://github.com/GoddeyUwamari)
- 🔗 LinkedIn: [Goddey Uwamari](https://www.linkedin.com/in/goddey-uwamari)
- 📧 Email: projectmanager@wayuptechn.com
- 📞 Phone: +1 (848) 228-9890
- 📍 Location: Newark, NJ (NYC Metro)

---

## 🙏 Acknowledgments

- **Design Inspiration:** [Vercel](https://vercel.com), [Backstage](https://backstage.io), [Grafana](https://grafana.com)
- **Built With:** Next.js 15, React 19, Express.js, PostgreSQL
- **UI Components:** Shadcn UI, Radix UI, Tailwind CSS
- **Influenced By:** Modern platform engineering practices and developer experience principles

---

## 🔗 Related Projects

- **[Platform Engineering Toolkit](https://github.com/GoddeyUwamari/platform-engineering-toolkit)** - CLI tool for automated service creation, GitHub integration, and AWS deployment with Terraform

---

## ⭐ Show Your Support

If DevControl helped you, please:

- ⭐ **Star this repository**
- 🐦 **Share on Twitter/LinkedIn**
- 💬 **Provide feedback** via issues
- 🤝 **Contribute** improvements

---

<div align="center">

**Built with ❤️ by platform engineers, for platform engineers**

[⬆ Back to Top](#devcontrol)

</div>
```
## AWS Cost Explorer Integration (Optional)

DevControl can fetch real-time infrastructure costs from AWS Cost Explorer.

### Setup Instructions

1. **Enable Cost Explorer in AWS Console:**
   - Visit: https://console.aws.amazon.com/cost-management/
   - Click "Enable Cost Explorer"
   - Wait 24 hours for data population

2. **Create IAM User or Use Existing:**
   - Go to IAM → Users
   - Attach policy: `CostExplorerReadOnlyAccess`
   - Or create custom policy with `ce:GetCostAndUsage` permission

3. **Configure Environment Variables:**
```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your AWS credentials
```

4. **Add AWS Credentials to `.env`:**
```env
   AWS_ACCESS_KEY_ID=your_key
   AWS_SECRET_ACCESS_KEY=your_secret
   AWS_REGION=us-east-1
   AWS_ACCOUNT_ID=123456789012
```

5. **Restart Backend:**
```bash
   npm run dev:backend
```

### Graceful Fallback

If AWS credentials are not configured or Cost Explorer is not enabled, DevControl automatically falls back to database costs. The application remains fully functional.

### Costs

AWS Cost Explorer charges $0.01 per API request. With hourly syncs, expect ~$7/month.

