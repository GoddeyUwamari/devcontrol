export interface User {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
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
  planId: string;
  planName: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  amount: number;
  currency: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: string;
  dueDate: string;
  createdAt: string;
}

export interface DashboardStats {
  totalRevenue: number;
  activeSubscriptions: number;
  totalInvoices: number;
  activeTenants: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}
