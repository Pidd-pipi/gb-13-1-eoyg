import { EntityManager, LessThanOrEqual } from 'typeorm';
import { PurchaseOffer, OfferCondition, OfferStatus } from '../entities/PurchaseOffer';

export const MAX_PENDING_OFFERS = 3;
export const VALID_CONDITIONS: OfferCondition[] = ['new', 'like_new', 'good', 'fair'];

export const FAIL_REASON: Record<Exclude<OfferStatus, 'pending' | 'accepted'>, string> = {
  expired: '报价已失效',
  withdrawn: '卖家已撤回报价',
  declined: '报价未被采纳',
};

// 将已过失效时间的待选报价批量标记为失效（事务内调用）
export const sweepExpiredOffers = async (
  manager: EntityManager,
  purchaseRequestId: string,
  now: Date = new Date(),
) => {
  await manager.update(
    PurchaseOffer,
    { purchaseRequestId, status: 'pending', expireAt: LessThanOrEqual(now) },
    { status: 'expired' as OfferStatus, failReason: FAIL_REASON.expired },
  );
};

export const effectiveFailReason = (offer: PurchaseOffer): string | null => {
  if (offer.failReason) {
    return offer.failReason;
  }
  if (offer.status === 'expired') {
    return FAIL_REASON.expired;
  }
  return null;
};

// 对外输出时补全失效原因，保证刷新后可回读
export const serializeOffer = (offer: PurchaseOffer) => ({
  ...offer,
  failReason: effectiveFailReason(offer),
});
