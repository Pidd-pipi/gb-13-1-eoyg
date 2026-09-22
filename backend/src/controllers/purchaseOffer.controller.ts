import { Response } from 'express';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database';
import { PurchaseRequest } from '../entities/PurchaseRequest';
import { PurchaseOffer, OfferCondition, OfferStatus } from '../entities/PurchaseOffer';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  MAX_PENDING_OFFERS,
  VALID_CONDITIONS,
  FAIL_REASON,
  sweepExpiredOffers,
  effectiveFailReason,
  serializeOffer,
} from '../services/purchaseOffer.service';

// 事务中携带 HTTP 状态码抛出，回滚后由控制器转成响应
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 卖家提交/更新报价
export const submitOffer = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const sellerId = req.userId!;
  const { price, condition, pickupLocation, expireAt } = req.body;

  const parsedPrice = typeof price === 'string' ? parseFloat(price) : Number(price);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return res.status(400).json({ message: '请输入有效的报价金额' });
  }
  if (!VALID_CONDITIONS.includes(condition)) {
    return res.status(400).json({ message: '请选择成色' });
  }
  if (typeof pickupLocation !== 'string' || !pickupLocation.trim()) {
    return res.status(400).json({ message: '请填写取书地点' });
  }

  const parsedExpireAt = new Date(expireAt);
  if (Number.isNaN(parsedExpireAt.getTime())) {
    return res.status(400).json({ message: '请选择有效的失效时间' });
  }
  if (parsedExpireAt.getTime() <= Date.now()) {
    return res.status(400).json({ message: '失效时间必须晚于当前时间' });
  }

  try {
    const result = await AppDataSource.transaction(async (manager) => {
      // 锁定求购行，保证同求购下的提交/确认/撤回互斥串行
      const purchaseRequest = await manager
        .createQueryBuilder(PurchaseRequest, 'request')
        .setLock('pessimistic_write')
        .where('request.id = :id', { id })
        .getOne();

      if (!purchaseRequest) {
        throw new HttpError(404, '求购信息不存在');
      }
      if (purchaseRequest.requesterId === sellerId) {
        throw new HttpError(400, '不能对自己发布的求购提交报价');
      }
      if (purchaseRequest.status !== 'active') {
        throw new HttpError(400, '求购已结束，无法提交报价');
      }

      await sweepExpiredOffers(manager, id);

      const offerRepository = manager.getRepository(PurchaseOffer);
      const existing = await offerRepository.findOne({
        where: { purchaseRequestId: id, sellerId },
      });

      if (existing) {
        if (existing.status === 'accepted') {
          throw new HttpError(400, '已有报价被采纳，无法修改');
        }
        if (existing.status === 'declined') {
          throw new HttpError(400, effectiveFailReason(existing) || FAIL_REASON.declined);
        }
      }

      // 同一卖家重提复用自己的名额；其余卖家最多保留 MAX_PENDING_OFFERS-1 条待选
      const pendingCount = await offerRepository.count({
        where: { purchaseRequestId: id, status: 'pending' },
      });
      const otherPendingCount = existing?.status === 'pending' ? pendingCount - 1 : pendingCount;
      if (otherPendingCount >= MAX_PENDING_OFFERS) {
        throw new HttpError(400, `待选报价已满（最多${MAX_PENDING_OFFERS}条）`);
      }

      if (existing) {
        existing.price = parsedPrice;
        existing.condition = condition as OfferCondition;
        existing.pickupLocation = pickupLocation.trim();
        existing.expireAt = parsedExpireAt;
        existing.status = 'pending';
        existing.failReason = null;
        const saved = await offerRepository.save(existing);
        return { offer: saved, created: false };
      }

      const created = offerRepository.create({
        purchaseRequestId: id,
        sellerId,
        price: parsedPrice,
        condition: condition as OfferCondition,
        pickupLocation: pickupLocation.trim(),
        expireAt: parsedExpireAt,
        status: 'pending' as OfferStatus,
      });
      const saved = await offerRepository.save(created);
      return { offer: saved, created: true };
    });

    res.status(result.created ? 201 : 200).json({
      message: result.created ? '报价提交成功' : '报价已更新',
      offer: serializeOffer(result.offer),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    // 唯一索引兜底：并发下同一卖家重复插入
    if ((error as any)?.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: '已提交过报价，请直接更新' });
    }
    console.error('submitOffer error:', error);
    return res.status(500).json({ message: '报价提交失败' });
  }
};

// 卖家撤回自己的报价
export const withdrawOffer = async (req: AuthenticatedRequest, res: Response) => {
  const { id, offerId } = req.params;
  const sellerId = req.userId!;

  try {
    await AppDataSource.transaction(async (manager) => {
      const purchaseRequest = await manager
        .createQueryBuilder(PurchaseRequest, 'request')
        .setLock('pessimistic_write')
        .where('request.id = :id', { id })
        .getOne();

      if (!purchaseRequest) {
        throw new HttpError(404, '求购信息不存在');
      }

      await sweepExpiredOffers(manager, id);

      const offer = await lockOffer(manager, id, offerId);

      if (!offer) {
        throw new HttpError(404, '报价不存在');
      }
      if (offer.sellerId !== sellerId) {
        throw new HttpError(403, '只能撤回自己的报价');
      }
      if (offer.status === 'expired') {
        throw new HttpError(400, FAIL_REASON.expired);
      }
      if (offer.status === 'withdrawn') {
        throw new HttpError(400, FAIL_REASON.withdrawn);
      }
      if (offer.status === 'accepted') {
        throw new HttpError(400, '报价已被采纳，无法撤回');
      }
      if (offer.status === 'declined') {
        throw new HttpError(400, effectiveFailReason(offer) || FAIL_REASON.declined);
      }

      offer.status = 'withdrawn';
      offer.failReason = FAIL_REASON.withdrawn;
      await manager.save(offer);
    });

    res.json({ message: '报价已撤回' });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('withdrawOffer error:', error);
    return res.status(500).json({ message: '撤回失败' });
  }
};

// 发布者确认一条报价
export const confirmOffer = async (req: AuthenticatedRequest, res: Response) => {
  const { id, offerId } = req.params;
  const requesterId = req.userId!;

  try {
    await AppDataSource.transaction(async (manager) => {
      // 锁定求购行：重复或同时确认在此串行，先到先得，后者失败回滚、原样保留
      const purchaseRequest = await manager
        .createQueryBuilder(PurchaseRequest, 'request')
        .setLock('pessimistic_write')
        .where('request.id = :id', { id })
        .getOne();

      if (!purchaseRequest) {
        throw new HttpError(404, '求购信息不存在');
      }
      if (purchaseRequest.requesterId !== requesterId) {
        throw new HttpError(403, '只有求购发布者可以确认报价');
      }
      if (purchaseRequest.status !== 'active') {
        throw new HttpError(400, '求购已结束，无法确认报价');
      }

      await sweepExpiredOffers(manager, id);

      const offer = await lockOffer(manager, id, offerId);

      if (!offer) {
        throw new HttpError(404, '报价不存在');
      }

      // 失效、撤回或其他非待选报价不能确认
      if (offer.status === 'expired') {
        throw new HttpError(400, FAIL_REASON.expired);
      }
      if (offer.status === 'withdrawn') {
        throw new HttpError(400, FAIL_REASON.withdrawn);
      }
      if (offer.status === 'declined') {
        throw new HttpError(400, effectiveFailReason(offer) || FAIL_REASON.declined);
      }
      if (offer.status === 'accepted') {
        throw new HttpError(400, '该报价已确认，请勿重复操作');
      }

      offer.status = 'accepted';
      offer.failReason = null;
      await manager.save(offer);

      // 其余待选报价一并落选
      await manager.update(
        PurchaseOffer,
        { purchaseRequestId: id, status: 'pending' },
        { status: 'declined' as OfferStatus, failReason: FAIL_REASON.declined },
      );

      purchaseRequest.status = 'closed';
      await manager.save(purchaseRequest);
    });

    res.json({ message: '已确认报价，求购结束' });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('confirmOffer error:', error);
    return res.status(500).json({ message: '确认失败' });
  }
};

const lockOffer = async (manager: EntityManager, purchaseRequestId: string, offerId: string) => {
  return manager
    .createQueryBuilder(PurchaseOffer, 'offer')
    .setLock('pessimistic_write')
    .where('offer.id = :offerId', { offerId })
    .andWhere('offer.purchaseRequestId = :purchaseRequestId', { purchaseRequestId })
    .getOne();
};
