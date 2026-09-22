import { Response } from 'express';
import { LessThanOrEqual } from 'typeorm';
import { AppDataSource } from '../config/database';
import { PurchaseOffer } from '../entities/PurchaseOffer';
import { PurchaseRequest } from '../entities/PurchaseRequest';
import type { BookCondition } from '../entities/Book';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const MAX_PENDING_OFFERS = 3;
const VALID_CONDITIONS: BookCondition[] = ['new', 'like_new', 'good', 'fair'];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// 惰性过期：把已到期的待选报价标记为失效，读取或写入报价前先调用
export const expirePendingOffers = async (requestId?: string) => {
  const where: any = {
    status: 'pending',
    expiresAt: LessThanOrEqual(new Date()),
  };
  if (requestId) {
    where.requestId = requestId;
  }
  await AppDataSource.getRepository(PurchaseOffer).update(where, {
    status: 'expired',
    failureReason: '报价已过期',
  });
};

const handleError = (res: Response, error: unknown) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }
  if ((error as any)?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: '请勿重复提交报价' });
  }
  console.error('报价操作失败:', error);
  return res.status(500).json({ message: '服务器错误，请稍后再试' });
};

export const submitOffer = async (req: AuthenticatedRequest, res: Response) => {
  const { id: requestId } = req.params;
  const { price, condition, pickupLocation, expiresAt } = req.body;

  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice <= 0) {
    return res.status(400).json({ message: '请填写有效的价格' });
  }
  if (!VALID_CONDITIONS.includes(condition)) {
    return res.status(400).json({ message: '请选择有效的成色' });
  }
  if (!pickupLocation || !String(pickupLocation).trim()) {
    return res.status(400).json({ message: '请填写取书地点' });
  }
  const expireDate = new Date(expiresAt);
  if (!expiresAt || isNaN(expireDate.getTime())) {
    return res.status(400).json({ message: '请选择有效的失效时间' });
  }
  if (expireDate.getTime() <= Date.now()) {
    return res.status(400).json({ message: '失效时间必须晚于当前时间' });
  }

  try {
    const result = await AppDataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(PurchaseRequest);
      const offerRepository = manager.getRepository(PurchaseOffer);

      // 锁定求购记录，串行化同一求购下的报价提交，保证待选数量上限
      const purchaseRequest = await requestRepository
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();

      if (!purchaseRequest) {
        throw new HttpError(404, '求购信息不存在');
      }
      if (purchaseRequest.status !== 'active') {
        throw new HttpError(400, '求购已结束，无法报价');
      }
      if (purchaseRequest.requesterId === req.userId) {
        throw new HttpError(403, '不能对自己的求购报价');
      }

      await offerRepository.update(
        { requestId, status: 'pending', expiresAt: LessThanOrEqual(new Date()) },
        { status: 'expired', failureReason: '报价已过期' }
      );

      // 同一卖家重复提交时更新原报价（已撤回/已失效的报价重提后恢复为待选）
      const existing = await offerRepository.findOne({
        where: { requestId, sellerId: req.userId },
      });
      if (existing) {
        if (existing.status === 'confirmed') {
          throw new HttpError(400, '报价已被确认，无法修改');
        }
        // 重提恢复待选时同样受“最多三条待选”限制
        if (existing.status !== 'pending') {
          const pendingCount = await offerRepository.count({
            where: { requestId, status: 'pending' },
          });
          if (pendingCount >= MAX_PENDING_OFFERS) {
            throw new HttpError(400, `该求购的待选报价已满（最多 ${MAX_PENDING_OFFERS} 条），请稍后再试`);
          }
        }
        existing.price = parsedPrice;
        existing.condition = condition;
        existing.pickupLocation = String(pickupLocation).trim();
        existing.expiresAt = expireDate;
        existing.status = 'pending';
        existing.failureReason = null;
        await offerRepository.save(existing);
        return { offer: existing, updated: true };
      }

      const pendingCount = await offerRepository.count({
        where: { requestId, status: 'pending' },
      });
      if (pendingCount >= MAX_PENDING_OFFERS) {
        throw new HttpError(400, `该求购的待选报价已满（最多 ${MAX_PENDING_OFFERS} 条），请稍后再试`);
      }

      const offer = offerRepository.create({
        requestId,
        sellerId: req.userId!,
        price: parsedPrice,
        condition,
        pickupLocation: String(pickupLocation).trim(),
        expiresAt: expireDate,
      });
      await offerRepository.save(offer);
      return { offer, updated: false };
    });

    res
      .status(result.updated ? 200 : 201)
      .json({ message: result.updated ? '报价已更新' : '报价提交成功', offer: result.offer });
  } catch (error) {
    handleError(res, error);
  }
};

export const getOffers = async (req: AuthenticatedRequest, res: Response) => {
  const { id: requestId } = req.params;

  try {
    const requestRepository = AppDataSource.getRepository(PurchaseRequest);
    const purchaseRequest = await requestRepository.findOne({ where: { id: requestId } });
    if (!purchaseRequest) {
      return res.status(404).json({ message: '求购信息不存在' });
    }

    await expirePendingOffers(requestId);

    const offers = await AppDataSource.getRepository(PurchaseOffer).find({
      where: { requestId },
      relations: ['seller'],
      select: {
        seller: {
          id: true,
          name: true,
          department: true,
          avatarUrl: true,
          contactInfo: true,
          positiveRatingRate: true,
          totalReviews: true,
        },
      },
    });

    // 待选报价排在前面，其余按提交时间倒序
    offers.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // 发布者可见全部报价，其他用户只能看到自己的报价
    const isRequester = purchaseRequest.requesterId === req.userId;
    const visible = isRequester ? offers : offers.filter((o) => o.sellerId === req.userId);
    const pendingCount = offers.filter((o) => o.status === 'pending').length;

    res.json({
      offers: visible,
      pendingCount,
      totalCount: offers.length,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const confirmOffer = async (req: AuthenticatedRequest, res: Response) => {
  const { id: requestId, offerId } = req.params;

  try {
    const confirmed = await AppDataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(PurchaseRequest);
      const offerRepository = manager.getRepository(PurchaseOffer);

      // 行锁保证重复或并发确认只成功一次，失败时事务回滚、数据保持原样
      const purchaseRequest = await requestRepository
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();

      if (!purchaseRequest) {
        throw new HttpError(404, '求购信息不存在');
      }
      if (purchaseRequest.requesterId !== req.userId) {
        throw new HttpError(403, '只有发布者可以确认报价');
      }
      if (purchaseRequest.status !== 'active') {
        throw new HttpError(400, '求购已结束，无法确认报价');
      }

      await offerRepository.update(
        { requestId, status: 'pending', expiresAt: LessThanOrEqual(new Date()) },
        { status: 'expired', failureReason: '报价已过期' }
      );

      const offer = await offerRepository.findOne({ where: { id: offerId, requestId } });
      if (!offer) {
        throw new HttpError(404, '报价不存在');
      }
      if (offer.status !== 'pending') {
        const statusMessages: Record<string, string> = {
          confirmed: '该报价已被确认',
          closed: '该报价已结束',
          withdrawn: '该报价已被卖家撤回',
          expired: '该报价已失效',
        };
        throw new HttpError(400, statusMessages[offer.status] || '该报价当前不可确认');
      }

      offer.status = 'confirmed';
      await offerRepository.save(offer);

      // 确认一条后，求购及其余待选报价一同结束
      await offerRepository.update(
        { requestId, status: 'pending' },
        { status: 'closed', failureReason: '买家已确认其他报价' }
      );

      purchaseRequest.status = 'closed';
      await requestRepository.save(purchaseRequest);

      return offer;
    });

    res.json({ message: '已确认报价，求购完成', offer: confirmed });
  } catch (error) {
    handleError(res, error);
  }
};

export const withdrawOffer = async (req: AuthenticatedRequest, res: Response) => {
  const { id: requestId, offerId } = req.params;

  try {
    const withdrawn = await AppDataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(PurchaseRequest);
      const offerRepository = manager.getRepository(PurchaseOffer);

      // 与确认操作共用求购行锁，保证撤回和确认并发时只有一方生效
      const purchaseRequest = await requestRepository
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();

      if (!purchaseRequest) {
        throw new HttpError(404, '求购信息不存在');
      }

      const offer = await offerRepository.findOne({ where: { id: offerId, requestId } });
      if (!offer) {
        throw new HttpError(404, '报价不存在');
      }
      if (offer.sellerId !== req.userId) {
        throw new HttpError(403, '无权限操作');
      }
      if (offer.status !== 'pending') {
        throw new HttpError(400, '当前报价状态不可撤回');
      }

      offer.status = 'withdrawn';
      offer.failureReason = '卖家已撤回';
      await offerRepository.save(offer);
      return offer;
    });

    res.json({ message: '报价已撤回', offer: withdrawn });
  } catch (error) {
    handleError(res, error);
  }
};
