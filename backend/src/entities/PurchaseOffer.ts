import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';
import { User } from './User';
import { PurchaseRequest } from './PurchaseRequest';
import type { BookCondition } from './Book';

export type OfferStatus = 'pending' | 'confirmed' | 'closed' | 'withdrawn' | 'expired';

@Entity('purchase_offers')
@Unique('uq_offer_request_seller', ['requestId', 'sellerId'])
export class PurchaseOffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'enum', enum: ['new', 'like_new', 'good', 'fair'] })
  condition: BookCondition;

  @Column()
  pickupLocation: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'enum', enum: ['pending', 'confirmed', 'closed', 'withdrawn', 'expired'], default: 'pending' })
  @Index('idx_offer_status')
  status: OfferStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason: string | null;

  @ManyToOne(() => PurchaseRequest, { onDelete: 'CASCADE' })
  request: PurchaseRequest;

  @Column()
  @Index('idx_offer_request')
  requestId: string;

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
