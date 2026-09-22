import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { PurchaseRequest, SubjectCategory } from '../entities/PurchaseRequest';
import { PurchaseOffer } from '../entities/PurchaseOffer';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { expirePendingOffers } from './purchaseOffer.controller';

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

  await expirePendingOffers();

  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const [requests, total] = await requestRepository.findAndCount({
    where,
    relations: ['requester'],
    order: { createdAt: 'DESC' },
    skip: (parseInt(page as string) - 1) * parseInt(limit as string),
    take: parseInt(limit as string),
    select: {
      requester: {
        id: true,
        name: true,
        department: true,
        avatarUrl: true,
        contactInfo: true,
      },
    },
  });

  // 统计每条求购的待选报价数量
  const requestIds = requests.map((r) => r.id);
  const pendingCountMap: Record<string, number> = {};
  if (requestIds.length > 0) {
    const rows = await AppDataSource.getRepository(PurchaseOffer)
      .createQueryBuilder('offer')
      .select('offer.requestId', 'requestId')
      .addSelect('COUNT(offer.id)', 'count')
      .where('offer.requestId IN (:...requestIds)', { requestIds })
      .andWhere('offer.status = :status', { status: 'pending' })
      .groupBy('offer.requestId')
      .getRawMany();
    for (const row of rows) {
      pendingCountMap[row.requestId] = parseInt(row.count, 10);
    }
  }

  res.json({
    requests: requests.map((r) => ({ ...r, pendingOfferCount: pendingCountMap[r.id] || 0 })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getPurchaseRequestById = async (req: Request, res: Response) => {
  const { id } = req.params;

  await expirePendingOffers(id);

  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const request = await requestRepository.findOne({
    where: { id },
    relations: ['requester'],
    select: {
      requester: {
        id: true,
        name: true,
        department: true,
        avatarUrl: true,
        contactInfo: true,
      },
    },
  });

  if (!request) {
    return res.status(404).json({ message: '求购信息不存在' });
  }

  const pendingOfferCount = await AppDataSource.getRepository(PurchaseOffer).count({
    where: { requestId: id, status: 'pending' },
  });

  res.json({ ...request, pendingOfferCount });
};

export const getMyPurchaseRequests = async (req: AuthenticatedRequest, res: Response) => {
  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const requests = await requestRepository.find({
    where: { requesterId: req.userId },
    order: { createdAt: 'DESC' },
  });

  res.json(requests);
};

export const closePurchaseRequest = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const requestRepository = AppDataSource.getRepository(PurchaseRequest);
  const request = await requestRepository.findOne({ where: { id } });

  if (!request) {
    return res.status(404).json({ message: '求购信息不存在' });
  }

  if (request.requesterId !== req.userId) {
    return res.status(403).json({ message: '无权限操作' });
  }

  await AppDataSource.transaction(async (manager) => {
    request.status = 'closed';
    await manager.getRepository(PurchaseRequest).save(request);
    // 求购关闭时，其余待选报价一同结束
    await manager.getRepository(PurchaseOffer).update(
      { requestId: id, status: 'pending' },
      { status: 'closed', failureReason: '求购已关闭' }
    );
  });

  res.json({ message: '求购信息已关闭' });
};
