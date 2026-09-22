import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './User';
import { PurchaseRequest } from './PurchaseRequest';

export type OfferCondition = 'new' | 'like_new' | 'good' | 'fair';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';

@Entity('purchase_offers')
@Unique('uq_offer_request_seller', ['purchaseRequestId', 'sellerId'])
export class PurchaseOffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'enum', enum: ['new', 'like_new', 'good', 'fair'] })
  condition: OfferCondition;

  @Column()
  pickupLocation: string;

  @Column({ type: 'datetime' })
  expireAt: Date;

  @Column({
    type: 'enum',
    enum: ['pending', 'accepted', 'declined', 'withdrawn', 'expired'],
    default: 'pending',
  })
  @Index('idx_offer_status')
  status: OfferStatus;

  // 非待选报价的失败原因（已失效/已撤回/未被采纳等），供求购页展示，刷新可回读
  @Column({ type: 'varchar', length: 100, nullable: true })
  failReason: string | null;

  @ManyToOne(() => PurchaseRequest, purchaseRequest => purchaseRequest.offers, {
    onDelete: 'CASCADE',
  })
  purchaseRequest: PurchaseRequest;

  @Column()
  @Index('idx_offer_request')
  purchaseRequestId: string;

  @ManyToOne(() => User)
  seller: User;

  @Column()
  @Index('idx_offer_seller')
  sellerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
