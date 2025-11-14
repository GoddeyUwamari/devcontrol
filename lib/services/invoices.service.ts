import api, { handleApiResponse } from '../api';
import type {
  Invoice,
  InvoiceWithItems,
  CreateInvoicePayload,
  AddInvoiceItemPayload,
  RecordPaymentPayload,
  ApiResponse,
} from '../types';

export const invoicesService = {
  // Get all invoices
  getAll: async (): Promise<Invoice[]> => {
    const response = await api.get<ApiResponse<Invoice[]>>('/api/billing/invoices');
    return handleApiResponse(response);
  },

  // Get invoice by ID
  getById: async (id: string): Promise<Invoice> => {
    const response = await api.get<ApiResponse<Invoice>>(`/api/billing/invoices/${id}`);
    return handleApiResponse(response);
  },

  // Get invoice with line items
  getWithItems: async (id: string): Promise<InvoiceWithItems> => {
    const response = await api.get<ApiResponse<InvoiceWithItems>>(`/api/billing/invoices/${id}/items`);
    return handleApiResponse(response);
  },

  // Get invoice by invoice number
  getByNumber: async (invoiceNumber: string): Promise<Invoice> => {
    const response = await api.get<ApiResponse<Invoice>>(`/api/billing/invoices/number/${invoiceNumber}`);
    return handleApiResponse(response);
  },

  // Create new invoice
  create: async (data: CreateInvoicePayload): Promise<Invoice> => {
    const response = await api.post<ApiResponse<Invoice>>('/api/billing/invoices', data);
    return handleApiResponse(response);
  },

  // Add line item to invoice
  addItem: async (id: string, data: AddInvoiceItemPayload): Promise<Invoice> => {
    const response = await api.post<ApiResponse<Invoice>>(`/api/billing/invoices/${id}/items`, data);
    return handleApiResponse(response);
  },

  // Record payment
  recordPayment: async (id: string, data: RecordPaymentPayload): Promise<Invoice> => {
    const response = await api.post<ApiResponse<Invoice>>(`/api/billing/invoices/${id}/payment`, data);
    return handleApiResponse(response);
  },

  // Finalize draft invoice
  finalize: async (id: string): Promise<Invoice> => {
    const response = await api.post<ApiResponse<Invoice>>(`/api/billing/invoices/${id}/finalize`);
    return handleApiResponse(response);
  },

  // Void invoice
  void: async (id: string): Promise<Invoice> => {
    const response = await api.post<ApiResponse<Invoice>>(`/api/billing/invoices/${id}/void`);
    return handleApiResponse(response);
  },

  // Mark as uncollectible
  markUncollectible: async (id: string): Promise<Invoice> => {
    const response = await api.post<ApiResponse<Invoice>>(`/api/billing/invoices/${id}/uncollectible`);
    return handleApiResponse(response);
  },
};
