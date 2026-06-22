// ============================================================
// BOOKINGS MODULE — NestJS
// ============================================================
import {
  Module, Controller, Get, Post, Patch, Body, Param,
  Query, UseGuards, Request, Res, Injectable,
  NotFoundException, ConflictException, ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsString, IsDateString, IsBoolean, IsOptional } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  Booking, Vehicle, Availability, Lessor,
} from '../../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { buildBookingsWorkbook } from '../../common/excel.util';
import { randomBytes } from 'crypto';

// ─── DTOs ──────────────────────────────────────────────────
export class CreateBookingDto {
  @IsString() vehicleId: string;
  @IsString() pickupLocation: string;
  @IsString() returnLocation: string;
  @IsDateString() pickupAt: string;
  @IsDateString() returnAt: string;
  @IsBoolean() @IsOptional() extraDriver?: boolean;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() paymentMethod?: string;
}

export class UpdateBookingStatusDto {
  @IsString() status: string;
  @IsString() @IsOptional() reason?: string;
}

// ─── Service ────────────────────────────────────────────────
@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(Availability) private readonly availabilityRepo: Repository<Availability>,
    @InjectRepository(Lessor) private readonly lessorRepo: Repository<Lessor>,
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Check for overlapping reservations — CRITICAL anti-double-booking.
   * Uses SELECT FOR UPDATE inside a transaction to lock.
   */
  private async checkAvailability(vehicleId: string, pickupAt: Date, returnAt: Date, excludeBookingId?: string) {
    const qb = this.availabilityRepo
      .createQueryBuilder('a')
      .where('a.vehicleId = :vehicleId', { vehicleId })
      .andWhere('a.status IN (:...statuses)', { statuses: ['reserved', 'blocked'] })
      .andWhere('a.startAt < :returnAt AND a.endAt > :pickupAt', { returnAt, pickupAt });

    if (excludeBookingId) {
      qb.andWhere('a.bookingId != :excludeBookingId', { excludeBookingId });
    }

    const conflict = await qb.getOne();
    if (conflict) {
      throw new ConflictException(
        'Ce véhicule est déjà réservé pour cette période. Veuillez choisir d\'autres dates.',
      );
    }
  }

  private generateReferenceCode(): string {
    return 'VDZ-' + randomBytes(4).toString('hex').toUpperCase();
  }

  private computePrice(vehicle: Vehicle, rentalDays: number, extraDriver: boolean): {
    subtotal: number; extra: number; total: number;
  } {
    let subtotal = Number(vehicle.dailyPriceBase) * rentalDays;
    if (rentalDays >= 7 && vehicle.weeklyPriceBase) {
      subtotal = (Number(vehicle.weeklyPriceBase) / 7) * rentalDays;
    }
    if (rentalDays >= 30 && vehicle.monthlyPriceBase) {
      subtotal = (Number(vehicle.monthlyPriceBase) / 30) * rentalDays;
    }

    // Apply pricing rules if any (simplest approach — daily base for now)
    const extraAmount = 0; // extra driver fees handled via pricing rules in full impl
    const total = subtotal + extraAmount;
    return { subtotal, extra: extraAmount, total };
  }

  async create(customerId: string, dto: CreateBookingDto) {
    const pickupAt = new Date(dto.pickupAt);
    const returnAt = new Date(dto.returnAt);

    if (returnAt <= pickupAt) {
      throw new BadRequestException('La date de retour doit être après la date de départ');
    }

    const rentalDays = Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 86400000));

    // Load vehicle with lessor
    const vehicle = await this.vehicleRepo.findOne({
      where: { id: dto.vehicleId, published: true, status: 'active' },
      relations: ['lessor'],
    });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable ou non disponible');

    // Transaction for atomicity
    return this.dataSource.transaction(async (manager) => {
      // Lock and check availability
      await manager
        .createQueryBuilder(Availability, 'a')
        .setLock('pessimistic_write')
        .where('a.vehicleId = :vehicleId', { vehicleId: vehicle.id })
        .getMany();

      await this.checkAvailability(vehicle.id, pickupAt, returnAt);

      const { subtotal, extra, total } = this.computePrice(vehicle, rentalDays, dto.extraDriver || false);

      // Create booking
      const booking = manager.create(Booking, {
        referenceCode: this.generateReferenceCode(),
        customerId,
        lessorId: vehicle.lessorId,
        vehicleId: vehicle.id,
        pickupLocation: dto.pickupLocation,
        returnLocation: dto.returnLocation,
        pickupAt,
        returnAt,
        rentalDays,
        subtotalAmount: subtotal,
        extraAmount: extra,
        depositAmount: Number(vehicle.depositAmount),
        totalAmount: total,
        currency: 'DZD',
        status: vehicle.requiresManualApproval ? 'pending' : 'awaiting_payment',
        approvalMode: vehicle.requiresManualApproval ? 'manual' : 'instant',
        extraDriver: dto.extraDriver || false,
        notes: dto.notes,
        // Expire pending booking after 30 min
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      const saved = await manager.save(Booking, booking);

      // Block availability slot
      const availSlot = manager.create(Availability, {
        vehicleId: vehicle.id,
        startAt: pickupAt,
        endAt: returnAt,
        source: 'booking',
        status: 'reserved',
        bookingId: saved.id,
      });
      await manager.save(Availability, availSlot);

      return saved;
    });
  }

  async findAllForCustomer(customerId: string) {
    return this.bookingRepo.find({
      where: { customerId },
      relations: ['vehicle', 'vehicle.photos'],
      order: { createdAt: 'DESC' },
    });
  }

  async findAllForLessor(ownerUserId: string, status?: string) {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) return [];
    return this.findAllForLessorId(lessor.id, status);
  }

  async findAllForLessorId(lessorId: string, status?: string) {
    const where: any = { lessorId, hiddenForLessor: false };
    if (status) where.status = status;
    return this.bookingRepo.find({
      where,
      relations: ['vehicle', 'customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async hideForLessor(id: string, ownerUserId: string) {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) throw new NotFoundException();
    const booking = await this.bookingRepo.findOne({ where: { id, lessorId: lessor.id } });
    if (!booking) throw new NotFoundException();
    booking.hiddenForLessor = true;
    return this.bookingRepo.save(booking);
  }

  async findOne(id: string, userId: string, userRole: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: ['vehicle', 'vehicle.photos', 'vehicle.lessor', 'lessor', 'customer', 'payments'],
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    // Access control
    if (userRole !== 'admin' && booking.customerId !== userId) {
      const lessor = await this.lessorRepo.findOne({ where: { ownerUserId: userId } });
      if (!lessor || booking.lessorId !== lessor.id) {
        throw new ForbiddenException();
      }
    }

    if (booking.lessor) {
      const settings = await this.settingsService.getSettings();
      const rate = this.settingsService.resolveCommissionRate(booking.lessor, settings, new Date(booking.createdAt));
      (booking as any).commissionRate = rate;
      (booking as any).isWelcomePeriod =
        !!booking.lessor.welcomePeriodEndsAt && new Date(booking.createdAt) < new Date(booking.lessor.welcomePeriodEndsAt);
    }

    return booking;
  }

  async updateStatus(id: string, ownerUserId: string, dto: UpdateBookingStatusDto) {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) throw new NotFoundException();
    const booking = await this.bookingRepo.findOne({ where: { id, lessorId: lessor.id } });
    if (!booking) throw new NotFoundException();

    const allowed = {
      pending: ['confirmed', 'rejected'],
      confirmed: ['completed', 'cancelled'],
    };

    if (!allowed[booking.status]?.includes(dto.status)) {
      throw new BadRequestException(`Transition ${booking.status} → ${dto.status} invalide`);
    }

    // If rejected or cancelled, free up availability slot
    if (['rejected', 'cancelled'].includes(dto.status)) {
      await this.availabilityRepo.delete({ bookingId: id });
    }

    booking.status = dto.status;
    return this.bookingRepo.save(booking);
  }

  async cancel(id: string, customerId: string) {
    const booking = await this.bookingRepo.findOne({ where: { id, customerId } });
    if (!booking) throw new NotFoundException();
    if (!['pending', 'awaiting_payment'].includes(booking.status)) {
      throw new BadRequestException('Réservation non annulable à ce stade');
    }
    booking.status = 'cancelled';
    await this.availabilityRepo.delete({ bookingId: id });
    return this.bookingRepo.save(booking);
  }

  // Cron: expire unpaid bookings every 5 minutes
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingBookings() {
    const expired = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.status IN (:...statuses)', { statuses: ['pending', 'awaiting_payment'] })
      .andWhere('b.expiresAt < NOW()')
      .getMany();

    for (const booking of expired) {
      booking.status = 'cancelled';
      await this.bookingRepo.save(booking);
      await this.availabilityRepo.delete({ bookingId: booking.id });
    }

    if (expired.length > 0) {
      console.log(`[Cron] Expired ${expired.length} booking(s)`);
    }
  }
}

// ─── Controller ─────────────────────────────────────────────
@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Créer une réservation (anti-double-booking)' })
  create(@Request() req: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(req.user.id, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Mes réservations (client)' })
  myBookings(@Request() req: any) {
    return this.bookingsService.findAllForCustomer(req.user.id);
  }

  @Get('lessor')
  @UseGuards(RolesGuard)
  @Roles('lessor', 'admin')
  @ApiOperation({ summary: 'Réservations du loueur' })
  lessorBookings(@Request() req: any, @Query('status') status?: string) {
    return this.bookingsService.findAllForLessor(req.user.id, status);
  }

  @Get('lessor/export')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Export Excel des réservations du loueur' })
  async lessorBookingsExport(
    @Request() req: any,
    @Res() res: Response,
    @Query('status') status?: string,
  ) {
    const bookings = await this.bookingsService.findAllForLessor(req.user.id, status);
    const buffer = await buildBookingsWorkbook(bookings);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="reservations.xlsx"',
    });
    res.send(buffer);
  }

  @Get('admin/lessors/:id/export')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Export Excel des réservations d\'un loueur (admin)' })
  async adminLessorBookingsExport(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('status') status?: string,
  ) {
    const bookings = await this.bookingsService.findAllForLessorId(id, status);
    const buffer = await buildBookingsWorkbook(bookings);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="reservations.xlsx"',
    });
    res.send(buffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'une réservation' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.bookingsService.findOne(id, req.user.id, req.user.role);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('lessor', 'admin')
  @ApiOperation({ summary: 'Accepter / refuser une réservation (loueur)' })
  updateStatus(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookingsService.updateStatus(id, req.user.id, dto);
  }

  @Patch(':id/hide')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Masquer une réservation de la liste du loueur (sans la supprimer)' })
  hide(@Param('id') id: string, @Request() req: any) {
    return this.bookingsService.hideForLessor(id, req.user.id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Annuler une réservation (client)' })
  cancel(@Param('id') id: string, @Request() req: any) {
    return this.bookingsService.cancel(id, req.user.id);
  }
}

// ─── Module ─────────────────────────────────────────────────
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Vehicle, Availability, Lessor]),
    SettingsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
