import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { PurchaseRequest, SubjectCategory } from '../entities/PurchaseRequest';
import { PurchaseOffer, OfferStatus } from '../entities/PurchaseOffer';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  FAIL_REASON,
  sweepExpiredOffers,
  serializeOffer,
} from '../services/purchaseOffer.service';

const REQUESTER_SELECT = {
  id: true,
  name: true,
  department: true,
  avatarUrl: true,
  contactInfo: true,
} as const;

const SELLER_SELECT = {
  id: true,
  name: true,
  department: true,
  avatarUrl: true,
  contactInfo: true,
  positiveRatingRate: true,
  totalReviews: true,
} as const;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 统计一批求购当前仍有效的待选报价数（未过失效时间）
const attachPendingCounts = async (requests: PurchaseRequest[]) => {
  if (requests.length === 0) return;
  const offerRepository = AppDataSource.getRepository(PurchaseOffer);
  const rows = await offerRepository
    .createQueryBuilder('offer')
    .select('offer.purchaseRequestId', 'requestId')
    .addSelect('COUNT(1)', 'count')
    .where('offer.purchaseRequestId IN (:...ids)', { ids: requests.map((r) => r.id) })
    .andWhere('offer.status = :status', { status: 'pending' })
    .andWhere('offer.expireAt > :now', { now: new Date() })
    .groupBy('offer.purchaseRequestId')
    .getRawMany<{ requestId: string; count: string }>();

  const countMap = new Map(rows.map((row) => [row.requestId, Number(row.count)]));
  requests.forEach((request: any) => {
    request.pendingOfferCount = countMap.get(request.id) ?? 0;
  });
};

export const createPurchaseRequest = async (req: AuthenticatedRequest, res: Response) => {
  const {
    bookTitle,
    author,
    isbn,
    expectedPrice,
    conditions,
    description,
    category,
    campus,
  } = req.body;

  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const request = requestRepository.create({
    bookTitle,
    author,
    isbn,
    expectedPrice: expectedPrice ? parseFloat(expectedPrice) : undefined,
    conditions,
    description,
    category,
    campus,
    requesterId: req.userId!,
  });

  await requestRepository.save(request);
  res.status(201).json({ message: '求购信息发布成功', request });
};

export const getPurchaseRequests = async (req: Request, res: Response) => {
  const { category, campus, page = 1, limit = 20 } = req.query;

  const where: any = { status: 'active' };
  if (category) {
    where.category = category as SubjectCategory;
  }
  if (campus) {
    where.campus = campus;
  }

  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const [requests, total] = await requestRepository.findAndCount({
    where,
    relations: ['requester'],
    order: { createdAt: 'DESC' },
    skip: (parseInt(page as string) - 1) * parseInt(limit as string),
    take: parseInt(limit as string),
    select: {
      requester: REQUESTER_SELECT,
    },
  });

  await attachPendingCounts(requests);

  res.json({
    requests,
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getMyPurchaseRequests = async (req: AuthenticatedRequest, res: Response) => {
  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const requests = await requestRepository.find({
    where: { requesterId: req.userId },
    order: { createdAt: 'DESC' },
  });

  await attachPendingCounts(requests);

  res.json(requests);
};

export const getPurchaseRequestById = async (req: Request, res: Response) => {
  const { id } = req.params;

  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const request = await requestRepository.findOne({
    where: { id },
    relations: ['requester'],
    select: {
      requester: REQUESTER_SELECT,
    },
  });

  if (!request) {
    return res.status(404).json({ message: '求购信息不存在' });
  }

  // 回读时先落库已失效的报价，随后再统一返回，刷新前后状态一致
  await AppDataSource.transaction((manager) => sweepExpiredOffers(manager, id)).catch((error) => {
    console.warn('sweep expired offers failed:', error);
  });

  const offerRepository = AppDataSource.getRepository(PurchaseOffer);
  const offers = await offerRepository.find({
    where: { purchaseRequestId: id },
    relations: ['seller'],
    order: { createdAt: 'ASC' },
    select: {
      seller: SELLER_SELECT,
    },
  });

  const pendingOfferCount = offers.filter(
    (offer) => offer.status === 'pending' && offer.expireAt.getTime() > Date.now(),
  ).length;

  res.json({
    ...request,
    offers: offers.map(serializeOffer),
    pendingOfferCount,
  });
};

export const closePurchaseRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await AppDataSource.transaction(async (manager) => {
      const request = await manager
        .createQueryBuilder(PurchaseRequest, 'request')
        .setLock('pessimistic_write')
        .where('request.id = :id', { id: req.params.id })
        .getOne();

      if (!request) {
        throw new HttpError(404, '求购信息不存在');
      }

      if (request.requesterId !== req.userId) {
        throw new HttpError(403, '无权限操作');
      }

      await sweepExpiredOffers(manager, request.id);

      // 关闭求购时，仍待选的报价一并结束
      await manager.update(
        PurchaseOffer,
        { purchaseRequestId: request.id, status: 'pending' as OfferStatus },
        { status: 'declined' as OfferStatus, failReason: FAIL_REASON.declined },
      );

      request.status = 'closed';
      await manager.save(request);
    });

    res.json({ message: '求购信息已关闭' });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('closePurchaseRequest error:', error);
    return res.status(500).json({ message: '关闭失败' });
  }
};
