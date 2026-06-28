// ============================================================
// LESSORS MODULE
// ============================================================
import { Module as NestModule, Controller, Get, Post, Patch, Body, Param, UseGuards, Request, UploadedFile, UseInterceptors, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '../../common/storage.service';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Lessor, User } from '../../database/entities';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.module';

export class CreateLessorDto {
  @IsString() businessName: string;
  @IsEnum(['agency', 'independent']) type: string;
  @IsString() @IsOptional() legalIdentifier?: string;
  @IsString() @IsOptional() taxIdentifier?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() wilaya?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() rib?: string;
  @IsString() @IsOptional() description?: string;
}

@Injectable()
export class LessorsService {
  constructor(
    @InjectRepository(Lessor) private readonly lessorRepo: Repository<Lessor>,
  ) {}

  async create(ownerUserId: string, dto: CreateLessorDto) {
    const existing = await this.lessorRepo.findOne({ where: { ownerUserId } });
    // Idempotent: return existing profile rather than throwing so retries don't break the onboarding flow
    if (existing) return existing;
    const lessor = this.lessorRepo.create({ ...dto, ownerUserId, status: 'pending' });
    return this.lessorRepo.save(lessor);
  }

  async findMyProfile(ownerUserId: string) {
    const lessor = await this.lessorRepo.findOne({ where: { ownerUserId } });
    if (!lessor) throw new NotFoundException('Profil loueur introuvable');
    return lessor;
  }

  async updateProfile(ownerUserId: string, dto: Partial<CreateLessorDto>) {
    const lessor = await this.findMyProfile(ownerUserId);
    Object.assign(lessor, dto);
    return this.lessorRepo.save(lessor);
  }

  async findAll() {
    return this.lessorRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const lessor = await this.lessorRepo.findOne({
      where: { id },
      relations: ['vehicles', 'vehicles.photos'],
    });
    if (!lessor) throw new NotFoundException();
    // Only expose published vehicles on public profile
    if (lessor.vehicles) {
      lessor.vehicles = lessor.vehicles.filter((v: any) => v.published === true && v.status === 'active');
    }
    return lessor;
  }

  async updateStatus(id: string, status: string, reason?: string) {
    const lessor = await this.lessorRepo.findOne({ where: { id } });
    if (!lessor) throw new NotFoundException();
    lessor.status = status;
    if (reason) lessor.rejectionReason = reason;
    return this.lessorRepo.save(lessor);
  }

  async updateLogoUrl(ownerUserId: string, url: string) {
    const lessor = await this.findMyProfile(ownerUserId);
    lessor.logoUrl = url;
    return this.lessorRepo.save(lessor);
  }
}

@ApiTags('lessors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lessors')
export class LessorsController {
  constructor(
    private readonly lessorsService: LessorsService,
    private readonly storage: StorageService,
  ) {}

  @Post('profile')
  @ApiOperation({ summary: 'Créer profil loueur' })
  createProfile(@Request() req: any, @Body() dto: CreateLessorDto) {
    return this.lessorsService.create(req.user.id, dto);
  }

  @Get('profile/me')
  @ApiOperation({ summary: 'Mon profil loueur' })
  getMyProfile(@Request() req: any) {
    return this.lessorsService.findMyProfile(req.user.id);
  }

  @Patch('profile/me')
  @ApiOperation({ summary: 'Modifier profil loueur' })
  updateProfile(@Request() req: any, @Body() dto: Partial<CreateLessorDto>) {
    return this.lessorsService.updateProfile(req.user.id, dto);
  }

  @Post('profile/me/logo')
  @ApiOperation({ summary: 'Uploader le logo du loueur' })
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  async updateLogo(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    const url = await this.storage.upload(file.buffer, `lessors/${req.user.id}`, file.originalname);
    return this.lessorsService.updateLogoUrl(req.user.id, url);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Profil public d\'un loueur' })
  @UseGuards() // override class-level JwtAuthGuard — public endpoint
  findOne(@Param('id') id: string) {
    return this.lessorsService.findOne(id);
  }
}

@NestModule({
  imports: [TypeOrmModule.forFeature([Lessor])],
  controllers: [LessorsController],
  providers: [LessorsService, StorageService],
  exports: [LessorsService],
})
export class LessorsModule {}
