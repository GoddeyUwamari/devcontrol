/**
 * User Preferences Service
 * Frontend service for managing user email preferences
 */

interface EmailPreferences {
  weeklySummary: boolean;
  anomalyAlerts: boolean;
  costAlerts: boolean;
  deploymentAlerts: boolean;
}

interface UpdatePreferencesResponse {
  success: boolean;
  data: EmailPreferences;
  message?: string;
}

class UserPreferencesService {
  private baseUrl = '/api/user/preferences';

  /**
   * Get user's current email preferences
   */
  async getEmailPreferences(): Promise<EmailPreferences> {
    const response = await fetch(`${this.baseUrl}/email`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getToken()}`
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to fetch email preferences');
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Update multiple email preferences at once
   */
  async updateEmailPreferences(
    preferences: Partial<EmailPreferences>
  ): Promise<EmailPreferences> {
    const response = await fetch(`${this.baseUrl}/email`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getToken()}`
      },
      body: JSON.stringify(preferences)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to update email preferences');
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Update a single email preference
   */
  async updateSinglePreference(
    key: keyof EmailPreferences,
    value: boolean
  ): Promise<EmailPreferences> {
    return this.updateEmailPreferences({ [key]: value });
  }

  /**
   * Get auth token from localStorage
   */
  private getToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('token') || '';
  }
}

export const userPreferencesService = new UserPreferencesService();
export type { EmailPreferences };
