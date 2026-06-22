import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index,
} from 'typeorm';

// ─────────────────────────────────────────────────────────────
// USER
// ─────────────────────────────────────────────────────────────
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['customer', 'lessor', 'admin', 'support_agent'], default: 'customer' })
  role: string;

  @Column({ name: 'first_name', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', length: 100 })
  lastName: string;

  @Index({ unique: true })
  @Column({ length: 255 })
  email: string;

  @Index({ unique: true })
  @Column({ length: 20 })
  phone: string;

  @Column({ name: 'password_hash', nullable: true })
  passwordHash: string;

  @Column({ length: 3, nullable: true })
  nationality: string;

  @Column({ name: 'preferred_language', length: 5, default: 'fr' })
  preferredLanguage: string;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'fcm_token', nullable: true })
  fcmToken: string;

  @Column({ name: 'otp_code', nullable: true })
  otpCode: string;

  @Column({ name: 'otp_expires_at', type: 'timestamptz', nullable: true })
  otpExpiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Booking, (b) => b.customer)
  bookings: Booking[];
}

// ─────────────────────────────────────────────────────────────
// LESSOR
// ─────────────────────────────────────────────────────────────
@Entity('lessors')
export class Lessor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_user_id' })
  ownerUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'owner_user_id' })
  owner: User;

  @Column({ type: 'enum', enum: ['agency', 'independent'], default: 'independent' })
  type: string;

  @Column({ name: 'business_name', length: 200 })
  businessName: string;

  @Column({ name: 'legal_identifier', nullable: true })
  legalIdentifier: string;

  @Column({ name: 'tax_identifier', nullable: true })
  taxIdentifier: string;

  @Column({ nullable: true })
  address: string;

  @Column({ length: 100, nullable: true })
  wilaya: string;

  @Column({ length: 100, nullable: true })
  city: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 20, nullable: true })
  rib: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
  })
  status: string;

  @Column({ name: 'rejection_reason', nullable: true })
  rejectionReason: string;

  @Column({ name: 'rating_average', type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAverage: number;

  @Column({ name: 'review_count', default: 0 })
  reviewCount: number;

  @Column({ name: 'commission_rate', type: 'decimal', precision: 5, scale: 4, nullable: true })
  commissionRate: number;

  @Column({ name: 'welcome_period_ends_at', type: 'timestamptz', nullable: true })
  welcomePeriodEndsAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Vehicle, (v) => v.lessor)
  vehicles: Vehicle[];
}

// ─────────────────────────────────────────────────────────────
// VEHICLE
// ─────────────────────────────────────────────────────────────
@Entity('vehicles')
@Index(['lessorId', 'status'])
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lessor_id' })
  lessorId: string;

  @ManyToOne(() => Lessor, (l) => l.vehicles)
  @JoinColumn({ name: 'lessor_id' })
  lessor: Lessor;

  @Column({ length: 100 })
  brand: string;

  @Column({ length: 100 })
  model: string;

  @Column()
  year: number;

  @Column({ length: 50 })
  category: string;

  @Column({ length: 20 })
  transmission: string; // manual | auto

  @Column({ name: 'fuel_type', length: 20 })
  fuelType: string; // gasoline | diesel | hybrid | electric

  @Column({ default: 5 })
  seats: number;

  @Column({ name: 'luggage_count', default: 2 })
  luggageCount: number;

  @Column({ name: 'air_conditioning', default: true })
  airConditioning: boolean;

  @Column({ name: 'mileage_policy', nullable: true })
  mileagePolicy: string;

  @Column({ length: 50, nullable: true })
  color: string;

  @Column({ name: 'registration_number', nullable: true })
  registrationNumber: string;

  @Column({ name: 'daily_price_base', type: 'decimal', precision: 10, scale: 2 })
  dailyPriceBase: number;

  @Column({ name: 'weekly_price_base', type: 'decimal', precision: 10, scale: 2, nullable: true })
  weeklyPriceBase: number;

  @Column({ name: 'monthly_price_base', type: 'decimal', precision: 10, scale: 2, nullable: true })
  monthlyPriceBase: number;

  @Column({ name: 'deposit_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  depositAmount: number;

  @Column({ name: 'requires_manual_approval', default: false })
  requiresManualApproval: boolean;

  @Column({ name: 'delivery_available', default: false })
  deliveryAvailable: boolean;

  @Column({ name: 'airport_delivery_available', default: false })
  airportDeliveryAvailable: boolean;

  @Column({ type: 'simple-array', name: 'required_documents', nullable: true })
  requiredDocuments: string[];

  @Column({ name: 'pickup_address', nullable: true })
  pickupAddress: string;

  @Column({ name: 'pickup_city', length: 100, nullable: true })
  pickupCity: string;

  @Column({ name: 'pickup_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  pickupLat: number;

  @Column({ name: 'pickup_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  pickupLng: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: false })
  published: boolean;

  @Column({ type: 'enum', enum: ['active', 'inactive', 'under_review', 'rejected'], default: 'under_review' })
  status: string;

  @Column({ name: 'rating_average', type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAverage: number;

  @Column({ name: 'review_count', default: 0 })
  reviewCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => VehiclePhoto, (p) => p.vehicle, { cascade: true })
  photos: VehiclePhoto[];

  @OneToMany(() => Availability, (a) => a.vehicle)
  availabilities: Availability[];

  @OneToMany(() => PricingRule, (p) => p.vehicle)
  pricingRules: PricingRule[];

  @OneToMany(() => Booking, (b) => b.vehicle)
  bookings: Booking[];
}

// ─────────────────────────────────────────────────────────────
// VEHICLE PHOTO
// ─────────────────────────────────────────────────────────────
@Entity('vehicle_photos')
export class VehiclePhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @ManyToOne(() => Vehicle, (v) => v.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column()
  url: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_cover', default: false })
  isCover: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// AVAILABILITY
// ─────────────────────────────────────────────────────────────
@Entity('availabilities')
@Index(['vehicleId', 'startAt', 'endAt'])
export class Availability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @ManyToOne(() => Vehicle, (v) => v.availabilities)
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'enum', enum: ['manual_block', 'booking', 'maintenance'], default: 'manual_block' })
  source: string;

  @Column({ type: 'enum', enum: ['available', 'blocked', 'reserved'], default: 'available' })
  status: string;

  @Column({ name: 'booking_id', nullable: true })
  bookingId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// PRICING RULE
// ─────────────────────────────────────────────────────────────
@Entity('pricing_rules')
export class PricingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @ManyToOne(() => Vehicle, (v) => v.pricingRules)
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column({ name: 'min_days', nullable: true })
  minDays: number;

  @Column({ name: 'max_days', nullable: true })
  maxDays: number;

  @Column({ name: 'season_name', nullable: true })
  seasonName: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string;

  @Column({ name: 'daily_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  dailyPrice: number;

  @Column({ name: 'weekly_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  weeklyPrice: number;

  @Column({ name: 'monthly_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  monthlyPrice: number;

  @Column({ name: 'airport_delivery_fee', type: 'decimal', precision: 10, scale: 2, nullable: true })
  airportDeliveryFee: number;

  @Column({ name: 'extra_driver_fee', type: 'decimal', precision: 10, scale: 2, nullable: true })
  extraDriverFee: number;

  @Column({ name: 'extra_km_fee', type: 'decimal', precision: 10, scale: 2, nullable: true })
  extraKmFee: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// BOOKING
// ─────────────────────────────────────────────────────────────
@Entity('bookings')
@Index(['customerId', 'status'])
@Index(['vehicleId', 'pickupAt', 'returnAt'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reference_code', length: 20, unique: true })
  referenceCode: string;

  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => User, (u) => u.bookings)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'lessor_id' })
  lessorId: string;

  @ManyToOne(() => Lessor)
  @JoinColumn({ name: 'lessor_id' })
  lessor: Lessor;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @ManyToOne(() => Vehicle, (v) => v.bookings)
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column({ name: 'pickup_location' })
  pickupLocation: string;

  @Column({ name: 'return_location' })
  returnLocation: string;

  @Column({ name: 'pickup_at', type: 'timestamptz' })
  pickupAt: Date;

  @Column({ name: 'return_at', type: 'timestamptz' })
  returnAt: Date;

  @Column({ name: 'rental_days' })
  rentalDays: number;

  @Column({ name: 'subtotal_amount', type: 'decimal', precision: 10, scale: 2 })
  subtotalAmount: number;

  @Column({ name: 'extra_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  extraAmount: number;

  @Column({ name: 'deposit_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  depositAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ length: 3, default: 'DZD' })
  currency: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'awaiting_payment', 'confirmed', 'cancelled', 'completed', 'rejected'],
    default: 'pending',
  })
  status: string;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: ['not_paid', 'partially_paid', 'paid', 'refunded'],
    default: 'not_paid',
  })
  paymentStatus: string;

  @Column({ name: 'approval_mode', type: 'enum', enum: ['instant', 'manual'], default: 'instant' })
  approvalMode: string;

  @Column({ name: 'extra_driver', default: false })
  extraDriver: boolean;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date;

  @Column({ name: 'hidden_for_lessor', default: false })
  hiddenForLessor: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Payment, (p) => p.booking)
  payments: Payment[];

  @OneToMany(() => Review, (r) => r.booking)
  reviews: Review[];
}

// ─────────────────────────────────────────────────────────────
// PAYMENT
// ─────────────────────────────────────────────────────────────
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @ManyToOne(() => Booking, (b) => b.payments)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ length: 50 })
  provider: string; // mock | cib | edahabia | on_site

  @Column({ length: 50 })
  method: string; // card | mobile_wallet | cash

  @Column({ name: 'payment_type', type: 'enum', enum: ['rental', 'deposit'], default: 'rental' })
  paymentType: string;

  @Column({ name: 'transaction_reference', nullable: true })
  transactionReference: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ length: 3, default: 'DZD' })
  currency: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending',
  })
  status: string;

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, any>;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// DOCUMENT
// ─────────────────────────────────────────────────────────────
@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_type', type: 'enum', enum: ['user', 'lessor', 'vehicle', 'booking'] })
  ownerType: string;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @Column({ name: 'document_type' })
  documentType: string; // driving_license | id_card | passport | rc | insurance | etc.

  @Column()
  url: string;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  })
  verificationStatus: string;

  @Column({ name: 'rejection_reason', nullable: true })
  rejectionReason: string;

  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// REVIEW
// ─────────────────────────────────────────────────────────────
@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @ManyToOne(() => Booking, (b) => b.reviews)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'lessor_id' })
  lessorId: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ type: 'decimal', precision: 2, scale: 1 })
  rating: number;

  @Column({ nullable: true })
  comment: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// SUPPORT TICKET
// ─────────────────────────────────────────────────────────────
@Entity('support_tickets')
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', nullable: true })
  bookingId: string;

  @Column({ name: 'opened_by_user_id' })
  openedByUserId: string;

  @Column({ name: 'assigned_to_user_id', nullable: true })
  assignedToUserId: string;

  @Column({ length: 100, nullable: true })
  category: string;

  @Column({ type: 'enum', enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' })
  status: string;

  @Column({ type: 'enum', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  priority: string;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => SupportMessage, (m) => m.ticket, { cascade: true })
  messages: SupportMessage[];
}

// ─────────────────────────────────────────────────────────────
// SUPPORT MESSAGE (ticket chat)
// ─────────────────────────────────────────────────────────────
@Entity('support_messages')
export class SupportMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_id' })
  ticketId: string;

  @ManyToOne(() => SupportTicket, (t) => t.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: SupportTicket;

  @Column({ name: 'sender_id' })
  senderId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'enum', enum: ['customer', 'support', 'lessor'], default: 'customer' })
  senderRole: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_user_id', nullable: true })
  actorUserId: string;

  @Column({ name: 'entity_type', length: 100 })
  entityType: string;

  @Column({ name: 'entity_id', nullable: true })
  entityId: string;

  @Column({ length: 100 })
  action: string;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, any>;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// PLATFORM SETTINGS (singleton row)
// ─────────────────────────────────────────────────────────────
@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'commission_rate_default', type: 'decimal', precision: 5, scale: 4, default: 0.1 })
  commissionRateDefault: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
