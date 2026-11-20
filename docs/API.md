# DevControl API Documentation

**Base URL:** `http://localhost:8080` (development)

**Version:** 1.0.0

## Table of Contents

- [Authentication](#authentication)
- [Services API](#services-api)
- [Deployments API](#deployments-api)
- [Infrastructure API](#infrastructure-api)
- [Teams API](#teams-api)
- [Platform Stats API](#platform-stats-api)
- [DORA Metrics API](#dora-metrics-api)
- [Error Handling](#error-handling)

---

## Authentication

**Status:** Not yet implemented

Future versions will include authentication via:
- JWT tokens
- API keys for programmatic access

---

## Services API

Manage platform services and applications.

### List All Services

```http
GET /api/services
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `active`, `inactive`, `deploying`, `failed` |
| `template` | string | Filter by template: `api`, `frontend`, `worker`, `database` |
| `team_id` | UUID | Filter by team ID |

**Example Request:**
```bash
curl http://localhost:8080/api/services?status=active
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "user-api",
      "template": "api",
      "owner": "john.doe@example.com",
      "team_id": "660e8400-e29b-41d4-a716-446655440000",
      "github_url": "https://github.com/company/user-api",
      "status": "active",
      "description": "User management API service",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Get Service by ID

```http
GET /api/services/:id
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | Service ID |

**Example Request:**
```bash
curl http://localhost:8080/api/services/550e8400-e29b-41d4-a716-446655440000
```

### Create Service

```http
POST /api/services
```

**Request Body:**
```json
{
  "name": "user-api",
  "template": "api",
  "owner": "john.doe@example.com",
  "team_id": "660e8400-e29b-41d4-a716-446655440000",
  "github_url": "https://github.com/company/user-api",
  "description": "User management API service"
}
```

**Validation Rules:**
- `name`: Required, 1-255 characters
- `template`: Required, must be one of: `api`, `frontend`, `worker`, `database`
- `owner`: Required, valid email address
- `team_id`: Required, valid UUID
- `github_url`: Optional, valid URL
- `description`: Optional, max 500 characters

**Example Request:**
```bash
curl -X POST http://localhost:8080/api/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "user-api",
    "template": "api",
    "owner": "john.doe@example.com",
    "team_id": "660e8400-e29b-41d4-a716-446655440000"
  }'
```

### Update Service

```http
PUT /api/services/:id
```

**Request Body:**
```json
{
  "name": "user-api-v2",
  "status": "active",
  "github_url": "https://github.com/company/user-api-v2",
  "description": "Updated user management API"
}
```

**Note:** All fields are optional in updates.

### Delete Service

```http
DELETE /api/services/:id
```

---

## Deployments API

Track service deployments across environments.

### List All Deployments

```http
GET /api/deployments
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `service_id` | UUID | Filter by service |
| `environment` | string | Filter by environment: `development`, `staging`, `production` |
| `status` | string | Filter by status: `running`, `stopped`, `deploying`, `failed` |
| `limit` | integer | Limit results (1-100) |
| `offset` | integer | Offset for pagination |

**Example Request:**
```bash
curl http://localhost:8080/api/deployments?environment=production&limit=10
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "service_id": "550e8400-e29b-41d4-a716-446655440000",
      "service_name": "user-api",
      "environment": "production",
      "aws_region": "us-east-1",
      "status": "running",
      "cost_estimate": 125.50,
      "deployed_by": "john.doe@example.com",
      "deployed_at": "2024-01-20T14:30:00Z",
      "resources": {
        "ec2": ["i-1234567890abcdef0"],
        "rds": ["mydb-instance"]
      },
      "created_at": "2024-01-20T14:30:00Z",
      "updated_at": "2024-01-20T14:30:00Z"
    }
  ]
}
```

### Get Deployment by ID

```http
GET /api/deployments/:id
```

### Record a Deployment

```http
POST /api/deployments
```

Records a deployment **that has already happened**. DevControl does not deploy anything: this endpoint only stores the record, and the Deployments page, the deployment stats and the DORA metrics count it.

**Who can call it:** a signed-in user (Bearer access token) whose current role in the organization is `owner`, `admin` or `member`. A `viewer` gets `403`. The organization is always the caller's own; any `organization_id` in the body is ignored. The plan's monthly limit of recorded deployments applies (`402` when it is reached).

**Request Body:**
```json
{
  "service_id": "550e8400-e29b-41d4-a716-446655440000",
  "environment": "production",
  "status": "success",
  "aws_region": "us-east-1",
  "version": "v2.4.1"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `service_id` | One of `service_id` / `service_name` | UUID of a service already registered in the caller's organization. |
| `service_name` (or `serviceName`) | One of `service_id` / `service_name` | Name of a service already registered in the caller's organization (matched case-insensitively). Used only when `service_id` is absent. |
| `environment` | Yes | `development`, `staging` or `production`. |
| `status` | No | `success` or `failed`: how the deployment ended. Any other value is `400` (`Invalid status: use 'success' or 'failed'.`). |
| `aws_region` (or `region`) | No | AWS region format, e.g. `us-east-1`. Defaults to `us-east-1`. |
| `version` | No | Up to 100 characters; stored as `resources.version`. |
| `resources` | No | JSON object. |
| `cost_estimate` | No | Non-negative number. Absent or `0` is stored as not recorded (`null`). |

**When `status` is omitted** the row is stored as `deploying`, as it was before `status` was accepted. Nothing ever completes such a row: it shows as "In progress" for two hours and then "No completion recorded", and it is not counted as succeeded or failed. To record an outcome, send `status`.

**Set by the server, never by the caller:**
- `deployed_by` is the signed-in user's email. A `deployed_by` in the body is accepted and ignored.
- `deployed_at` is the time of the request. A `deployed_at` in the body is ignored: a deployment can't be back-dated or future-dated.
- `metadata` is `{ "source": "manual" }`. A `metadata` object in the body is ignored. (Rows from the GitHub Actions webhook carry `"source": "github_actions"`.)

**The service must already exist.** An unknown `service_id` or name, or a service of another organization, is `400` with `Choose an existing service.`; no service is created and nothing is recorded. With neither `service_id` nor a name: `400` `Choose a service.`

**Responses:**
- `201` `{ "success": true, "data": { …the stored row… }, "message": "Deployment recorded" }` (`"Deployment created successfully"` when `status` was omitted).
- `400` `{ "success": false, "error": "<reason>" }` for the cases above or an invalid field.
- `401` not signed in; `403` viewer; `402` plan limit reached.
- `500` `{ "success": false, "error": "The deployment could not be recorded." }`.

### Delete Deployment

```http
DELETE /api/deployments/:id
```

---

## Infrastructure API

Manage AWS infrastructure resources.

### List All Resources

```http
GET /api/infrastructure
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `service_id` | UUID | Filter by service |
| `resource_type` | string | Filter by type: `ec2`, `rds`, `vpc`, `s3`, `lambda`, `cloudfront`, `elb` |
| `status` | string | Filter by status: `running`, `stopped`, `terminated`, `pending` |
| `aws_region` | string | Filter by AWS region |

**Example Request:**
```bash
curl http://localhost:8080/api/infrastructure?resource_type=ec2&status=running
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "service_id": "550e8400-e29b-41d4-a716-446655440000",
      "service_name": "user-api",
      "resource_type": "ec2",
      "aws_id": "i-1234567890abcdef0",
      "aws_region": "us-east-1",
      "status": "running",
      "cost_per_month": 75.00,
      "metadata": {
        "instance_type": "t3.medium",
        "availability_zone": "us-east-1a"
      },
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Get Resource by ID

```http
GET /api/infrastructure/:id
```

### Create Infrastructure Resource

```http
POST /api/infrastructure
```

**Request Body:**
```json
{
  "service_id": "550e8400-e29b-41d4-a716-446655440000",
  "resource_type": "ec2",
  "aws_id": "i-1234567890abcdef0",
  "aws_region": "us-east-1",
  "status": "running",
  "cost_per_month": 75.00,
  "metadata": {
    "instance_type": "t3.medium"
  }
}
```

**Validation Rules:**
- `service_id`: Required, valid UUID
- `resource_type`: Required, must be one of: `ec2`, `rds`, `vpc`, `s3`, `lambda`, `cloudfront`, `elb`
- `aws_id`: Required, string
- `aws_region`: Required, valid AWS region format
- `status`: Required, must be: `running`, `stopped`, or `terminated`
- `cost_per_month`: Required, non-negative number
- `metadata`: Optional, JSON object

### Get Cost Breakdown

```http
GET /api/infrastructure/costs
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "total_monthly_cost": 450.00,
    "by_service": [
      {
        "service_name": "user-api",
        "cost": 175.00
      },
      {
        "service_name": "payment-service",
        "cost": 275.00
      }
    ],
    "by_resource_type": [
      {
        "resource_type": "ec2",
        "cost": 250.00
      },
      {
        "resource_type": "rds",
        "cost": 200.00
      }
    ],
    "by_team": [
      {
        "team_name": "Backend Team",
        "cost": 300.00
      }
    ]
  }
}
```

### Delete Resource

```http
DELETE /api/infrastructure/:id
```

---

## Teams API

Manage development teams.

### List All Teams

```http
GET /api/teams
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "Backend Team",
      "description": "Handles all backend services",
      "owner": "team-lead@example.com",
      "members": [
        "dev1@example.com",
        "dev2@example.com"
      ],
      "slack_channel": "#backend-team",
      "created_at": "2024-01-10T09:00:00Z",
      "updated_at": "2024-01-10T09:00:00Z"
    }
  ]
}
```

### Get Team by ID

```http
GET /api/teams/:id
```

### Create Team

```http
POST /api/teams
```

**Request Body:**
```json
{
  "name": "Backend Team",
  "description": "Handles all backend services",
  "owner": "team-lead@example.com",
  "members": ["dev1@example.com"],
  "slack_channel": "#backend-team"
}
```

**Validation Rules:**
- `name`: Required, 1-255 characters
- `owner`: Required, valid email
- `description`: Optional, max 500 characters
- `members`: Optional, array of email strings
- `slack_channel`: Optional, string

### Update Team

```http
PUT /api/teams/:id
```

### Delete Team

```http
DELETE /api/teams/:id
```

### Get Team's Services

```http
GET /api/teams/:id/services
```

Returns all services owned by the team.

---

## Platform Stats API

Get dashboard statistics and metrics.

### Get Dashboard Stats

```http
GET /api/platform/stats
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "totalServices": 12,
    "servicesChange": 5.5,
    "activeDeployments": 8,
    "deploymentsChange": 10.2,
    "monthlyAwsCost": 1250.00,
    "costChange": -3.5,
    "totalTeams": 4,
    "teamsChange": 0
  }
}
```

**Response Fields:**
- `totalServices`: Total number of services
- `servicesChange`: Percentage change vs. last month
- `activeDeployments`: Number of running deployments
- `deploymentsChange`: Percentage change vs. last month
- `monthlyAwsCost`: Total AWS costs (USD)
- `costChange`: Percentage change vs. last month
- `totalTeams`: Number of teams
- `teamsChange`: Percentage change vs. last month

---

## DORA Metrics API

### Get DORA Metrics

```http
GET /api/metrics/dora?date_range=30d
```

Requires the `doraMetrics` plan entitlement. Always scoped to the authenticated organization; an organization in the query string is ignored.

**Query Parameters** (an invalid value is a `400` with a plain `error` message; database error text is never returned):
- `date_range`: `7d` | `30d` | `90d` (default `30d`), called N below
- `service_id`: a service UUID (absent = all services)
- `team_id`: a team UUID (absent = all teams)
- `environment`: `all` | `development` | `staging` | `production` (absent or `all` = all environments)

**Windows.** One `now` is captured per request. Both windows are N × 24 h and half-open: current `[now − N×24h, now)`, previous `[now − 2N×24h, now − N×24h)`. A deployment is in at most one. "Finished" means status `success` or `failed`; `deploying` and unknown statuses never count.

**Response Fields** (`data`; `0` never stands for "unavailable"):
- `deploymentFrequency.value`: successful ÷ N, 2 dp. **Null when nothing finished** in the period. `benchmark` is null whenever `value` is null.
- `changeFailureRate.value`: failed ÷ finished × 100, 2 dp. Null when nothing finished.
- `deploymentFrequency.benchmark`, `changeFailureRate.benchmark`: `elite` | `high` | `medium` | `low`, from `bands` (or from the organization's custom target on Enterprise, `isCustomBenchmark: true`).
- `leadTime`, `mttr`: `{ tracked: false, reason }`.
- `deployments`: `{ successful, failed, finished }` for the current period.
- `period`: `{ start, end, days, startAt, endAt }`. `start` / `end` are the first and last UTC dates the window touches; `startAt` (inclusive) and `endAt` (exclusive, = `now`) are ISO 8601.
- `previousPeriod`: the same bounds for the previous window, plus `deployments`, `deploymentsPerDay` and `changeFailureRate` counted the same way (each rate null when the previous period has no finished deployment).
- `change`: `{ finishedPercent, deploymentsPerDayPercent, changeFailureRatePercent }`, relative change in percent (1 dp). Each is null unless both periods have finished deployments and the previous value is above 0. For a percentage-point change of the failure rate, use the two raw rates.
- `daily`: `[{ date, succeeded, failed, total, partial }]`, one entry for every UTC day (00:00–24:00 UTC) the current window touches, ascending and zero-filled: N + 1 days, the first and last `partial: true` (N whole days when `now` is exactly 00:00:00.000Z). The totals add up to `deployments.finished`.
- `busiestDay`: `{ date, total, succeeded, failed, partial, tiedDays }` for the day with the most finished deployments; on a tie the most recent tied day, with `tiedDays` counting all of them. Null when nothing finished.
- `filters`: `{ environment, serviceId, teamId }` as applied; null = all.
- `bands`: DevControl's standard comparison bands, `{ version, description, deploymentFrequency, changeFailureRate }`, each metric with `unit`, `direction` and `levels: [{ level, lower, upper, label }]` (`lower` / `upper` = `{ value, inclusive }` or null for open). Deployment frequency: elite > 1/day, high ≥ 0.14/day, medium ≥ 0.03/day, low below. Change failure rate: elite ≤ 5%, high ≤ 10%, medium ≤ 15%, low > 15%. They are informed by the DORA 2023 performance clusters and are directional benchmarks, not official DORA cutoffs.

---

## Error Handling

### Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed for the request",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address"
      }
    ]
  }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created successfully |
| `400` | Bad Request (validation error) |
| `404` | Not Found |
| `500` | Internal Server Error |

### Common Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request validation failed |
| `NOT_FOUND` | Resource not found |
| `DATABASE_ERROR` | Database operation failed |
| `INTERNAL_ERROR` | Unexpected server error |

---

## Rate Limiting

**Status:** Not yet implemented

Future versions will include rate limiting:
- 100 requests per minute per IP
- Authenticated users: 1000 requests per minute

---

## Pagination

For endpoints that return lists, use:

```http
GET /api/services?limit=20&offset=40
```

- `limit`: Number of items per page (default: 50, max: 100)
- `offset`: Number of items to skip

Response includes total count:
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 40
  }
}
```

---

## Changelog

### v1.0.0 (2025-01-15)
- Initial API release
- Services, Deployments, Infrastructure, Teams endpoints
- Platform statistics
- Cost tracking

---

## Support

- **GitHub Issues:** [github.com/GoddeyUwamari/devcontrol/issues](https://github.com/GoddeyUwamari/devcontrol/issues)
- **Email:** projectmanager@wayuptechn.com
- **Documentation:** Check `/docs` folder for additional guides

---

**Happy Building!** 🚀
