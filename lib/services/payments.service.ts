import api, { handleApiResponse } from '../api';
import type {
  Payment,
  PaymentIntent,
  Refund,
  PaymentStats,
  RefundStats,
  PaymentFilters,
  CreatePaymentIntentPayload,
  CreateRefundPayload,
  ApiResponse,
} from '../types';

export const paymentsService = {
  // Get all payments with filters
  getAll: async (filters?: PaymentFilters): Promise<Payment[]> => {
    const params = new URLSearchParams();

    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.minAmount) params.append('minAmount', filters.minAmount.toString());
    if (filters?.maxAmount) params.append('maxAmount', filters.maxAmount.toString());
    if (filters?.search) params.append('search', filters.search);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const queryString = params.toString();
    const url = `/api/payments${queryString ? `?${queryString}` : ''}`;

    const response = await api.get<ApiResponse<Payment[]>>(url);
    return handleApiResponse(response);
  },

  // Get payment by ID
  getById: async (id: string): Promise<Payment> => {
    const response = await api.get<ApiResponse<Payment>>(`/api/payments/${id}`);
    return handleApiResponse(response);
  },

  // Get payment statistics
  getStats: async (): Promise<PaymentStats> => {
    const response = await api.get<ApiResponse<PaymentStats>>('/api/payments/stats');
    return handleApiResponse(response);
  },

  // Create payment intent
  createIntent: async (data: CreatePaymentIntentPayload): Promise<PaymentIntent> => {
    const response = await api.post<ApiResponse<PaymentIntent>>('/api/payments/intents', data);
    return handleApiResponse(response);
  },

  // Confirm payment intent
  confirmIntent: async (id: string): Promise<PaymentIntent> => {
    const response = await api.post<ApiResponse<PaymentIntent>>(`/api/payments/intents/${id}/confirm`);
    return handleApiResponse(response);
  },

  // Cancel payment intent
  cancelIntent: async (id: string): Promise<PaymentIntent> => {
    const response = await api.post<ApiResponse<PaymentIntent>>(`/api/payments/intents/${id}/cancel`);
    return handleApiResponse(response);
  },
};

// Payment methods are managed entirely through the Stripe Customer Portal
// (see app/(app)/payment-methods/page.tsx and lib/services/stripe.service.ts's
// openCustomerPortal) -- there is deliberately no paymentMethodsService here.
// It previously called /api/payment-methods endpoints that never existed on
// the backend, backing a form that collected raw card numbers and CVCs
// client-side with nowhere real to send them. Removed rather than
// implemented: DevControl does not process card data itself.

export interface RefundFilters {
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export const refundsService = {
  // Get all refunds
  getAll: async (filters?: RefundFilters): Promise<Refund[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.search) params.append('search', filters.search);

    const queryString = params.toString();
    const url = `/api/refunds${queryString ? `?${queryString}` : ''}`;

    const response = await api.get<ApiResponse<Refund[]>>(url);
    return handleApiResponse(response);
  },

  // Create refund
  create: async (data: CreateRefundPayload): Promise<Refund> => {
    try {
      const response = await api.post<ApiResponse<Refund>>('/api/refunds', data);
      return handleApiResponse(response);
    } catch (error: any) {
      // Surface the backend's specific validation/authorization message
      // (e.g. "Refund amount exceeds the refundable balance...") rather
      // than axios's generic "Request failed with status code 4xx" --
      // handleApiResponse never sees the response body here since axios
      // rejects non-2xx responses before that helper runs.
      const message = error.response?.data?.error || error.message || 'Failed to issue refund';
      throw new Error(message);
    }
  },

  // Get refund statistics
  getStats: async (): Promise<RefundStats> => {
    const response = await api.get<ApiResponse<RefundStats>>('/api/refunds/stats');
    return handleApiResponse(response);
  },
};
