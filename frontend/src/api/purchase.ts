import request from './request';
import type { PurchaseRequest, SubjectCategory, PurchaseOffer, OfferCondition } from '@/types';

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

export const getMyPurchaseRequests = () => {
  return request.get<PurchaseRequest[]>('/my/purchase-requests');
};

export const getPurchaseRequestById = (id: string) => {
  return request.get<PurchaseRequest & { offers: PurchaseOffer[] }>(`/purchase-requests/${id}`);
};

export const closePurchaseRequest = (id: string) => {
  return request.put(`/purchase-requests/${id}/close`);
};

export const submitOffer = (
  id: string,
  data: {
    price: number;
    condition: OfferCondition;
    pickupLocation: string;
    expireAt: string;
  },
) => {
  return request.post<{ message: string; offer: PurchaseOffer }>(`/purchase-requests/${id}/offers`, data);
};

export const withdrawOffer = (id: string, offerId: string) => {
  return request.put(`/purchase-requests/${id}/offers/${offerId}/withdraw`);
};

export const confirmOffer = (id: string, offerId: string) => {
  return request.put(`/purchase-requests/${id}/offers/${offerId}/confirm`);
};
