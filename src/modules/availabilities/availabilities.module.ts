import { Module, Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsString, IsDateString, IsOptional } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Availability } from '../../database/entities';
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
    @InjectRepository(Availability)
    private readonly availabilityRepo: Repository<Availability>,
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

  async blockDates(lessorId: string, dto: BlockDatesDto) {
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

  async unblock(id: string) {
    const slot = await this.availabilityRepo.findOne({ where: { id, source: 'manual_block' } });
    if (!slot) throw new NotFoundException('Bloc introuvable');
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
  unblock(@Param('id') id: string) {
    return this.availabilitiesService.unblock(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Availability])],
  controllers: [AvailabilitiesController],
  providers: [AvailabilitiesService],
  exports: [AvailabilitiesService],
})
export class AvailabilitiesModule {}
