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
