// ============================================================
// PRICING MODULE
// ============================================================
import { Module, Controller, Get, Post, Delete, Body, Param, UseGuards, Request, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsString, IsNumber, IsOptional, IsDateString } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PricingRule } from '../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from './auth/auth.module';

export class CreatePricingRuleDto {
  @IsString() vehicleId: string;
  @IsNumber() @IsOptional() minDays?: number;
  @IsNumber() @IsOptional() maxDays?: number;
  @IsString() @IsOptional() seasonName?: string;
  @IsDateString() @IsOptional() startDate?: string;
  @IsDateString() @IsOptional() endDate?: string;
  @IsNumber() @IsOptional() dailyPrice?: number;
  @IsNumber() @IsOptional() weeklyPrice?: number;
  @IsNumber() @IsOptional() monthlyPrice?: number;
  @IsNumber() @IsOptional() airportDeliveryFee?: number;
  @IsNumber() @IsOptional() extraDriverFee?: number;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingRule)
    private readonly rulesRepo: Repository<PricingRule>,
  ) {}

  async getForVehicle(vehicleId: string) {
    return this.rulesRepo.find({ where: { vehicleId }, order: { createdAt: 'ASC' } });
  }

  async create(dto: CreatePricingRuleDto) {
    const rule = this.rulesRepo.create(dto);
    return this.rulesRepo.save(rule);
  }

  async delete(id: string) {
    const rule = await this.rulesRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException();
    await this.rulesRepo.delete(id);
    return { message: 'Règle supprimée' };
  }

  computePrice(vehicle: { dailyPriceBase: number; weeklyPriceBase?: number; monthlyPriceBase?: number }, days: number, rules: PricingRule[]): number {
    // Check seasonal / duration rules first
    const today = new Date().toISOString().slice(0, 10);
    const matchingRule = rules.find((r) => {
      const inDuration = (!r.minDays || days >= r.minDays) && (!r.maxDays || days <= r.maxDays);
      const inSeason = (!r.startDate || today >= r.startDate) && (!r.endDate || today <= r.endDate);
      return inDuration && inSeason;
    });

    if (matchingRule?.dailyPrice) return Number(matchingRule.dailyPrice) * days;
    if (matchingRule?.weeklyPrice && days >= 7) return (Number(matchingRule.weeklyPrice) / 7) * days;

    if (days >= 30 && vehicle.monthlyPriceBase) return (Number(vehicle.monthlyPriceBase) / 30) * days;
    if (days >= 7 && vehicle.weeklyPriceBase) return (Number(vehicle.weeklyPriceBase) / 7) * days;
    return Number(vehicle.dailyPriceBase) * days;
  }
}

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('lessor', 'admin')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('vehicle/:vehicleId')
  getForVehicle(@Param('vehicleId') vehicleId: string) {
    return this.pricingService.getForVehicle(vehicleId);
  }

  @Post()
  create(@Body() dto: CreatePricingRuleDto) {
    return this.pricingService.create(dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.pricingService.delete(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([PricingRule])],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}

// ============================================================
// DOCUMENTS MODULE
// ============================================================
import { Injectable as Injectable2, Module as Module2, Controller as Controller2, Post as Post2, Get as Get2, Patch as Patch2, Body as Body2, Param as Param2, UploadedFile, UseInterceptors, UseGuards as UseGuards2, Request as Request2 } from '@nestjs/common';
import { InjectRepository as InjectRepository2 } from '@nestjs/typeorm';
import { Repository as Repository2 } from 'typeorm';
import { TypeOrmModule as TypeOrmModule2 } from '@nestjs/typeorm';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsString as IsString2, IsOptional as IsOptional2 } from 'class-validator';
import { ApiTags as ApiTags2, ApiBearerAuth as ApiBearerAuth2 } from '@nestjs/swagger';
import { Document, Booking, Lessor } from '../database/entities';
import { ConfigService as ConfigService2 } from '@nestjs/config';
import { ForbiddenException as DocsForbidden } from '@nestjs/common';

@Injectable2()
export class DocumentsService {
  constructor(
    @InjectRepository2(Document) private readonly docRepo: Repository2<Document>,
    @InjectRepository2(Booking) private readonly docBookingRepo: Repository2<Booking>,
    @InjectRepository2(Lessor) private readonly docLessorRepo: Repository2<Lessor>,
    private readonly config: ConfigService2,
  ) {}

  async upload(ownerType: string, ownerId: string, documentType: string, file: Express.Multer.File) {
    const { join, extname } = require('path');
    const { existsSync, mkdirSync, writeFileSync } = require('fs');
    const ext = extname(file.originalname) || '.bin';
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const folder = `documents/${ownerType}/${ownerId}`;
    // Use UPLOAD_DIR env var so Railway/Docker can point to a writable volume (/tmp/uploads)
    const baseDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
    const dir = join(baseDir, folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);
    const url = `/uploads/${folder}/${filename}`;

    const doc = this.docRepo.create({ ownerType, ownerId, documentType, url, verificationStatus: 'pending' });
    return this.docRepo.save(doc);
  }

  async getForOwner(ownerType: string, ownerId: string, requesterId: string, requesterRole?: string) {
    if (ownerType === 'booking' && !['admin', 'support_agent'].includes(requesterRole)) {
      const booking = await this.docBookingRepo.findOne({ where: { id: ownerId } });
      if (!booking) throw new SupportNotFound('Réservation introuvable');
      const lessor = await this.docLessorRepo.findOne({ where: { ownerUserId: requesterId } });
      const isLessor = !!lessor && booking.lessorId === lessor.id;
      if (booking.customerId !== requesterId && !isLessor) {
        throw new DocsForbidden();
      }
    }
    return this.docRepo.find({ where: { ownerType, ownerId } });
  }

  async verify(id: string, status: 'approved' | 'rejected', reason?: string) {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new Error('Document introuvable');
    doc.verificationStatus = status;
    if (reason) doc.rejectionReason = reason;
    return this.docRepo.save(doc);
  }
}

@ApiTags2('documents')
@ApiBearerAuth2()
@UseGuards2(JwtAuthGuard)
@Controller2('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post2('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body2() body: { ownerType: string; ownerId: string; documentType: string },
    @Request2() req: any,
  ) {
    return this.documentsService.upload(body.ownerType, body.ownerId, body.documentType, file);
  }

  @Get2(':ownerType/:ownerId')
  getForOwner(
    @Param2('ownerType') ownerType: string,
    @Param2('ownerId') ownerId: string,
    @Request2() req: any,
  ) {
    return this.documentsService.getForOwner(ownerType, ownerId, req.user.id, req.user.role);
  }
}

@Module2({
  imports: [TypeOrmModule2.forFeature([Document, Booking, Lessor])],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

// ============================================================
// REVIEWS MODULE
// ============================================================
import { Module as ReviewsModuleDef, Controller as ReviewsCtrl, Get as ReviewsGet, Post as ReviewsPost, Body as ReviewsBody, Param as ReviewsParam, UseGuards as ReviewsGuard, Request as ReviewsReq, Injectable as ReviewsInj } from '@nestjs/common';
import { InjectRepository as ReviewsInject } from '@nestjs/typeorm';
import { Repository as ReviewsRepo } from 'typeorm';
import { TypeOrmModule as ReviewsORM } from '@nestjs/typeorm';
import { IsNumber as ReviewsIsNumber, IsString as ReviewsIsStr, IsOptional as ReviewsIsOpt, Min as ReviewsMin, Max as ReviewsMax } from 'class-validator';
import { ApiTags as ReviewsApiTags } from '@nestjs/swagger';
import { Review, Vehicle, User } from '../database/entities';

export class CreateReviewDto {
  @ReviewsIsStr() bookingId: string;
  @ReviewsIsNumber() @ReviewsMin(1) @ReviewsMax(5) rating: number;
  @ReviewsIsStr() @ReviewsIsOpt() comment?: string;
}

@ReviewsInj()
export class ReviewsService {
  constructor(
    @ReviewsInject(Review) private readonly reviewRepo: ReviewsRepo<Review>,
    @ReviewsInject(Booking) private readonly bookingRepo: ReviewsRepo<Booking>,
    @ReviewsInject(Vehicle) private readonly vehicleRepo: ReviewsRepo<Vehicle>,
    @ReviewsInject(Lessor) private readonly lessorRepo: ReviewsRepo<Lessor>,
  ) {}

  async create(customerId: string, dto: CreateReviewDto) {
    const booking = await this.bookingRepo.findOne({
      where: { id: dto.bookingId, customerId, status: 'completed' },
    });
    if (!booking) throw new Error('Réservation non trouvée ou non terminée');

    const review = this.reviewRepo.create({
      bookingId: dto.bookingId,
      customerId,
      lessorId: booking.lessorId,
      vehicleId: booking.vehicleId,
      rating: dto.rating,
      comment: dto.comment,
    });
    const saved = await this.reviewRepo.save(review);

    // Update vehicle rating
    const vReviews = await this.reviewRepo.find({ where: { vehicleId: booking.vehicleId } });
    const avg = vReviews.reduce((s, r) => s + Number(r.rating), 0) / vReviews.length;
    await this.vehicleRepo.update(booking.vehicleId, {
      ratingAverage: Math.round(avg * 10) / 10,
      reviewCount: vReviews.length,
    });

    return saved;
  }

  async getForVehicle(vehicleId: string) {
    return this.reviewRepo.find({
      where: { vehicleId },
      relations: ['customer'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}

@ReviewsApiTags('reviews')
@ReviewsCtrl('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ReviewsPost()
  @ReviewsGuard(JwtAuthGuard)
  create(@ReviewsReq() req: any, @ReviewsBody() dto: CreateReviewDto) {
    return this.reviewsService.create(req.user.id, dto);
  }

  @ReviewsGet('vehicle/:vehicleId')
  getForVehicle(@ReviewsParam('vehicleId') vehicleId: string) {
    return this.reviewsService.getForVehicle(vehicleId);
  }
}

@ReviewsModuleDef({
  imports: [ReviewsORM.forFeature([Review, Booking, Vehicle, Lessor])],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}

// ============================================================
// NOTIFICATIONS MODULE (stub)
// ============================================================
import { Module as NotifsModule, Injectable as NotifsInj } from '@nestjs/common';

@NotifsInj()
export class NotificationsService {
  async sendPush(userId: string, title: string, body: string, data?: Record<string, any>) {
    console.log(`[Push] → ${userId}: ${title} — ${body}`, data);
    // TODO: Firebase Admin SDK integration
  }

  async sendSms(phone: string, message: string) {
    console.log(`[SMS] → ${phone}: ${message}`);
    // TODO: Twilio / local SMS provider
  }

  async sendEmail(to: string, subject: string, html: string) {
    console.log(`[Email] → ${to}: ${subject}`);
    // TODO: Nodemailer / SMTP
  }
}

@NotifsModule({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}

// ============================================================
// SUPPORT MODULE — tickets + chat messages
// ============================================================
import {
  Module as SupportMod, Controller as SupportCtrl,
  Get as SupportGet, Post as SupportPost, Param as SupportParam,
  Body as SupportBody, UseGuards as SupportGuard,
  Request as SupportReq, Injectable as SupportInj,
  NotFoundException as SupportNotFound, ForbiddenException as SupportForbidden,
} from '@nestjs/common';
import { InjectRepository as SupportInject } from '@nestjs/typeorm';
import { Repository as SupportRepo } from 'typeorm';
import { TypeOrmModule as SupportORM } from '@nestjs/typeorm';
import { SupportTicket, SupportMessage } from '../database/entities';
import { ApiTags as SupportApiTags } from '@nestjs/swagger';

@SupportInj()
export class SupportService {
  constructor(
    @SupportInject(SupportTicket) private readonly ticketRepo: SupportRepo<SupportTicket>,
    @SupportInject(SupportMessage) private readonly msgRepo: SupportRepo<SupportMessage>,
    @SupportInject(Booking) private readonly bookingRepo: SupportRepo<Booking>,
    @SupportInject(Lessor) private readonly lessorRepo: SupportRepo<Lessor>,
  ) {}

  // True if the user is the customer or lessor of the booking linked to this ticket
  private async canAccessBookingTicket(bookingId: string | null, userId: string) {
    if (!bookingId) return false;
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) return false;
    if (booking.customerId === userId) return true;
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId: userId } });
    return !!lessor && booking.lessorId === lessor.id;
  }

  async getTicketByBooking(bookingId: string, userId: string, userRole?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { bookingId } });
    if (!ticket) return null;
    if (
      ticket.openedByUserId !== userId &&
      ticket.assignedToUserId !== userId &&
      !['admin', 'support_agent'].includes(userRole) &&
      !(await this.canAccessBookingTicket(bookingId, userId))
    ) {
      throw new SupportForbidden();
    }
    const messages = await this.msgRepo.find({
      where: { ticketId: ticket.id },
      relations: ['sender'],
      order: { createdAt: 'ASC' },
    });
    return { ...ticket, messages };
  }

  async create(userId: string, data: { message: string; category?: string; bookingId?: string }) {
    const ticket = this.ticketRepo.create({
      openedByUserId: userId,
      message: data.message,
      category: data.category,
      bookingId: data.bookingId,
      status: 'open',
      priority: 'medium',
    });
    const saved = await this.ticketRepo.save(ticket);
    // First message = ticket body
    let role = 'customer';
    if (data.bookingId) {
      const booking = await this.bookingRepo.findOne({ where: { id: data.bookingId } });
      if (booking) {
        if (booking.customerId === userId) role = 'customer';
        else {
          const lessor = await this.lessorRepo.findOne({ where: { id: booking.lessorId } });
          if (lessor && lessor.ownerUserId === userId) role = 'lessor';
        }
      }
    }
    await this.msgRepo.save(this.msgRepo.create({
      ticketId: saved.id,
      senderId: userId,
      body: data.message,
      senderRole: role,
    }));
    return saved;
  }

  async getMyTickets(userId: string) {
    const tickets = await this.ticketRepo.find({
      where: { openedByUserId: userId },
      relations: ['messages'],
      order: { updatedAt: 'DESC' },
    });
    return tickets.map(t => ({
      ...t,
      lastMessage: t.messages?.length ? t.messages[t.messages.length - 1].body : t.message,
      unread: false,
    }));
  }

  async getLessorTickets(userId: string) {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId: userId } });
    if (!lessor) return [];

    const lessorBookings = await this.bookingRepo.find({ where: { lessorId: lessor.id } });
    const bookingIds = lessorBookings.map(b => b.id);

    const tickets = await this.ticketRepo.find({
      relations: ['messages'],
      order: { updatedAt: 'DESC' },
    });
    const relevant = tickets.filter(t =>
      t.openedByUserId === userId ||
      (t.bookingId && bookingIds.includes(t.bookingId)),
    );
    return relevant.map(t => ({
      ...t,
      lastMessage: t.messages?.length ? t.messages[t.messages.length - 1].body : t.message,
      unread: false,
    }));
  }

  async getTicketWithMessages(ticketId: string, userId: string, userRole?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new SupportNotFound('Ticket introuvable');
    if (
      ticket.openedByUserId !== userId &&
      ticket.assignedToUserId !== userId &&
      !['admin', 'support_agent'].includes(userRole) &&
      !(await this.canAccessBookingTicket(ticket.bookingId, userId))
    ) {
      throw new SupportForbidden();
    }
    const messages = await this.msgRepo.find({
      where: { ticketId },
      relations: ['sender'],
      order: { createdAt: 'ASC' },
    });
    return { ...ticket, messages };
  }

  async addMessage(ticketId: string, senderId: string, body: string, senderRole: string, userRole?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new SupportNotFound('Ticket introuvable');
    if (
      ticket.openedByUserId !== senderId &&
      ticket.assignedToUserId !== senderId &&
      !['admin', 'support_agent'].includes(userRole) &&
      !(await this.canAccessBookingTicket(ticket.bookingId, senderId))
    ) {
      throw new SupportForbidden();
    }
    let role = senderRole;
    if (ticket.bookingId) {
      const booking = await this.bookingRepo.findOne({ where: { id: ticket.bookingId } });
      if (booking) {
        if (booking.customerId === senderId) role = 'customer';
        else {
          const lessor = await this.lessorRepo.findOne({ where: { id: booking.lessorId } });
          if (lessor && lessor.ownerUserId === senderId) role = 'lessor';
        }
      }
    }
    const msg = this.msgRepo.create({ ticketId, senderId, body, senderRole: role });
    return this.msgRepo.save(msg);
  }

  async getAll() {
    return this.ticketRepo.find({ order: { createdAt: 'DESC' } });
  }
}

@SupportApiTags('support')
@SupportCtrl('support')
@SupportGuard(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @SupportPost()
  create(@SupportReq() req: any, @SupportBody() body: any) {
    return this.supportService.create(req.user.id, body);
  }

  @SupportGet('booking/:bookingId')
  getByBooking(@SupportParam('bookingId') bookingId: string, @SupportReq() req: any) {
    return this.supportService.getTicketByBooking(bookingId, req.user.id, req.user.role);
  }

  @SupportGet('my')
  getMyTickets(@SupportReq() req: any) {
    return this.supportService.getMyTickets(req.user.id);
  }

  @SupportGet('lessor')
  getLessorTickets(@SupportReq() req: any) {
    return this.supportService.getLessorTickets(req.user.id);
  }

  @SupportGet(':id')
  getTicket(@SupportParam('id') id: string, @SupportReq() req: any) {
    return this.supportService.getTicketWithMessages(id, req.user.id, req.user.role);
  }

  @SupportGet(':id/messages')
  getMessages(@SupportParam('id') id: string, @SupportReq() req: any) {
    return this.supportService.getTicketWithMessages(id, req.user.id, req.user.role).then(t => t.messages);
  }

  @SupportPost(':id/messages')
  addMessage(
    @SupportParam('id') id: string,
    @SupportReq() req: any,
    @SupportBody() body: { body: string },
  ) {
    const role = ['support_agent', 'admin'].includes(req.user.role) ? 'support' : 'customer';
    return this.supportService.addMessage(id, req.user.id, body.body, role, req.user.role);
  }
}

@SupportMod({
  imports: [SupportORM.forFeature([SupportTicket, SupportMessage, Booking, Lessor])],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}

// ============================================================
// ADMIN MODULE
// ============================================================
import {
  Module as AdminMod, Controller as AdminCtrl, Get as AdminGet,
  Post as AdminPost, Patch as AdminPatch, Delete as AdminDelete, Param as AdminParam,
  Body as AdminBody, Query as AdminQuery, UseGuards as AdminGuard, Res as AdminRes,
  Injectable as AdminInj, ConflictException as AdminConflict,
  NotFoundException as AdminNotFound,
} from '@nestjs/common';
import type { Response as AdminResponse } from 'express';
import { InjectRepository as AdminInject } from '@nestjs/typeorm';
import { Repository as AdminRepo, MoreThanOrEqual, Between } from 'typeorm';
import { TypeOrmModule as AdminORM } from '@nestjs/typeorm';
import { ApiTags as AdminApiTags, ApiBearerAuth as AdminBearer } from '@nestjs/swagger';
import * as bcryptAdmin from 'bcrypt';
import { SettingsModule, SettingsService } from './settings/settings.module';
import { buildInvoicePdf, InvoiceData, InvoiceLine } from '../common/invoice-pdf.util';
import { sendMailWithAttachment } from '../common/mailer.util';

@AdminInj()
export class AdminService {
  constructor(
    @AdminInject(Lessor) private readonly lessorRepo: AdminRepo<Lessor>,
    @AdminInject(Vehicle) private readonly vehicleRepo: AdminRepo<Vehicle>,
    @AdminInject(Booking) private readonly bookingRepo: AdminRepo<Booking>,
    @AdminInject(User) private readonly userRepo: AdminRepo<User>,
    @AdminInject(SupportTicket) private readonly ticketRepo: AdminRepo<SupportTicket>,
    private readonly settingsService: SettingsService,
  ) {}

  private getPeriodStart(period: string, date?: string): Date {
    const ref = date ? new Date(date) : new Date();
    if (period === 'year') return new Date(ref.getFullYear(), 0, 1);
    if (period === 'quarter') {
      const q = Math.floor(ref.getMonth() / 3);
      return new Date(ref.getFullYear(), q * 3, 1);
    }
    return new Date(ref.getFullYear(), ref.getMonth(), 1);
  }

  async getDashboard() {
    const [activeLessors, pendingLessors, publishedVehicles, vehiclesUnderReview, totalBookings, pendingBookings] = await Promise.all([
      this.lessorRepo.count({ where: { status: 'approved' } }),
      this.lessorRepo.count({ where: { status: 'pending' } }),
      this.vehicleRepo.count({ where: { published: true } }),
      this.vehicleRepo.count({ where: { status: 'under_review' } }),
      this.bookingRepo.count(),
      this.bookingRepo.count({ where: { status: 'pending' } }),
    ]);

    // Total volume from completed bookings
    const volumeResult = await this.bookingRepo
      .createQueryBuilder('b')
      .select('SUM(CAST(b.totalAmount AS DECIMAL))', 'total')
      .where('b.status = :status', { status: 'completed' })
      .getRawOne();
    const totalVolume = parseFloat(volumeResult?.total || '0');
    const financeSummary = await this.getFinanceSummary('month');

    // Trend: current month vs previous month
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      bookingsThisMonth, bookingsLastMonth,
      lessorsThisMonth,  lessorsLastMonth,
      vehiclesThisMonth, vehiclesLastMonth,
      volThisRaw, volLastRaw,
    ] = await Promise.all([
      this.bookingRepo.count({ where: { createdAt: MoreThanOrEqual(thisMonthStart) } }),
      this.bookingRepo.count({ where: { createdAt: Between(lastMonthStart, lastMonthEnd) } }),
      this.lessorRepo.count({ where: { createdAt: MoreThanOrEqual(thisMonthStart) } }),
      this.lessorRepo.count({ where: { createdAt: Between(lastMonthStart, lastMonthEnd) } }),
      this.vehicleRepo.count({ where: { createdAt: MoreThanOrEqual(thisMonthStart) } }),
      this.vehicleRepo.count({ where: { createdAt: Between(lastMonthStart, lastMonthEnd) } }),
      this.bookingRepo.createQueryBuilder('b')
        .select('SUM(CAST(b.totalAmount AS DECIMAL))', 'total')
        .where('b.status IN (:...st)', { st: ['confirmed', 'completed'] })
        .andWhere('b.createdAt >= :s', { s: thisMonthStart }).getRawOne(),
      this.bookingRepo.createQueryBuilder('b')
        .select('SUM(CAST(b.totalAmount AS DECIMAL))', 'total')
        .where('b.status IN (:...st)', { st: ['confirmed', 'completed'] })
        .andWhere('b.createdAt BETWEEN :s AND :e', { s: lastMonthStart, e: lastMonthEnd }).getRawOne(),
    ]);

    const volThis = parseFloat(volThisRaw?.total || '0');
    const volLast = parseFloat(volLastRaw?.total || '0');

    const calcTrend = (curr: number, prev: number) => {
      const dir = curr >= prev ? 'up' : 'down';
      if (prev === 0) return { dir, value: curr > 0 ? `+${curr}` : '0' };
      const pct = Math.round(((curr - prev) / prev) * 100);
      return { dir, value: `${pct >= 0 ? '+' : ''}${pct}%` };
    };

    // Revenue series: last 30 days
    const revenueSeries = await this.bookingRepo
      .createQueryBuilder('b')
      .select("TO_CHAR(b.createdAt, 'DD/MM')", 'label')
      .addSelect('SUM(CAST(b.totalAmount AS DECIMAL))', 'v')
      .where("b.createdAt >= NOW() - INTERVAL '30 days'")
      .andWhere('b.status IN (:...statuses)', { statuses: ['confirmed', 'completed'] })
      .groupBy("TO_CHAR(b.createdAt, 'DD/MM')")
      .orderBy("MIN(b.createdAt)", 'ASC')
      .getRawMany();

    // Top wilayas by number of bookings
    const topWilayasRaw = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.vehicle', 'v')
      .select('v.pickupCity', 'wilaya')
      .addSelect('COUNT(*)', 'count')
      .where('v.pickupCity IS NOT NULL')
      .groupBy('v.pickupCity')
      .orderBy('count', 'DESC')
      .limit(5)
      .getRawMany();
    const topWilayas = topWilayasRaw.map(r => ({ wilaya: r.wilaya, count: parseInt(r.count, 10) }));

    // Recent bookings
    const recentBookings = await this.bookingRepo.find({
      order: { createdAt: 'DESC' },
      take: 5,
      relations: ['customer', 'vehicle'],
    });

    return {
      activeLessors, pendingLessors,
      publishedVehicles, vehiclesUnderReview,
      totalBookings, pendingBookings,
      totalVolume,
      totalCommission: financeSummary.commissionTotal,
      financeSummary,
      trends: {
        lessors:  calcTrend(lessorsThisMonth,  lessorsLastMonth),
        vehicles: calcTrend(vehiclesThisMonth, vehiclesLastMonth),
        bookings: calcTrend(bookingsThisMonth, bookingsLastMonth),
        volume:   calcTrend(volThis, volLast),
      },
      revenueSeries: revenueSeries.map(r => ({ label: r.label, v: parseFloat(r.v || '0') })),
      topWilayas,
      recentBookings: recentBookings.map(b => ({
        id: b.id,
        ref: b.referenceCode,
        customerName: b.customer ? `${b.customer.firstName} ${b.customer.lastName}` : '—',
        vehicleName: b.vehicle ? `${b.vehicle.brand} ${b.vehicle.model}` : '—',
        status: b.status,
        amount: parseFloat(b.totalAmount as any),
        createdAt: b.createdAt,
      })),
    };
  }

  async getLessorsMap() {
    const lessors = await this.lessorRepo.find({
      where: { status: 'approved' },
      select: ['id', 'wilaya', 'businessName'] as any,
    });

    const revenueRaw = await this.bookingRepo
      .createQueryBuilder('b')
      .select('b.lessorId', 'lessorId')
      .addSelect('SUM(CAST(b.totalAmount AS DECIMAL))', 'revenue')
      .where('b.status IN (:...st)', { st: ['confirmed', 'completed'] })
      .groupBy('b.lessorId')
      .getRawMany();

    const revenueMap = new Map<string, number>(revenueRaw.map(r => [r.lessorId, parseFloat(r.revenue || '0')]));

    const byWilaya = new Map<string, { wilaya: string; lessorCount: number; totalRevenue: number; names: string[] }>();
    for (const l of lessors) {
      const wilaya = (l.wilaya || 'Non spécifiée').trim();
      if (!byWilaya.has(wilaya)) byWilaya.set(wilaya, { wilaya, lessorCount: 0, totalRevenue: 0, names: [] });
      const e = byWilaya.get(wilaya)!;
      e.lessorCount++;
      e.totalRevenue = Math.round(e.totalRevenue + (revenueMap.get(l.id) || 0));
      e.names.push(l.businessName);
    }

    return Array.from(byWilaya.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  // ─── Lessors ─────────────────────────────────────────────────

  async createLessor(dto: {
    firstName: string; lastName: string; email: string; phone: string;
    password: string; businessName: string; type?: string; wilaya?: string;
    commissionRate?: number; welcomePeriodMonths?: number;
  }) {
    const existing = await this.userRepo.findOne({ where: [{ email: dto.email }, { phone: dto.phone }] });
    if (existing) throw new AdminConflict('Email ou téléphone déjà utilisé');
    const user = this.userRepo.create({
      firstName: dto.firstName, lastName: dto.lastName,
      email: dto.email, phone: dto.phone,
      role: 'lessor',
      passwordHash: await bcryptAdmin.hash(dto.password, 12),
      isActive: true, isVerified: true,
    });
    const savedUser = await this.userRepo.save(user);
    let welcomePeriodEndsAt: Date | null = null;
    if (dto.welcomePeriodMonths) {
      welcomePeriodEndsAt = new Date();
      welcomePeriodEndsAt.setMonth(welcomePeriodEndsAt.getMonth() + dto.welcomePeriodMonths);
    }
    const lessor = this.lessorRepo.create({
      ownerUserId: savedUser.id,
      businessName: dto.businessName,
      type: dto.type || 'independent',
      wilaya: dto.wilaya,
      status: 'approved',
      commissionRate: dto.commissionRate ?? null,
      welcomePeriodEndsAt,
    });
    const savedLessor = await this.lessorRepo.save(lessor);
    const { passwordHash, otpCode, otpExpiresAt, ...safeUser } = savedUser as any;
    return { user: safeUser, lessor: savedLessor };
  }

  async getAllLessors(status?: string) {
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    return this.lessorRepo.find({
      where,
      relations: ['owner'],
      order: { createdAt: 'DESC' },
    });
  }

  async approveLessor(id: string) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');
    await this.lessorRepo.update(id, { status: 'approved', rejectionReason: null });
    return { message: 'Loueur approuvé' };
  }

  async rejectLessor(id: string, reason: string) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');
    await this.lessorRepo.update(id, { status: 'rejected', rejectionReason: reason });
    return { message: 'Loueur refusé' };
  }

  async suspendLessor(id: string, reason?: string) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');
    await this.lessorRepo.update(id, { status: 'suspended', rejectionReason: reason || null });
    return { message: 'Loueur suspendu' };
  }

  async reactivateLessor(id: string) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');
    await this.lessorRepo.update(id, { status: 'approved', rejectionReason: null });
    return { message: 'Loueur réactivé' };
  }

  async updateLessor(id: string, dto: {
    firstName?: string; lastName?: string; email?: string; phone?: string;
    password?: string; businessName?: string; type?: string; wilaya?: string;
    commissionRate?: number | null; welcomePeriodEndsAt?: string | null;
  }) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');

    const userUpdate: any = {};
    if (dto.firstName !== undefined) userUpdate.firstName = dto.firstName;
    if (dto.lastName !== undefined) userUpdate.lastName = dto.lastName;
    if (dto.email !== undefined) userUpdate.email = dto.email;
    if (dto.phone !== undefined) userUpdate.phone = dto.phone;
    if (dto.password) userUpdate.passwordHash = await bcryptAdmin.hash(dto.password, 12);
    if (Object.keys(userUpdate).length) {
      await this.userRepo.update(lessor.ownerUserId, userUpdate);
    }

    const lessorUpdate: any = {};
    if (dto.businessName !== undefined) lessorUpdate.businessName = dto.businessName;
    if (dto.type !== undefined) lessorUpdate.type = dto.type;
    if (dto.wilaya !== undefined) lessorUpdate.wilaya = dto.wilaya;
    if (dto.commissionRate !== undefined) lessorUpdate.commissionRate = dto.commissionRate;
    if (dto.welcomePeriodEndsAt !== undefined) {
      lessorUpdate.welcomePeriodEndsAt = dto.welcomePeriodEndsAt ? new Date(dto.welcomePeriodEndsAt) : null;
    }
    if (Object.keys(lessorUpdate).length) {
      await this.lessorRepo.update(id, lessorUpdate);
    }

    return this.lessorRepo.findOne({ where: { id }, relations: ['owner'] });
  }

  async deleteLessor(id: string) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');
    await this.lessorRepo.delete(id);
    await this.userRepo.delete(lessor.ownerUserId);
    return { success: true };
  }

  async getPendingLessors() {
    return this.lessorRepo.find({
      where: { status: 'pending' },
      relations: ['owner'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Vehicles ────────────────────────────────────────────────

  async getAllVehicles(status?: string) {
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    return this.vehicleRepo.find({
      where,
      relations: ['lessor', 'photos'],
      order: { createdAt: 'DESC' },
    });
  }

  async approveVehicle(id: string) {
    await this.vehicleRepo.update(id, { status: 'active', published: true });
    return { message: 'Véhicule approuvé et publié' };
  }

  async rejectVehicle(id: string, reason: string) {
    await this.vehicleRepo.update(id, { status: 'rejected', published: false });
    return { message: 'Véhicule refusé' };
  }

  async getPendingVehicles() {
    return this.vehicleRepo.find({
      where: { status: 'under_review' },
      relations: ['lessor', 'photos'],
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Bookings ────────────────────────────────────────────────

  async getAllBookings(status?: string, page = 1, limit = 20, sortBy?: string, sortOrder?: string) {
    const sortMap: Record<string, string> = {
      date: 'b.createdAt',
      amount: 'b.totalAmount',
      customer: 'customer.firstName',
      lessor: 'lessor.businessName',
    };
    const orderField = sortMap[sortBy] || 'b.createdAt';
    const orderDir = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.bookingRepo.createQueryBuilder('b')
      .leftJoinAndSelect('b.customer', 'customer')
      .leftJoinAndSelect('b.vehicle', 'vehicle')
      .leftJoinAndSelect('b.lessor', 'lessor');
    if (status && status !== 'all') qb.andWhere('b.status = :status', { status });
    qb.orderBy(orderField, orderDir as 'ASC' | 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  // ─── Finance ─────────────────────────────────────────────────

  async getFinanceSummary(period = 'month', date?: string) {
    const start = this.getPeriodStart(period, date);
    const settings = await this.settingsService.getSettings();

    const bookings = await this.bookingRepo.find({
      relations: ['lessor'],
      where: {},
    });
    const periodBookings = bookings.filter(
      (b) => new Date(b.createdAt) >= start && (b.status === 'completed' || b.paymentStatus === 'paid'),
    );

    const byLessorMap = new Map<string, { lessorId: string; businessName: string; gross: number; commission: number; net: number }>();
    let grossTotal = 0;
    let commissionTotal = 0;

    for (const b of periodBookings) {
      const amount = parseFloat(String(b.totalAmount || 0));
      const rate = b.lessor ? this.settingsService.resolveCommissionRate(b.lessor, settings, new Date(b.createdAt)) : Number(settings.commissionRateDefault);
      const commission = amount * rate;
      grossTotal += amount;
      commissionTotal += commission;

      const entry = byLessorMap.get(b.lessorId) || {
        lessorId: b.lessorId,
        businessName: b.lessor?.businessName ?? '—',
        gross: 0, commission: 0, net: 0,
      };
      entry.gross += amount;
      entry.commission += commission;
      entry.net += amount - commission;
      byLessorMap.set(b.lessorId, entry);
    }

    return {
      period,
      grossTotal: Math.round(grossTotal),
      commissionTotal: Math.round(commissionTotal),
      netTotal: Math.round(grossTotal - commissionTotal),
      byLessor: Array.from(byLessorMap.values()).map((e) => ({
        lessorId: e.lessorId,
        businessName: e.businessName,
        gross: Math.round(e.gross),
        commission: Math.round(e.commission),
        net: Math.round(e.net),
      })),
    };
  }

  // ─── Global activity (all bookings across all lessors) ────────

  async getActivity(opts: {
    lessorId?: string; period?: string; date?: string; search?: string;
    sortBy?: string; sortOrder?: string; page?: number; limit?: number;
  }) {
    const settings = await this.settingsService.getSettings();
    const page = Number(opts.page) || 1;
    const limit = Math.min(Number(opts.limit) || 50, 200);

    const sortMap: Record<string, string> = {
      date: 'b.createdAt',
      amount: 'b.totalAmount',
      customer: 'customer.firstName',
      lessor: 'lessor.businessName',
    };
    const orderField = sortMap[opts.sortBy] || 'b.createdAt';
    const orderDir = opts.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.bookingRepo.createQueryBuilder('b')
      .leftJoinAndSelect('b.customer', 'customer')
      .leftJoinAndSelect('b.lessor', 'lessor')
      .leftJoinAndSelect('b.vehicle', 'vehicle');

    if (opts.lessorId) qb.andWhere('b.lessorId = :lessorId', { lessorId: opts.lessorId });
    if (opts.period) {
      const start = this.getPeriodStart(opts.period, opts.date);
      qb.andWhere('b.createdAt >= :start', { start });
    }
    if (opts.search) {
      qb.andWhere(
        `(b.referenceCode ILIKE :search
          OR customer.firstName ILIKE :search
          OR customer.lastName ILIKE :search
          OR lessor.businessName ILIKE :search
          OR vehicle.brand ILIKE :search
          OR vehicle.model ILIKE :search)`,
        { search: `%${opts.search}%` },
      );
    }

    qb.orderBy(orderField, orderDir as 'ASC' | 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [bookings, total] = await qb.getManyAndCount();

    const data = bookings.map((b) => {
      const amount = parseFloat(String(b.totalAmount || 0));
      const rate = b.lessor ? this.settingsService.resolveCommissionRate(b.lessor, settings, new Date(b.createdAt)) : Number(settings.commissionRateDefault);
      return {
        id: b.id,
        referenceCode: b.referenceCode,
        customerName: b.customer ? `${b.customer.firstName} ${b.customer.lastName}` : '—',
        lessorId: b.lessorId,
        lessorName: b.lessor?.businessName ?? '—',
        vehicleName: b.vehicle ? `${b.vehicle.brand} ${b.vehicle.model}` : '—',
        pickupAt: b.pickupAt,
        returnAt: b.returnAt,
        totalAmount: amount,
        status: b.status,
        paymentStatus: b.paymentStatus,
        commissionRate: rate,
        commissionAmount: Math.round(amount * rate),
        createdAt: b.createdAt,
      };
    });

    return { data, total, page, limit };
  }

  async deleteBooking(id: string) {
    const booking = await this.bookingRepo.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    await this.bookingRepo.delete(id);
    return { success: true };
  }

  // ─── Invoices ────────────────────────────────────────────────

  private resolveInvoicePeriod(period: string, type: string): { start: Date; end: Date; label: string } {
    if (type === 'quarter') {
      const [yearStr, qStr] = period.split('-Q');
      const year = Number(yearStr);
      const quarter = Number(qStr);
      if (!year || !quarter || quarter < 1 || quarter > 4) {
        throw new AdminConflict('Période invalide (attendu AAAA-Q1..Q4)');
      }
      const start = new Date(year, (quarter - 1) * 3, 1);
      const end = new Date(year, quarter * 3, 1);
      return { start, end, label: `T${quarter} ${year}` };
    }
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) throw new AdminConflict('Période invalide (attendu AAAA-MM)');
    const year = Number(m[1]);
    const month = Number(m[2]);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return { start, end, label };
  }

  async computeInvoiceData(lessorId: string, period: string, type: string): Promise<InvoiceData> {
    const lessor = await this.lessorRepo.findOne({ where: { id: lessorId } });
    if (!lessor) throw new AdminNotFound('Loueur introuvable');

    const { start, end, label } = this.resolveInvoicePeriod(period, type);
    const settings = await this.settingsService.getSettings();

    const bookings = await this.bookingRepo.find({
      where: { lessorId },
      relations: ['vehicle'],
      order: { createdAt: 'ASC' },
    });

    const inRange = bookings.filter((b) => {
      const created = new Date(b.createdAt);
      return created >= start && created < end && !['pending', 'rejected', 'cancelled'].includes(b.status);
    });

    let grossTotal = 0;
    let commissionTotal = 0;
    const lines: InvoiceLine[] = inRange.map((b) => {
      const amount = parseFloat(String(b.totalAmount || 0));
      const rate = this.settingsService.resolveCommissionRate(lessor, settings, new Date(b.createdAt));
      const commissionAmount = Math.round(amount * rate);
      const netAmount = amount - commissionAmount;
      grossTotal += amount;
      commissionTotal += commissionAmount;
      return {
        referenceCode: b.referenceCode,
        vehicleName: b.vehicle ? `${b.vehicle.brand} ${b.vehicle.model}` : '—',
        createdAt: b.createdAt,
        totalAmount: amount,
        commissionRate: rate,
        commissionAmount,
        netAmount,
        isWelcome: rate === 0,
      };
    });

    const shortId = lessor.id.replace(/-/g, '').slice(0, 8).toUpperCase();
    const reference = `INV-${shortId}-${period}`;

    return {
      reference,
      periodLabel: label,
      lessor: {
        businessName: lessor.businessName,
        legalIdentifier: lessor.legalIdentifier,
        taxIdentifier: lessor.taxIdentifier,
        address: lessor.address,
        wilaya: lessor.wilaya,
        city: lessor.city,
        rib: lessor.rib,
        email: lessor.email,
      },
      lines,
      totals: {
        grossTotal,
        commission: commissionTotal,
        netTotal: grossTotal - commissionTotal,
      },
    };
  }

  // ─── Support ─────────────────────────────────────────────────

  async getAllTickets(status?: string) {
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    return this.ticketRepo.find({
      where,
      relations: ['messages'],
      order: { createdAt: 'DESC' },
    });
  }

  async resolveTicket(id: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new AdminNotFound('Ticket introuvable');
    await this.ticketRepo.update(id, { status: 'resolved' });
    return { message: 'Ticket résolu' };
  }
}

@AdminApiTags('admin')
@AdminBearer()
@AdminCtrl('admin')
@AdminGuard(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @AdminGet('dashboard')
  dashboard() { return this.adminService.getDashboard(); }

  @AdminGet('lessors/map')
  getLessorsMap() { return this.adminService.getLessorsMap(); }

  // Lessors
  @AdminPost('lessors')
  createLessor(@AdminBody() body: any) { return this.adminService.createLessor(body); }

  @AdminGet('lessors')
  getAllLessors(@AdminQuery('status') status?: string) { return this.adminService.getAllLessors(status); }

  @AdminPatch('lessors/:id')
  updateLessor(@AdminParam('id') id: string, @AdminBody() body: any) { return this.adminService.updateLessor(id, body); }

  @AdminDelete('lessors/:id')
  deleteLessor(@AdminParam('id') id: string) { return this.adminService.deleteLessor(id); }

  @AdminGet('lessors/pending')
  getPendingLessors() { return this.adminService.getPendingLessors(); }

  @AdminPatch('lessors/:id/approve')
  approve(@AdminParam('id') id: string) { return this.adminService.approveLessor(id); }

  @AdminPatch('lessors/:id/reject')
  reject(@AdminParam('id') id: string, @AdminBody() body: { reason: string }) { return this.adminService.rejectLessor(id, body.reason); }

  @AdminPatch('lessors/:id/suspend')
  suspend(@AdminParam('id') id: string, @AdminBody() body: { reason?: string }) { return this.adminService.suspendLessor(id, body?.reason); }

  @AdminPatch('lessors/:id/reactivate')
  reactivate(@AdminParam('id') id: string) { return this.adminService.reactivateLessor(id); }

  // Vehicles
  @AdminGet('vehicles')
  getAllVehicles(@AdminQuery('status') status?: string) { return this.adminService.getAllVehicles(status); }

  @AdminGet('vehicles/pending')
  getPendingVehicles() { return this.adminService.getPendingVehicles(); }

  @AdminPatch('vehicles/:id/approve')
  approveVehicle(@AdminParam('id') id: string) { return this.adminService.approveVehicle(id); }

  @AdminPatch('vehicles/:id/reject')
  rejectVehicle(@AdminParam('id') id: string, @AdminBody() body: { reason: string }) { return this.adminService.rejectVehicle(id, body.reason); }

  // Bookings
  @AdminGet('bookings')
  getAllBookings(
    @AdminQuery('status') status?: string,
    @AdminQuery('page') page?: number,
    @AdminQuery('limit') limit?: number,
    @AdminQuery('sortBy') sortBy?: string,
    @AdminQuery('sortOrder') sortOrder?: string,
  ) { return this.adminService.getAllBookings(status, page, limit, sortBy, sortOrder); }

  @AdminDelete('bookings/:id')
  deleteBooking(@AdminParam('id') id: string) { return this.adminService.deleteBooking(id); }

  // Finance / global activity
  @AdminGet('finance/summary')
  getFinanceSummary(
    @AdminQuery('period') period?: string,
    @AdminQuery('date') date?: string,
  ) { return this.adminService.getFinanceSummary(period, date); }

  @AdminGet('activity')
  getActivity(
    @AdminQuery('lessorId') lessorId?: string,
    @AdminQuery('period') period?: string,
    @AdminQuery('date') date?: string,
    @AdminQuery('search') search?: string,
    @AdminQuery('sortBy') sortBy?: string,
    @AdminQuery('sortOrder') sortOrder?: string,
    @AdminQuery('page') page?: number,
    @AdminQuery('limit') limit?: number,
  ) { return this.adminService.getActivity({ lessorId, period, date, search, sortBy, sortOrder, page, limit }); }

  // Support
  @AdminGet('support')
  getAllTickets(@AdminQuery('status') status?: string) { return this.adminService.getAllTickets(status); }

  @AdminPatch('support/:id/resolve')
  resolveTicket(@AdminParam('id') id: string) { return this.adminService.resolveTicket(id); }

  // Invoices
  @AdminGet('lessors/:id/invoice')
  async getInvoice(
    @AdminParam('id') id: string,
    @AdminRes() res: AdminResponse,
    @AdminQuery('period') period: string,
    @AdminQuery('type') type: string = 'month',
  ) {
    const data = await this.adminService.computeInvoiceData(id, period, type);
    const buffer = await buildInvoicePdf(data);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${data.reference}.pdf"`,
    });
    res.send(buffer);
  }

  @AdminPost('lessors/:id/invoice/send')
  async sendInvoice(
    @AdminParam('id') id: string,
    @AdminQuery('period') period: string,
    @AdminQuery('type') type: string = 'month',
  ) {
    const data = await this.adminService.computeInvoiceData(id, period, type);
    if (!data.lessor.email) {
      throw new AdminConflict('Le loueur n\'a pas d\'adresse e-mail renseignée');
    }
    const buffer = await buildInvoicePdf(data);
    await sendMailWithAttachment({
      to: data.lessor.email,
      subject: `Facture ${data.reference} — Kerya DZ`,
      text: `Bonjour,\n\nVeuillez trouver ci-joint votre facture de commission pour la période ${data.periodLabel}.\n\nCordialement,\nL'équipe Kerya DZ`,
      attachment: { filename: `${data.reference}.pdf`, content: buffer, contentType: 'application/pdf' },
    });
    return { message: 'Facture envoyée par e-mail', reference: data.reference };
  }
}

@AdminMod({
  imports: [AdminORM.forFeature([Lessor, Vehicle, Booking, User, SupportTicket]), SettingsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

// ============================================================
// AUDIT MODULE
// ============================================================
import { Module as AuditMod, Injectable as AuditInj } from '@nestjs/common';
import { InjectRepository as AuditInject } from '@nestjs/typeorm';
import { Repository as AuditRepo } from 'typeorm';
import { TypeOrmModule as AuditORM } from '@nestjs/typeorm';
import { AuditLog } from '../database/entities';

@AuditInj()
export class AuditService {
  constructor(@AuditInject(AuditLog) private readonly logRepo: AuditRepo<AuditLog>) {}

  async log(actorUserId: string, entityType: string, entityId: string, action: string, metadata?: Record<string, any>, ipAddress?: string) {
    const entry = this.logRepo.create({ actorUserId, entityType, entityId, action, metadataJson: metadata, ipAddress });
    await this.logRepo.save(entry);
  }
}

@AuditMod({ imports: [AuditORM.forFeature([AuditLog])], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

// ============================================================
// USERS MODULE
// ============================================================
import { Module as UsersMod, Controller as UsersCtrl, Get as UsersGet, Patch as UsersPatch, Body as UsersBody, UseGuards as UsersGuard, Request as UsersReq, Injectable as UsersInj } from '@nestjs/common';
import { InjectRepository as UsersInject } from '@nestjs/typeorm';
import { Repository as UsersRepo } from 'typeorm';
import { TypeOrmModule as UsersORM } from '@nestjs/typeorm';
import { ApiTags as UsersApiTags, ApiBearerAuth as UsersBearer } from '@nestjs/swagger';

@UsersInj()
export class UsersService {
  constructor(@UsersInject(User) private readonly userRepo: UsersRepo<User>) {}

  async updateProfile(userId: string, data: Partial<User>) {
    const { id, passwordHash, ...safe } = data as any;
    await this.userRepo.update(userId, safe);
    return this.userRepo.findOne({ where: { id: userId } });
  }

  async updateFcmToken(userId: string, token: string) {
    await this.userRepo.update(userId, { fcmToken: token });
    return { message: 'Token mis à jour' };
  }
}

@UsersApiTags('users')
@UsersBearer()
@UsersCtrl('users')
@UsersGuard(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  @UsersPatch('me') updateProfile(@UsersReq() req: any, @UsersBody() body: any) { return this.usersService.updateProfile(req.user.id, body); }
  @UsersPatch('me/fcm-token') updateFcm(@UsersReq() req: any, @UsersBody() body: { token: string }) { return this.usersService.updateFcmToken(req.user.id, body.token); }
}

@UsersMod({ imports: [UsersORM.forFeature([User])], controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
