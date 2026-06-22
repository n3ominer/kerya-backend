// ============================================================
// AUTH MODULE — NestJS
// ============================================================
import {
  Module, Controller, Post, Body, Get, UseGuards,
  Request, Injectable, UnauthorizedException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { IsString, IsEmail, IsEnum, MinLength, IsMobilePhone } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { User } from '../../database/entities';

// ─── DTOs ──────────────────────────────────────────────────
export class LoginDto {
  @ApiProperty({ example: '+213612345678' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'MyPassword123' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class SignupDto {
  @ApiProperty() @IsString() firstName: string;
  @ApiProperty() @IsString() lastName: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ example: '+213612345678' }) @IsString() phone: string;
  @ApiProperty() @IsString() @MinLength(6) password: string;
  @ApiProperty({ enum: ['customer', 'lessor'] }) @IsEnum(['customer', 'lessor']) role: string;
  @ApiProperty({ enum: ['fr', 'ar', 'en'], default: 'fr' }) preferredLanguage: string;
}

export class SendOtpDto {
  @ApiProperty() @IsString() phone: string;
}

export class VerifyOtpDto {
  @ApiProperty() @IsString() phone: string;
  @ApiProperty() @IsString() otp: string;
}

// ─── JWT Strategy ───────────────────────────────────────────
@Injectable()
export class JwtAuthStrategy extends PassportStrategy(JwtStrategy, 'jwt') {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'default_secret'),
    });
  }

  async validate(payload: any) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}

export const JwtAuthGuard = AuthGuard('jwt');

// ─── Roles decorator & guard ────────────────────────────────
import { SetMetadata, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.role);
  }
}

// ─── Auth Service ───────────────────────────────────────────
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: this.jwtService.sign(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
      user: this.sanitizeUser(user),
    };
  }

  private sanitizeUser(user: User) {
    const { passwordHash, otpCode, otpExpiresAt, ...safe } = user as any;
    return safe;
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { phone: dto.phone } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Identifiants invalides');
    if (!user.isActive) throw new UnauthorizedException('Compte désactivé');
    return this.generateTokens(user);
  }

  async signup(dto: SignupDto) {
    const exists = await this.userRepo.findOne({
      where: [{ email: dto.email }, { phone: dto.phone }],
    });
    if (exists) throw new ConflictException('Email ou téléphone déjà utilisé');

    const user = this.userRepo.create({
      ...dto,
      firstName: dto.firstName,
      lastName: dto.lastName,
      preferredLanguage: dto.preferredLanguage || 'fr',
      passwordHash: await bcrypt.hash(dto.password, 12),
    });
    await this.userRepo.save(user);
    return this.generateTokens(user);
  }

  async sendOtp(phone: string) {
    const user = await this.userRepo.findOne({ where: { phone } });
    if (!user) throw new BadRequestException('Numéro inconnu');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.userRepo.update(user.id, { otpCode: otp, otpExpiresAt: expiresAt });

    // TODO: send SMS via provider (Twilio / mock)
    console.log(`[OTP] Phone: ${phone} — Code: ${otp}`);
    return { message: 'OTP envoyé' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.userRepo.findOne({ where: { phone: dto.phone } });
    if (!user || user.otpCode !== dto.otp) throw new UnauthorizedException('OTP invalide');
    if (new Date() > user.otpExpiresAt) throw new UnauthorizedException('OTP expiré');

    await this.userRepo.update(user.id, {
      otpCode: null,
      otpExpiresAt: null,
      isVerified: true,
    });
    return this.generateTokens(user);
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.sanitizeUser(user);
  }
}

// ─── Auth Controller ────────────────────────────────────────
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Connexion par téléphone + mot de passe' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('signup')
  @ApiOperation({ summary: 'Inscription client ou loueur' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('otp/send')
  @ApiOperation({ summary: 'Envoyer un code OTP' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phone);
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Vérifier le code OTP' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Profil utilisateur connecté' })
  getMe(@Request() req: any) {
    return this.authService.getMe(req.user.id);
  }
}

// ─── Auth Module ────────────────────────────────────────────
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'default_secret'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '24h') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthStrategy, RolesGuard],
  exports: [AuthService, JwtAuthStrategy, RolesGuard, JwtModule],
})
export class AuthModule {}
