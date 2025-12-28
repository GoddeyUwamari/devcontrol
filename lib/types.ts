export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'BILLING_ADMIN' | 'USER' | 'VIEWER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

export interface User {
  id: string;
  email: string;
  tenantId: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: User;
    accessToken: string;
    sessionId: string;
    expiresIn: number;
  };
  message: string;
  timestamp: string;
}

export interface Tenant {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  tenantId: string;
  tenantName?: string;
  planId: string;
  plan?: string;
  status: 'active' | 'cancelled' | 'expired' | 'suspended' | 'past_due';
  billingCycle: 'monthly' | 'yearly';
  currentPrice: number;
  currency: string;
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingDate?: string;
  cancelledAt?: string;
  expiresAt?: string;
  autoRenew: boolean;
  isTrial: boolean;
  trialEndsAt?: string;
  amount?: number; // alias for currentPrice
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubscriptionPayload {
  tenantId: string;
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  currentPrice: number;
  currentPeriodEnd: string;
  currency?: string;
  startedAt?: string;
  autoRenew?: boolean;
  isTrial?: boolean;
  trialEndsAt?: string;
}

export interface UpdateSubscriptionPayload {
  billingCycle?: 'monthly' | 'yearly';
  currentPrice?: number;
  autoRenew?: boolean;
}

export interface Invoice {
  id: string;
  tenantId: string;
  tenantName?: string;
  subscriptionId?: string;
  invoiceNumber: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  amount?: number; // alias for totalAmount
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  paidAt?: string;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  pdfUrl?: string;
  pdfGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  itemType: 'subscription' | 'usage' | 'credit' | 'fee' | 'discount';
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number;
  taxAmount: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
}

export interface CreateInvoicePayload {
  tenantId: string;
  subscriptionId?: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  issueDate?: string;
  currency?: string;
  notes?: string;
}

export interface AddInvoiceItemPayload {
  description: string;
  itemType: 'subscription' | 'usage' | 'credit' | 'fee' | 'discount';
  quantity: number;
  unitPrice: number;
}

export interface RecordPaymentPayload {
  paymentAmount: number;
  paymentMethod: string;
  paymentReference?: string;
}

export interface DashboardStats {
  totalRevenue: number;
  revenueChange: number;
  activeSubscriptions: number;
  subscriptionsChange: number;
  totalInvoices: number;
  invoicesChange: number;
  activeTenants: number;
  tenantsChange: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

// Profile management
export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// Revenue timeline for chart
export interface RevenueTimelineData {
  date: string;
  revenue: number;
}

// Subscription actions
export interface ChangePlanPayload {
  newPlanId: string;
}

export interface CancelSubscriptionPayload {
  immediately?: boolean;
}

// Payment Management
export type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'cancelled' | 'refunded';

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string;
  paymentMethodType?: string;
  invoiceId?: string;
  customerId?: string;
  customerName?: string;
  transactionId: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethod {
  id: string;
  type: string;
  brand?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  customerId?: string;
  createdAt: string;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  clientSecret?: string;
  paymentMethodId?: string;
  customerId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentStats {
  totalAmount: number;
  totalCount: number;
  successfulCount: number;
  failedCount: number;
  refundedAmount: number;
}

export interface RefundStats {
  totalAmount: number;
  totalCount: number;
}

export interface PaymentFilters {
  status?: PaymentStatus;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreatePaymentIntentPayload {
  amount: number;
  currency?: string;
  paymentMethodId?: string;
  customerId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRefundPayload {
  paymentId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AddPaymentMethodPayload {
  type: string;
  cardNumber?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cvc?: string;
  customerId?: string;
}

export interface UpdatePaymentMethodPayload {
  expiryMonth?: number;
  expiryYear?: number;
}

// Monitoring & Health Check
export type ServiceStatus = 'healthy' | 'unhealthy' | 'degraded';
export type OverallSystemStatus = 'operational' | 'degraded' | 'disrupted';

// Actual backend response format (direct, not wrapped)
export interface BackendServiceHealth {
  status: string;
  responseTime: number;
}

export interface GatewayHealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  gateway: {
    status: string;
    memory?: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      unit: string;
    };
    cpu?: {
      user: number;
      system: number;
    };
  };
  services: {
    'auth-service'?: BackendServiceHealth;
    'billing-service'?: BackendServiceHealth;
    'payment-service'?: BackendServiceHealth;
    'notification-service'?: BackendServiceHealth;
    postgresql?: BackendServiceHealth;
    redis?: BackendServiceHealth;
  };
  checks: {
    duration: string;
    total: number;
    healthy: number;
    unhealthy: number;
  };
}

// Individual microservice health response (Auth, Billing, Payment, Notification)
export interface MicroserviceHealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
  service: string;
}

export interface ServiceHealth {
  name: string;
  url: string;
  port?: number;
  status: ServiceStatus;
  responseTime: number;
  uptime: number;
  lastCheck: string;
  version?: string;
  error?: string;
}

export interface SystemHealth {
  status: OverallSystemStatus;
  servicesUp: number;
  totalServices: number;
  healthPercentage: number;
  services: ServiceHealth[];
  lastUpdate: string;
}

// =====================================================
// PLATFORM ENGINEERING PORTAL TYPES
// =====================================================

// Service Types
export type ServiceTemplate = 'api' | 'microservices';
export type ServiceStatus = 'active' | 'inactive' | 'deploying' | 'failed';

export interface Service {
  id: string;
  name: string;
  template: ServiceTemplate;
  owner: string;
  teamId: string;
  githubUrl?: string;
  status: ServiceStatus;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServicePayload {
  name: string;
  template: ServiceTemplate;
  owner: string;
  teamId: string;
  githubUrl?: string;
  description?: string;
}

export interface UpdateServicePayload {
  name?: string;
  status?: ServiceStatus;
  githubUrl?: string;
  description?: string;
}

// Deployment Types
export type DeploymentEnvironment = 'development' | 'staging' | 'production';
export type DeploymentStatus = 'running' | 'stopped' | 'failed' | 'deploying';

export interface Deployment {
  id: string;
  serviceId: string;
  serviceName?: string; // Joined from services table
  environment: DeploymentEnvironment;
  awsRegion: string;
  status: DeploymentStatus;
  costEstimate: number;
  deployedBy: string;
  deployedAt: string;
  resources?: Record<string, unknown>;
  logs?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentPayload {
  serviceId: string;
  environment: DeploymentEnvironment;
  awsRegion: string;
  deployedBy: string;
  resources?: Record<string, unknown>;
}

// Infrastructure Types
export type ResourceType = 'ec2' | 'rds' | 'vpc' | 's3' | 'lambda' | 'cloudfront' | 'elb';
export type ResourceStatus = 'running' | 'stopped' | 'terminated' | 'pending';

export interface InfrastructureResource {
  id: string;
  serviceId: string;
  serviceName?: string; // Joined from services table
  resourceType: ResourceType;
  awsId: string;
  awsRegion: string;
  status: ResourceStatus;
  costPerMonth: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInfrastructurePayload {
  serviceId: string;
  resourceType: ResourceType;
  awsId: string;
  awsRegion: string;
  costPerMonth?: number;
  metadata?: Record<string, unknown>;
}

// Team Types
export interface Team {
  id: string;
  name: string;
  description?: string;
  members: string[];
  slackChannel?: string;
  owner: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamPayload {
  name: string;
  description?: string;
  members?: string[];
  slackChannel?: string;
  owner: string;
}

export interface UpdateTeamPayload {
  name?: string;
  description?: string;
  members?: string[];
  slackChannel?: string;
}

// Platform Dashboard Stats
export interface PlatformDashboardStats {
  totalServices: number;
  servicesChange: number;
  activeDeployments: number;
  deploymentsChange: number;
  monthlyAwsCost: number;
  costChange: number;
  totalTeams: number;
  teamsChange: number;
}

// Cost Metrics
export interface CostMetrics {
  totalMonthlyCost: number;
  costByService: Array<{
    serviceId: string;
    serviceName: string;
    cost: number;
  }>;
  costByResourceType: Array<{
    resourceType: ResourceType;
    cost: number;
    count: number;
  }>;
  costByRegion: Array<{
    region: string;
    cost: number;
  }>;
}

// Service Filters
export interface ServiceFilters {
  status?: ServiceStatus;
  template?: ServiceTemplate;
  owner?: string;
  search?: string;
}

// Deployment Filters
export interface DeploymentFilters {
  serviceId?: string;
  environment?: DeploymentEnvironment;
  status?: DeploymentStatus;
  startDate?: string;
  endDate?: string;
}

// Infrastructure Filters
export interface InfrastructureFilters {
  serviceId?: string;
  resourceType?: ResourceType;
  status?: ResourceStatus;
  awsRegion?: string;
}

// Cost Recommendations
export type RecommendationSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type RecommendationStatus = 'ACTIVE' | 'RESOLVED' | 'DISMISSED';

export interface CostRecommendation {
  id: string;
  resourceId: string;
  resourceName?: string;
  resourceType: string;
  issue: string;
  description?: string;
  potentialSavings: number;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  awsRegion?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface RecommendationStats {
  totalRecommendations: number;
  activeRecommendations: number;
  totalPotentialSavings: number;
  bySeverity: {
    high: number;
    medium: number;
    low: number;
  };
}

export interface AnalysisResult {
  recommendationsFound: number;
  totalPotentialSavings: number;
  bySeverity: {
    high: number;
    medium: number;
    low: number;
  };
}

// DORA Metrics Types
export type BenchmarkLevel = 'elite' | 'high' | 'medium' | 'low';
export type TrendDirection = 'improving' | 'stable' | 'declining';
export type DateRangeOption = '7d' | '30d' | '90d';

export interface DORAMetric {
  value: number;
  unit: string;
  benchmark: BenchmarkLevel;
  trend: TrendDirection;
  breakdown?: { [key: string]: number };
  description?: string;
}

export interface DORAMetricsData {
  deploymentFrequency: DORAMetric;
  leadTime: DORAMetric;
  changeFailureRate: DORAMetric;
  mttr: DORAMetric;
  period: {
    start: string;
    end: string;
    days: number;
  };
}

export interface DORAMetricsResponse {
  success: boolean;
  data: DORAMetricsData;
}

export interface DORAMetricsFilters {
  dateRange?: DateRangeOption;
  serviceId?: string;
  teamId?: string;
  environment?: string;
}
