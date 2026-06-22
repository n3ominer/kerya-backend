// ============================================================
// SETTINGS MODULE — global platform settings (commission, etc.)
// ============================================================
import {
  Module, Controller, Get, Put, Body, UseGuards, Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Lessor, PlatformSettings } from '../../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.module';

export class UpdateSettingsDto {
  @IsNumber() @Min(0) @Max(1) @IsOptional() commissionRateDefault?: number;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(PlatformSettings) private readonly settingsRepo: Repository<PlatformSettings>,
  ) {}

  async getSettings(): Promise<PlatformSettings> {
    let settings = await this.settingsRepo.findOne({ where: {} });
    if (!settings) {
      settings = this.settingsRepo.create({ commissionRateDefault: 0.1 });
      settings = await this.settingsRepo.save(settings);
    }
    return settings;
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<PlatformSettings> {
    const settings = await this.getSettings();
    if (dto.commissionRateDefault !== undefined) {
      settings.commissionRateDefault = dto.commissionRateDefault;
    }
    return this.settingsRepo.save(settings);
  }

  /**
   * Resolves the effective commission rate for a lessor at a given date:
   * 0% during welcome period, else the lessor's override rate, else the
   * platform default rate.
   */
  resolveCommissionRate(lessor: Pick<Lessor, 'commissionRate' | 'welcomePeriodEndsAt'>, settings: PlatformSettings, at: Date = new Date()): number {
    if (lessor.welcomePeriodEndsAt && at < new Date(lessor.welcomePeriodEndsAt)) {
      return 0;
    }
    if (lessor.commissionRate !== null && lessor.commissionRate !== undefined) {
      return Number(lessor.commissionRate);
    }
    return Number(settings.commissionRateDefault);
  }
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get() {
    return this.settingsService.getSettings();
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettings, Lessor])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
