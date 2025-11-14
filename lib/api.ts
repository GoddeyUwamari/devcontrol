import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ApiResponse } from './types';

const api = axios.create({
  baseURL: 'http://localhost:8080',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add Bearer token and X-Tenant-ID from localStorage
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');

    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add X-Tenant-ID header from user object
    if (userStr && config.headers) {
      try {
        const user = JSON.parse(userStr);
        if (user.tenantId) {
          config.headers['X-Tenant-ID'] = user.tenantId;
        }
      } catch (error) {
        console.error('Failed to parse user from localStorage:', error);
      }
    }

    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle 401 and 500 errors
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;

      // Handle 401 Unauthorized - clear auth and redirect to login
      if (status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('sessionId');
        localStorage.removeItem('user');

        // Only redirect if not already on login page
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }

      // Handle 500 Internal Server Error
      if (status === 500) {
        console.error('Server error:', error.response.data);
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// Type-safe API response helper
export const handleApiResponse = <T>(response: { data: ApiResponse<T> }): T => {
  if (!response.data.success) {
    throw new Error(response.data.message || 'API request failed');
  }
  return response.data.data;
};

// Helper function to get data from API
export const fetchData = async <T>(url: string): Promise<T> => {
  const response = await api.get<T>(url);
  return response.data;
};

// Helper function to post data to API
export const postData = async <T, D = any>(url: string, data: D): Promise<T> => {
  const response = await api.post<T>(url, data);
  return response.data;
};

// Helper function to update data via PATCH
export const patchData = async <T, D = any>(url: string, data: D): Promise<T> => {
  const response = await api.patch<T>(url, data);
  return response.data;
};

// Helper function to delete data
export const deleteData = async <T>(url: string): Promise<T> => {
  const response = await api.delete<T>(url);
  return response.data;
};
