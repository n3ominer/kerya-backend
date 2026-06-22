// ============================================================
// VEHICLES MODULE — NestJS
// ============================================================
import {
  Module, Controller, Get, Post, Put, Delete, Patch,
  Body, Param, Query, UseGuards, Request, UploadedFile,
  UseInterceptors, Injectable, NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '../../common/storage.service';
import {
  IsString, IsNumber, IsBoolean, IsOptional,
  IsArray,
} from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Vehicle, VehiclePhoto, Lessor, Availability, Review, User } from '../../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.module';

// ─── DTOs ──────────────────────────────────────────────────
export class CreateVehicleDto {
  @IsString() brand: string;
  @IsString() model: string;
  @IsNumber() year: number;
  @IsString() category: string;
  @IsString() transmission: string;
  @IsString() fuelType: string;
  @IsNumber() @IsOptional() seats?: number;
  @IsNumber() @IsOptional() luggageCount?: number;
  @IsBoolean() @IsOptional() airConditioning?: boolean;
  @IsString() @IsOptional() color?: string;
  @IsNumber() dailyPriceBase: number;
  @IsNumber() @IsOptional() weeklyPriceBase?: number;
  @IsNumber() @IsOptional() monthlyPriceBase?: number;
  @IsNumber() depositAmount: number;
  @IsBoolean() @IsOptional() requiresManualApproval?: boolean;
  @IsBoolean() @IsOptional() deliveryAvailable?: boolean;
  @IsBoolean() @IsOptional() airportDeliveryAvailable?: boolean;
  @IsArray() @IsOptional() requiredDocuments?: string[];
  @IsString() @IsOptional() pickupAddress?: string;
  @IsString() @IsOptional() pickupCity?: string;
  @IsNumber() @IsOptional() pickupLat?: number;
  @IsNumber() @IsOptional() pickupLng?: number;
  @IsString() @IsOptional() mileagePolicy?: string;
  @IsString() @IsOptional() registrationNumber?: string;
  @IsString() @IsOptional() description?: string;
}

export class SearchVehiclesDto {
  @IsString() location: string;
  @IsString() pickupAt: string;   // ISO date
  @IsString() returnAt: string;   // ISO date
  @IsString() @IsOptional() category?: string;
  @IsNumber() @IsOptional() minPrice?: number;
  @IsNumber() @IsOptional() maxPrice?: number;
  @IsString() @IsOptional() transmission?: string;
  @IsString() @IsOptional() fuelType?: string;
  @IsNumber() @IsOptional() minSeats?: number;
  @IsBoolean() @IsOptional() hasAC?: boolean;
  @IsBoolean() @IsOptional() airportDelivery?: boolean;
  @IsBoolean() @IsOptional() instantBooking?: boolean;
  @IsString() @IsOptional() sortBy?: string;
  @IsNumber() @IsOptional() page?: number;
  @IsNumber() @IsOptional() limit?: number;
}

// ─── Service ────────────────────────────────────────────────
@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(VehiclePhoto) private readonly photoRepo: Repository<VehiclePhoto>,
    @InjectRepository(Lessor) private readonly lessorRepo: Repository<Lessor>,
    @InjectRepository(Availability) private readonly availabilityRepo: Repository<Availability>,
    @InjectRepository(Review) private readonly reviewRepo: Repository<Review>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async search(dto: SearchVehiclesDto) {
    const page = Number(dto.page) || 1;
    const limit = Math.min(Number(dto.limit) || 20, 50);
    const pickupAt = new Date(dto.pickupAt);
    const returnAt = new Date(dto.returnAt);

    // Find vehicles that have a conflicting reservation (subquery)
    const conflictingVehicleIds = await this.availabilityRepo
      .createQueryBuilder('a')
      .select('a.vehicleId')
      .where('a.status IN (:...statuses)', { statuses: ['reserved', 'blocked'] })
      .andWhere('a.startAt < :returnAt AND a.endAt > :pickupAt', { returnAt, pickupAt })
      .getRawMany()
      .then((rows) => rows.map((r) => r.a_vehicle_id));

    const qb = this.vehicleRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.photos', 'photo', 'photo.isCover = true')
      .leftJoinAndSelect('v.lessor', 'lessor')
      .where('v.published = true')
      .andWhere('v.status = :status', { status: 'active' });

    // Exclude conflicting vehicles
    if (conflictingVehicleIds.length > 0) {
      qb.andWhere('v.id NOT IN (:...ids)', { ids: conflictingVehicleIds });
    }

    // Location filter
    if (dto.location) {
      qb.andWhere(
        '(v.pickupCity ILIKE :location OR lessor.city ILIKE :location)',
        { location: `%${dto.location}%` },
      );
    }

    // Optional filters
    if (dto.category) qb.andWhere('v.category = :category', { category: dto.category });
    if (dto.transmission) qb.andWhere('v.transmission = :transmission', { transmission: dto.transmission });
    if (dto.fuelType) qb.andWhere('v.fuelType = :fuelType', { fuelType: dto.fuelType });
    if (dto.minSeats) qb.andWhere('v.seats >= :minSeats', { minSeats: dto.minSeats });
    if (dto.hasAC) qb.andWhere('v.airConditioning = true');
    if (dto.airportDelivery) qb.andWhere('v.airportDeliveryAvailable = true');
    if (dto.instantBooking) qb.andWhere('v.requiresManualApproval = false');
    if (dto.minPrice) qb.andWhere('v.dailyPriceBase >= :minPrice', { minPrice: dto.minPrice });
    if (dto.maxPrice) qb.andWhere('v.dailyPriceBase <= :maxPrice', { maxPrice: dto.maxPrice });

    // Sorting
    const sortMap: Record<string, [string, 'ASC' | 'DESC']> = {
      price_asc: ['v.dailyPriceBase', 'ASC'],
      price_desc: ['v.dailyPriceBase', 'DESC'],
      rating_desc: ['v.ratingAverage', 'DESC'],
      newest: ['v.createdAt', 'DESC'],
    };
    const [sortField, sortDir] = sortMap[dto.sortBy] || sortMap.price_asc;
    qb.orderBy(sortField, sortDir);

    const [vehicles, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const rentalDays = Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 86400000));

    return {
      data: vehicles.map((v) => this.formatSummary(v, rentalDays)),
      total,
      page,
      pageSize: limit,
      hasMore: page * limit < total,
    };
  }

  private formatSummary(v: Vehicle, rentalDays: number) {
    const coverPhoto = v.photos?.find((p) => p.isCover) || v.photos?.[0];
    return {
      id: v.id,
      lessorId: v.lessorId,
      lessorName: v.lessor?.businessName ?? '',
      brand: v.brand,
      model: v.model,
      year: v.year,
      category: v.category,
      transmission: v.transmission,
      fuelType: v.fuelType,
      seats: v.seats,
      hasAC: v.airConditioning,
      coverPhotoUrl: coverPhoto?.url ?? null,
      dailyPrice: Number(v.dailyPriceBase),
      weeklyPrice: v.weeklyPriceBase ? Number(v.weeklyPriceBase) : null,
      depositAmount: Number(v.depositAmount),
      instantBooking: !v.requiresManualApproval,
      airportDelivery: v.airportDeliveryAvailable,
      averageRating: v.ratingAverage ? Number(v.ratingAverage) : null,
      reviewCount: v.reviewCount,
      pickupCity: v.pickupCity,
      totalPrice: this.computePrice(v, rentalDays),
    };
  }

  private computePrice(v: Vehicle, days: number): number {
    if (days >= 30 && v.monthlyPriceBase) return (Number(v.monthlyPriceBase) / 30) * days;
    if (days >= 7 && v.weeklyPriceBase) return (Number(v.weeklyPriceBase) / 7) * days;
    return Number(v.dailyPriceBase) * days;
  }

  async findOne(id: string) {
    const v = await this.vehicleRepo.findOne({
      where: { id },
      relations: ['photos', 'lessor', 'pricingRules'],
    });
    if (!v) throw new NotFoundException('Véhicule introuvable');

    const rawReviews = await this.reviewRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.customer', 'customer')
      .where('r.vehicleId = :vehicleId', { vehicleId: id })
      .orderBy('r.createdAt', 'DESC')
      .take(50)
      .getMany();

    const reviews = rawReviews.map((r) => ({
      id: r.id,
      customerName: r.customer
        ? `${r.customer.firstName} ${r.customer.lastName}`.trim()
        : 'Anonyme',
      rating: Number(r.rating),
      comment: r.comment ?? null,
      createdAt: r.createdAt,
    }));

    return {
      ...v,
      lessorName: v.lessor?.businessName ?? '',
      lessorLogoUrl: v.lessor?.logoUrl ?? null,
      lessorRating: v.lessor?.ratingAverage ? Number(v.lessor.ratingAverage) : 0,
      lessorReviewCount: v.lessor?.reviewCount ?? 0,
      reviews,
    };
  }

  private async resolveLessor(ownerUserId: string): Promise<Lessor> {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) throw new ForbiddenException('Profil loueur introuvable');
    return lessor;
  }

  async create(ownerUserId: string, dto: CreateVehicleDto) {
    const lessor = await this.resolveLessor(ownerUserId);
    if (lessor.status !== 'approved') {
      throw new ForbiddenException('Loueur non approuvé');
    }
    const vehicle = this.vehicleRepo.create({
      ...dto,
      lessorId: lessor.id,
      status: 'under_review',
    });
    return this.vehicleRepo.save(vehicle);
  }

  async update(id: string, ownerUserId: string, dto: Partial<CreateVehicleDto>) {
    const lessor = await this.resolveLessor(ownerUserId);
    const vehicle = await this.vehicleRepo.findOne({ where: { id, lessorId: lessor.id } });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    Object.assign(vehicle, dto);
    return this.vehicleRepo.save(vehicle);
  }

  async addPhotoWithUrl(vehicleId: string, ownerUserId: string, url: string, isCover: boolean) {
    const lessor = await this.resolveLessor(ownerUserId);
    const vehicle = await this.vehicleRepo.findOne({ where: { id: vehicleId, lessorId: lessor.id } });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');

    const existingCount = await this.photoRepo.count({ where: { vehicleId } });
    if (isCover) {
      await this.photoRepo
        .createQueryBuilder()
        .update()
        .set({ isCover: false })
        .where('vehicleId = :vehicleId', { vehicleId })
        .execute();
    }

    const photo = this.photoRepo.create({
      vehicleId,
      url,
      isCover: isCover || existingCount === 0,
      sortOrder: existingCount,
    });
    return this.photoRepo.save(photo);
  }

  async deletePhoto(vehicleId: string, photoId: string, ownerUserId: string) {
    const lessor = await this.resolveLessor(ownerUserId);
    const vehicle = await this.vehicleRepo.findOne({ where: { id: vehicleId, lessorId: lessor.id } });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    const photo = await this.photoRepo.findOne({ where: { id: photoId, vehicleId } });
    if (!photo) throw new NotFoundException('Photo introuvable');
    await this.photoRepo.remove(photo);
    return { success: true };
  }

  async togglePublish(id: string, ownerUserId: string, publish: boolean) {
    const lessor = await this.resolveLessor(ownerUserId);
    const vehicle = await this.vehicleRepo.findOne({ where: { id, lessorId: lessor.id } });
    if (!vehicle) throw new NotFoundException();
    if (vehicle.status !== 'active') throw new ForbiddenException('Véhicule non approuvé');
    vehicle.published = publish;
    return this.vehicleRepo.save(vehicle);
  }

  async getLessorVehicles(ownerUserId: string) {
    const lessor = await this.resolveLessor(ownerUserId);
    return this.vehicleRepo.find({
      where: { lessorId: lessor.id },
      relations: ['photos'],
      order: { createdAt: 'DESC' },
    });
  }

  async getCities() {
    const result = await this.vehicleRepo
      .createQueryBuilder('v')
      .select('DISTINCT v.pickupCity', 'city')
      .where('v.published = true AND v.pickupCity IS NOT NULL')
      .orderBy('city', 'ASC')
      .getRawMany();
    return result.map((r) => r.city).filter(Boolean);
  }
}

// ─── Controller ─────────────────────────────────────────────
@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly storage: StorageService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Rechercher des véhicules disponibles' })
  search(@Query() dto: SearchVehiclesDto) {
    return this.vehiclesService.search(dto);
  }

  @Get('cities')
  @ApiOperation({ summary: 'Liste des villes disponibles' })
  getCities() {
    return this.vehiclesService.getCities();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'un véhicule' })
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Créer un véhicule (loueur)' })
  create(@Request() req: any, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(req.user.id, dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  update(@Param('id') id: string, @Request() req: any, @Body() dto: Partial<CreateVehicleDto>) {
    return this.vehiclesService.update(id, req.user.id, dto);
  }

  @Post(':id/photos')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: 'Uploader une photo pour un véhicule' })
  async addPhoto(
    @Param('id') vehicleId: string,
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('isCover') isCover: string,
  ) {
    const url = await this.storage.upload(file.buffer, `vehicles/${vehicleId}`, file.originalname);
    return this.vehiclesService.addPhotoWithUrl(vehicleId, req.user.id, url, isCover === 'true');
  }

  @Delete(':id/photos/:photoId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Supprimer une photo' })
  deletePhoto(
    @Param('id') vehicleId: string,
    @Param('photoId') photoId: string,
    @Request() req: any,
  ) {
    return this.vehiclesService.deletePhoto(vehicleId, photoId, req.user.id);
  }

  @Patch(':id/publish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  publish(@Param('id') id: string, @Request() req: any) {
    return this.vehiclesService.togglePublish(id, req.user.id, true);
  }

  @Patch(':id/unpublish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  unpublish(@Param('id') id: string, @Request() req: any) {
    return this.vehiclesService.togglePublish(id, req.user.id, false);
  }

  @Get('lessor/my-vehicles')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('lessor')
  getMyVehicles(@Request() req: any) {
    return this.vehiclesService.getLessorVehicles(req.user.id);
  }
}

// ─── Module ─────────────────────────────────────────────────
@Module({
  imports: [
    TypeOrmModule.forFeature([Vehicle, VehiclePhoto, Lessor, Availability, Review, User]),
  ],
  controllers: [VehiclesController],
  providers: [VehiclesService, StorageService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
