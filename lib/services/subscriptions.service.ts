import api, { handleApiResponse } from '../api';
import type {
  Subscription,
  CreateSubscriptionPayload,
  UpdateSubscriptionPayload,
  ApiResponse,
} from '../types';

export const subscriptionsService = {
  // Get all subscriptions
  getAll: async (): Promise<Subscription[]> => {
    const response = await api.get<ApiResponse<Subscription[]>>('/api/billing/subscriptions');
    return handleApiResponse(response);
  },

  // Get subscription by ID
  getById: async (id: string): Promise<Subscription> => {
    const response = await api.get<ApiResponse<Subscription>>(`/api/billing/subscriptions/${id}`);
    return handleApiResponse(response);
  },

  // Get subscription with plan details
  getWithPlan: async (id: string): Promise<Subscription> => {
    const response = await api.get<ApiResponse<Subscription>>(`/api/billing/subscriptions/${id}/with-plan`);
    return handleApiResponse(response);
  },

  // Create new subscription
  create: async (data: CreateSubscriptionPayload): Promise<Subscription> => {
    const response = await api.post<ApiResponse<Subscription>>('/api/billing/subscriptions', data);
    return handleApiResponse(response);
  },

  // Update subscription
  update: async (id: string, data: UpdateSubscriptionPayload): Promise<Subscription> => {
    const response = await api.patch<ApiResponse<Subscription>>(`/api/billing/subscriptions/${id}`, data);
    return handleApiResponse(response);
  },

  // Cancel subscription
  cancel: async (id: string, immediately = false): Promise<Subscription> => {
    const response = await api.post<ApiResponse<Subscription>>(
      `/api/billing/subscriptions/${id}/cancel`,
      { immediately }
    );
    return handleApiResponse(response);
  },

  // Renew subscription
  renew: async (id: string): Promise<Subscription> => {
    const response = await api.post<ApiResponse<Subscription>>(`/api/billing/subscriptions/${id}/renew`);
    return handleApiResponse(response);
  },

  // Suspend subscription
  suspend: async (id: string): Promise<Subscription> => {
    const response = await api.post<ApiResponse<Subscription>>(`/api/billing/subscriptions/${id}/suspend`);
    return handleApiResponse(response);
  },

  // Reactivate subscription
  reactivate: async (id: string): Promise<Subscription> => {
    const response = await api.post<ApiResponse<Subscription>>(`/api/billing/subscriptions/${id}/reactivate`);
    return handleApiResponse(response);
  },

  // Change plan
  changePlan: async (id: string, newPlanId: string): Promise<Subscription> => {
    const response = await api.post<ApiResponse<Subscription>>(
      `/api/billing/subscriptions/${id}/change-plan`,
      { newPlanId }
    );
    return handleApiResponse(response);
  },
};
