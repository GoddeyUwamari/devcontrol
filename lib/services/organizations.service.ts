import { api } from "../api";

/**
 * Organization Types
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  description: string | null;
  subscriptionTier?: 'free' | 'starter' | 'pro' | 'enterprise';
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrganizationRequest {
  name: string;
  slug?: string;
  displayName?: string;
  description?: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  displayName?: string;
  description?: string;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "member" | "viewer";
  joinedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
  };
}

export interface InviteMemberRequest {
  email: string;
  role: "admin" | "member" | "viewer";
}

export interface UpdateMemberRoleRequest {
  role: "owner" | "admin" | "member" | "viewer";
}

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  accountId?: string;
}

/**
 * Organization Service
 * Handles all organization-related API calls
 */
export const organizationsService = {
  /**
   * Get all organizations for the current user
   */
  async getAll(): Promise<Organization[]> {
    const response = await api.get<{ success: boolean; data: Organization[] }>(
      "/api/organizations"
    );
    return response.data.data;
  },

  /**
   * Get a single organization by ID
   */
  async getById(id: string): Promise<Organization> {
    const response = await api.get<{ success: boolean; data: Organization }>(
      `/api/organizations/${id}`
    );
    return response.data.data;
  },

  /**
   * Create a new organization
   */
  async create(data: CreateOrganizationRequest): Promise<Organization> {
    const response = await api.post<{ success: boolean; data: Organization }>(
      "/api/organizations",
      data
    );
    return response.data.data;
  },

  /**
   * Update an organization
   */
  async update(
    id: string,
    data: UpdateOrganizationRequest
  ): Promise<Organization> {
    const response = await api.patch<{ success: boolean; data: Organization }>(
      `/api/organizations/${id}`,
      data
    );
    return response.data.data;
  },

  /**
   * Delete an organization
   */
  async delete(id: string): Promise<void> {
    await api.delete(`/api/organizations/${id}`);
  },

  /**
   * Switch to a different organization
   */
  async switch(organizationId: string): Promise<void> {
    await api.post("/api/organizations/switch", { organizationId });
  },

  /**
   * Get organization members
   */
  async getMembers(organizationId: string): Promise<OrganizationMember[]> {
    const response = await api.get<{
      success: boolean;
      data: OrganizationMember[];
    }>(`/api/organizations/${organizationId}/members`);
    return response.data.data;
  },

  /**
   * Invite a member to the organization
   */
  async inviteMember(
    organizationId: string,
    data: InviteMemberRequest
  ): Promise<void> {
    await api.post(`/api/organizations/${organizationId}/invite`, data);
  },

  /**
   * Accept an invitation
   */
  async acceptInvitation(
    organizationId: string,
    inviteId: string
  ): Promise<void> {
    await api.post(
      `/api/organizations/${organizationId}/invitations/${inviteId}/accept`
    );
  },

  /**
   * Update a member's role
   */
  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: UpdateMemberRoleRequest["role"]
  ): Promise<void> {
    await api.patch(
      `/api/organizations/${organizationId}/members/${userId}/role`,
      { role }
    );
  },

  /**
   * Remove a member from the organization
   */
  async removeMember(organizationId: string, userId: string): Promise<void> {
    await api.delete(`/api/organizations/${organizationId}/members/${userId}`);
  },

  /**
   * Save AWS credentials for the organization (encrypted)
   */
  async saveAWSCredentials(
    organizationId: string,
    credentials: AWSCredentials
  ): Promise<void> {
    await api.post(`/api/organizations/${organizationId}/aws-credentials`, {
      credentials,
    });
  },

  /**
   * Test AWS credentials
   */
  async testAWSCredentials(credentials: AWSCredentials): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await api.post<{
      success: boolean;
      data: { success: boolean; message: string };
    }>("/api/organizations/test-aws-credentials", { credentials });
    return response.data.data;
  },

  /**
   * Check if organization has AWS credentials configured
   */
  async hasAWSCredentials(organizationId: string): Promise<boolean> {
    try {
      const response = await api.get<{
        success: boolean;
        data: { hasCredentials: boolean };
      }>(`/api/organizations/${organizationId}/aws-credentials/status`);
      return response.data.data.hasCredentials;
    } catch {
      return false;
    }
  },
};
