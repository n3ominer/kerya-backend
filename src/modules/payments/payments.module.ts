// ============================================================
// PAYMENTS MODULE — Abstract Provider Pattern
// ============================================================
import {
  Module, Controller, Post, Body, Param, Get, Query,
  UseGuards, Request, Res, Injectable, NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { Payment, Booking, Lessor } from '../../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { buildPaymentsWorkbook } from '../../common/excel.util';

// ─── Payment Provider Interface ─────────────────────────────
export interface PaymentInitResult {
  redirectUrl?: string;
  transactionReference: string;
  providerPayload?: Record<string, any>;
}

export interface PaymentVerifyResult {
  success: boolean;
  transactionReference: string;
  amount: number;
  rawPayload: Record<string, any>;
}

export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract initPayment(amount: number, currency: string, bookingRef: string, metadata?: Record<string, any>): Promise<PaymentInitResult>;
  abstract verifyPayment(transactionReference: string): Promise<PaymentVerifyResult>;
  abstract refund(transactionReference: string, amount: number): Promise<boolean>;
}

// ─── Mock Provider (Development) ────────────────────────────
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock';

  async initPayment(amount: number, currency: string, bookingRef: string) {
    const ref = `MOCK-${bookingRef}-${Date.now()}`;
    console.log(`[MockPayment] Init: ${amount} ${currency} | Ref: ${ref}`);
    return {
      transactionReference: ref,
      redirectUrl: `http://localhost:3001/payment/mock?ref=${ref}&amount=${amount}`,
      providerPayload: { mock: true },
    };
  }

  async verifyPayment(transactionReference: string) {
    console.log(`[MockPayment] Verify: ${transactionReference}`);
    return {
      success: true,
      transactionReference,
      amount: 0,
      rawPayload: { mock: true, verified: true },
    };
  }

  async refund(transactionReference: string, amount: number) {
    console.log(`[MockPayment] Refund: ${transactionReference} | ${amount}`);
    return true;
  }
}

// ─── CIB/Edahabia (SATIM) Provider Stub ─────────────────────
@Injectable()
export class SatimPaymentProvider extends PaymentProvider {
  readonly name = 'satim';

  constructor(private readonly config: ConfigService) {
    super();
  }

  async initPayment(amount: number, currency: string, bookingRef: string, metadata?: Record<string, any>): Promise<PaymentInitResult> {
    /**
     * SATIM integration steps:
     * 1. POST to SATIM_BASE_URL/register.do with merchant credentials
     * 2. Receive orderId + formUrl
     * 3. Redirect customer to formUrl (CIB or Edahabia card form)
     * 4. SATIM calls back your returnUrl with orderId
     * 5. Verify with /getOrderStatus.do
     *
     * This is a stub — implement when SATIM credentials are available.
     */
    const merchantId = this.config.get('SATIM_MERCHANT_ID');
    const terminalId = this.config.get('SATIM_TERMINAL_ID');
    const baseUrl = this.config.get('SATIM_BASE_URL');

    if (!merchantId || !terminalId) {
      throw new BadRequestException('SATIM credentials non configurés');
    }

    // TODO: real HTTP call to SATIM
    throw new BadRequestException('SATIM: intégration en cours de déploiement');
  }

  async verifyPayment(transactionReference: string): Promise<PaymentVerifyResult> {
    // TODO: GET /getOrderStatus.do?orderId=...
    throw new BadRequestException('SATIM: vérification non implémentée');
  }

  async refund(transactionReference: string, amount: number): Promise<boolean> {
    // TODO: POST /refund.do
    return false;
  }
}

// ─── DTOs ──────────────────────────────────────────────────
export class InitPaymentDto {
  @IsString() bookingId: string;
  @IsString() method: string; // cib | edahabia | on_site | mock
  @IsString() paymentType: 'rental' | 'deposit';
}

export class ConfirmWebhookDto {
  @IsString() transactionReference: string;
  @IsString() provider: string;
  payload: Record<string, any>;
}

// ─── Service ────────────────────────────────────────────────
@Injectable()
export class PaymentsService {
  private readonly providers: Map<string, PaymentProvider>;

  constructor(
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Lessor) private readonly lessorRepo: Repository<Lessor>,
    private readonly configService: ConfigService,
    private readonly mockProvider: MockPaymentProvider,
    private readonly satimProvider: SatimPaymentProvider,
    private readonly settingsService: SettingsService,
  ) {
    this.providers = new Map<string, PaymentProvider>([
      ['mock', this.mockProvider],
      ['cib', this.satimProvider],
      ['edahabia', this.satimProvider],
    ]);
  }

  private getProvider(method: string): PaymentProvider {
    const env = this.configService.get('PAYMENT_PROVIDER', 'mock');
    const key = env === 'mock' ? 'mock' : method;
    const provider = this.providers.get(key);
    if (!provider) throw new BadRequestException(`Provider inconnu: ${key}`);
    return provider;
  }

  async initPayment(customerId: string, dto: InitPaymentDto) {
    const booking = await this.bookingRepo.findOne({
      where: { id: dto.bookingId, customerId },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (!['awaiting_payment', 'confirmed', 'pending'].includes(booking.status)) {
      throw new BadRequestException('Paiement non attendu pour cette réservation');
    }

    const amount = dto.paymentType === 'deposit'
      ? Number(booking.depositAmount)
      : Number(booking.totalAmount);

    const env = this.configService.get('PAYMENT_PROVIDER', 'mock');

    // on_site and mock env: complete immediately, no redirect needed
    if (dto.method === 'on_site' || env === 'mock') {
      const ref = `${dto.method === 'on_site' ? 'CASH' : 'MOCK'}-${booking.referenceCode}-${Date.now()}`;
      const payment = this.paymentRepo.create({
        bookingId: booking.id,
        provider: dto.method === 'on_site' ? 'on_site' : 'mock',
        method: dto.method === 'on_site' ? 'cash' : dto.method,
        paymentType: dto.paymentType,
        amount,
        currency: booking.currency,
        status: 'completed',
        transactionReference: ref,
        paidAt: new Date(),
      });
      if (dto.paymentType === 'rental') {
        booking.paymentStatus = 'paid';
        if (['awaiting_payment', 'pending'].includes(booking.status)) {
          booking.status = 'confirmed';
        }
      } else {
        booking.paymentStatus = 'partially_paid';
      }
      await this.bookingRepo.save(booking);
      const saved = await this.paymentRepo.save(payment);
      return { payment: saved, redirectUrl: null };
    }

    const provider = this.getProvider(dto.method);
    const result = await provider.initPayment(amount, booking.currency, booking.referenceCode, {
      bookingId: booking.id,
      paymentType: dto.paymentType,
    });

    const payment = this.paymentRepo.create({
      bookingId: booking.id,
      provider: provider.name,
      method: dto.method,
      paymentType: dto.paymentType,
      amount,
      currency: booking.currency,
      status: 'pending',
      transactionReference: result.transactionReference,
      rawPayload: result.providerPayload,
    });
    await this.paymentRepo.save(payment);

    return { payment, redirectUrl: result.redirectUrl };
  }

  async handleWebhook(dto: ConfirmWebhookDto) {
    const payment = await this.paymentRepo.findOne({
      where: { transactionReference: dto.transactionReference },
      relations: ['booking'],
    });
    if (!payment) throw new NotFoundException('Paiement introuvable');

    const provider = this.getProvider(dto.provider);
    const verify = await provider.verifyPayment(dto.transactionReference);

    payment.rawPayload = { ...payment.rawPayload, ...verify.rawPayload, ...dto.payload };

    if (verify.success) {
      payment.status = 'completed';
      payment.paidAt = new Date();

      // Update booking payment status
      if (payment.paymentType === 'rental') {
        payment.booking.paymentStatus = 'paid';
        if (payment.booking.status === 'awaiting_payment') {
          payment.booking.status = 'confirmed';
        }
      } else {
        payment.booking.paymentStatus = 'partially_paid';
      }
      await this.bookingRepo.save(payment.booking);
    } else {
      payment.status = 'failed';
    }

    return this.paymentRepo.save(payment);
  }

  async getBookingPayments(bookingId: string) {
    return this.paymentRepo.find({ where: { bookingId }, order: { createdAt: 'DESC' } });
  }

  async onSitePayment(bookingId: string, ownerUserId: string, amount: number) {
    // Look up the lessor by ownerUserId
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) throw new NotFoundException('Profil loueur introuvable');

    const booking = await this.bookingRepo.findOne({ where: { id: bookingId, lessorId: lessor.id } });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    const payment = this.paymentRepo.create({
      bookingId,
      provider: 'on_site',
      method: 'cash',
      paymentType: 'rental',
      amount,
      currency: 'DZD',
      status: 'completed',
      transactionReference: `CASH-${booking.referenceCode}-${Date.now()}`,
      paidAt: new Date(),
    });
    booking.paymentStatus = 'paid';
    if (booking.status === 'confirmed') booking.status = 'completed';
    await this.bookingRepo.save(booking);
    return this.paymentRepo.save(payment);
  }

  private groupLabel(date: Date, granularity: string): string {
    const d = new Date(date);
    if (granularity === 'week') {
      // ISO week start (Monday)
      const day = d.getDay() || 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - day + 1);
      return `Sem. ${monday.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
    }
    if (granularity === 'month') {
      return d.toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' });
    }
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }

  async getLessorPayments(ownerUserId: string, period: string, granularity: string = 'day') {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) throw new NotFoundException('Profil loueur introuvable');
    return this.computeLessorPayments(lessor, period, granularity);
  }

  async getLessorPaymentsById(lessorId: string, period: string, granularity: string = 'day') {
    const lessor = await this.lessorRepo.findOne({ where: { id: lessorId } });
    if (!lessor) throw new NotFoundException('Loueur introuvable');
    return this.computeLessorPayments(lessor, period, granularity);
  }

  private async computeLessorPayments(lessor: Lessor, period: string, granularity: string = 'day') {
    // Determine date range
    const now = new Date();
    let startDate: Date;
    if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), q * 3, 1);
    } else {
      // month (default)
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const bookings = await this.bookingRepo.find({
      where: { lessorId: lessor.id },
      relations: ['vehicle'],
      order: { createdAt: 'DESC' },
    });

    const periodBookings = bookings.filter(b => new Date(b.createdAt) >= startDate);
    const completed = periodBookings.filter(b => b.status === 'completed' || b.paymentStatus === 'paid');

    const settings = await this.settingsService.getSettings();
    const rateFor = (b: Booking) => this.settingsService.resolveCommissionRate(lessor, settings, new Date(b.createdAt));
    const isWelcome = (b: Booking) =>
      !!lessor.welcomePeriodEndsAt && new Date(b.createdAt) < new Date(lessor.welcomePeriodEndsAt);

    const grossTotal = completed.reduce((s, b) => s + parseFloat(String(b.totalAmount || 0)), 0);
    const commission = completed.reduce((s, b) => s + parseFloat(String(b.totalAmount || 0)) * rateFor(b), 0);
    const netTotal = Math.round(grossTotal - commission);
    const welcomeAmount = completed
      .filter(isWelcome)
      .reduce((s, b) => s + parseFloat(String(b.totalAmount || 0)), 0);
    const commissionableAmount = grossTotal - welcomeAmount;
    const pendingList = bookings.filter(b => b.paymentStatus === 'not_paid' && b.status === 'confirmed');

    // Revenue series: group by granularity (day | week | month)
    const seriesMap = new Map<string, number>();
    for (const b of completed) {
      const label = this.groupLabel(new Date(b.createdAt), granularity);
      seriesMap.set(label, (seriesMap.get(label) || 0) + parseFloat(String(b.totalAmount || 0)));
    }
    const revenueSeries = Array.from(seriesMap.entries()).map(([label, v]) => ({ label, v }));

    return {
      summary: {
        grossTotal,
        netTotal,
        commission: Math.round(commission),
        welcomeAmount: Math.round(welcomeAmount),
        commissionableAmount: Math.round(commissionableAmount),
        pendingCount: pendingList.length,
        pendingAmount: pendingList.reduce((s, b) => s + parseFloat(String(b.totalAmount || 0)), 0),
      },
      revenueSeries,
      transactions: completed.map(b => ({
        id: b.id,
        referenceCode: b.referenceCode,
        vehicleName: b.vehicle ? `${b.vehicle.brand} ${b.vehicle.model}` : '—',
        pickupAt: b.pickupAt,
        returnAt: b.returnAt,
        totalAmount: parseFloat(String(b.totalAmount || 0)),
        netAmount: Math.round(parseFloat(String(b.totalAmount || 0)) * (1 - rateFor(b))),
        commissionAmount: Math.round(parseFloat(String(b.totalAmount || 0)) * rateFor(b)),
        isWelcome: isWelcome(b),
        paymentMethod: 'virement',
        status: b.paymentStatus,
        createdAt: b.createdAt,
      })),
    };
  }
}

// ─── Controller ─────────────────────────────────────────────
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('init')
  @ApiOperation({ summary: 'Initier un paiement (CIB, Edahabia, mock)' })
  init(@Request() req: any, @Body() dto: InitPaymentDto) {
    return this.paymentsService.initPayment(req.user.id, dto);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Webhook de confirmation paiement' })
  webhook(@Body() dto: ConfirmWebhookDto) {
    return this.paymentsService.handleWebhook(dto);
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'Paiements d\'une réservation' })
  getBookingPayments(@Param('bookingId') bookingId: string) {
    return this.paymentsService.getBookingPayments(bookingId);
  }

  @Post('on-site/:bookingId')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Enregistrer un paiement en espèces (loueur)' })
  onSite(
    @Param('bookingId') bookingId: string,
    @Request() req: any,
    @Body() body: { amount: number },
  ) {
    return this.paymentsService.onSitePayment(bookingId, req.user.id, body.amount);
  }

  @Get('lessor')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Revenus du loueur par période' })
  lessorPayments(
    @Request() req: any,
    @Query('period') period: string = 'month',
    @Query('granularity') granularity: string = 'day',
  ) {
    return this.paymentsService.getLessorPayments(req.user.id, period, granularity);
  }

  @Get('lessor/export')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Export Excel des paiements du loueur' })
  async lessorPaymentsExport(
    @Request() req: any,
    @Res() res: Response,
    @Query('period') period: string = 'month',
    @Query('granularity') granularity: string = 'day',
  ) {
    const data = await this.paymentsService.getLessorPayments(req.user.id, period, granularity);
    const buffer = await buildPaymentsWorkbook(data);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="paiements-${period}.xlsx"`,
    });
    res.send(buffer);
  }

  @Get('admin/lessors/:id/export')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Export Excel des paiements d\'un loueur (admin)' })
  async adminLessorPaymentsExport(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('period') period: string = 'month',
    @Query('granularity') granularity: string = 'day',
  ) {
    const data = await this.paymentsService.getLessorPaymentsById(id, period, granularity);
    const buffer = await buildPaymentsWorkbook(data);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="paiements-${period}.xlsx"`,
    });
    res.send(buffer);
  }
}

// ─── Module ─────────────────────────────────────────────────
@Module({
  imports: [TypeOrmModule.forFeature([Payment, Booking, Lessor]), SettingsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider, SatimPaymentProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
