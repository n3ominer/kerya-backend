import { Module, Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsString, IsDateString, IsOptional } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Availability, Vehicle, Lessor } from '../../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.module';

export class BlockDatesDto {
  @IsString() vehicleId: string;
  @IsDateString() startAt: string;
  @IsDateString() endAt: string;
  @IsString() @IsOptional() reason?: string; // maintenance | other
}

@Injectable()
export class AvailabilitiesService {
  constructor(
    @InjectRepository(Availability) private readonly availabilityRepo: Repository<Availability>,
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(Lessor) private readonly lessorRepo: Repository<Lessor>,
  ) {}

  async getForVehicle(vehicleId: string, from: string, to: string) {
    const qb = this.availabilityRepo
      .createQueryBuilder('a')
      .where('a.vehicleId = :vehicleId', { vehicleId })
      .andWhere('a.status != :status', { status: 'available' });

    if (from && to) {
      qb.andWhere('a.startAt < :to AND a.endAt > :from', { from, to });
    }

    return qb.getMany();
  }

  async blockDates(ownerUserId: string, dto: BlockDatesDto) {
    // Verify the vehicle belongs to the authenticated lessor
    const vehicle = await this.vehicleRepo.findOne({ where: { id: dto.vehicleId } });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    const lessor = await this.lessorRepo.findOne({ where: { id: vehicle.lessorId } });
    if (!lessor || lessor.ownerUserId !== ownerUserId) throw new ForbiddenException('Accès refusé');

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    // Check no confirmed booking in this range
    const conflict = await this.availabilityRepo
      .createQueryBuilder('a')
      .where('a.vehicleId = :vehicleId', { vehicleId: dto.vehicleId })
      .andWhere('a.status = :status', { status: 'reserved' })
      .andWhere('a.startAt < :endAt AND a.endAt > :startAt', { startAt, endAt })
      .getOne();

    if (conflict) {
      throw new ConflictException('Une réservation confirmée existe dans cette période');
    }

    const block = this.availabilityRepo.create({
      vehicleId: dto.vehicleId,
      startAt,
      endAt,
      source: 'manual_block',
      status: 'blocked',
    });
    return this.availabilityRepo.save(block);
  }

  async unblock(id: string, ownerUserId: string) {
    const slot = await this.availabilityRepo.findOne({ where: { id, source: 'manual_block' } });
    if (!slot) throw new NotFoundException('Bloc introuvable');
    // Verify ownership before unblocking
    const vehicle = await this.vehicleRepo.findOne({ where: { id: slot.vehicleId } });
    if (vehicle) {
      const lessor = await this.lessorRepo.findOne({ where: { id: vehicle.lessorId } });
      if (!lessor || lessor.ownerUserId !== ownerUserId) throw new ForbiddenException('Accès refusé');
    }
    await this.availabilityRepo.delete(id);
    return { message: 'Débloqué' };
  }
}

@ApiTags('availabilities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('availabilities')
export class AvailabilitiesController {
  constructor(private readonly availabilitiesService: AvailabilitiesService) {}

  @Get('vehicle/:vehicleId')
  @ApiOperation({ summary: 'Calendrier de disponibilité d\'un véhicule' })
  getForVehicle(
    @Param('vehicleId') vehicleId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.availabilitiesService.getForVehicle(vehicleId, from, to);
  }

  @Post('block')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Bloquer des dates (loueur)' })
  block(@Request() req: any, @Body() dto: BlockDatesDto) {
    return this.availabilitiesService.blockDates(req.user.id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('lessor')
  @ApiOperation({ summary: 'Débloquer des dates' })
  unblock(@Param('id') id: string, @Request() req: any) {
    return this.availabilitiesService.unblock(id, req.user.id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Availability, Vehicle, Lessor])],
  controllers: [AvailabilitiesController],
  providers: [AvailabilitiesService],
  exports: [AvailabilitiesService],
})
export class AvailabilitiesModule {}
