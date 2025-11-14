import api, { handleApiResponse } from '../api';
import type { User, ApiResponse } from '../types';

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export const userService = {
  // Get current user profile
  getProfile: async (): Promise<User> => {
    const response = await api.get<ApiResponse<User>>('/api/auth/me');
    return handleApiResponse(response);
  },

  // Update user profile
  updateProfile: async (data: UpdateProfilePayload): Promise<User> => {
    const response = await api.patch<ApiResponse<User>>('/api/auth/profile', data);
    return handleApiResponse(response);
  },

  // Change password
  changePassword: async (data: ChangePasswordPayload): Promise<void> => {
    const response = await api.post<ApiResponse<void>>('/api/auth/change-password', data);
    return handleApiResponse(response);
  },
};
