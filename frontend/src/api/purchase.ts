import request from './request';
import type { PurchaseRequest, PurchaseOffer, SubjectCategory, BookCondition } from '@/types';

export const createPurchaseRequest = (data: {
  bookTitle: string;
  author?: string;
  isbn?: string;
  expectedPrice?: number;
  conditions?: string[];
  description?: string;
  category: SubjectCategory;
  campus: string;
}) => {
  return request.post('/purchase-requests', data);
};

export const getPurchaseRequests = (params: {
  category?: SubjectCategory;
  campus?: string;
  page?: number;
  limit?: number;
}) => {
  return request.get<{ requests: PurchaseRequest[]; pagination: any }>('/purchase-requests', { params });
};

export const getPurchaseRequestById = (id: string) => {
  return request.get<PurchaseRequest>(`/purchase-requests/${id}`);
};

export const getMyPurchaseRequests = () => {
  return request.get<PurchaseRequest[]>('/my/purchase-requests');
};

export const closePurchaseRequest = (id: string) => {
  return request.put(`/purchase-requests/${id}/close`);
};

export const getPurchaseOffers = (requestId: string) => {
  return request.get<{ offers: PurchaseOffer[]; pendingCount: number; totalCount: number }>(
    `/purchase-requests/${requestId}/offers`,
  );
};

export const submitPurchaseOffer = (
  requestId: string,
  data: {
    price: number;
    condition: BookCondition;
    pickupLocation: string;
    expiresAt: string;
  },
) => {
  return request.post<{ message: string; offer: PurchaseOffer }>(
    `/purchase-requests/${requestId}/offers`,
    data,
  );
};

export const confirmPurchaseOffer = (requestId: string, offerId: string) => {
  return request.post<{ message: string; offer: PurchaseOffer }>(
    `/purchase-requests/${requestId}/offers/${offerId}/confirm`,
  );
};

export const withdrawPurchaseOffer = (requestId: string, offerId: string) => {
  return request.put(`/purchase-requests/${requestId}/offers/${offerId}/withdraw`);
};
