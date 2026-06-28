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
import { IsString, IsEmail, IsEnum, MinLength, IsMobilePhone, Matches } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'crypto';
import { User } from '../../database/entities';
import { hashPassword, verifyPassword, isBcryptHash } from '../../common/password.util';
import { TokenBlacklistService } from '../../common/token-blacklist.service';

// ─── DTOs ──────────────────────────────────────────────────
export class LoginDto {
  @ApiProperty({ example: '+213612345678' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'MyPassword123!' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class SignupDto {
  @ApiProperty() @IsString() firstName: string;
  @ApiProperty() @IsString() lastName: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ example: '+213612345678' }) @IsString() phone: string;
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message: 'Le mot de passe doit contenir au moins 8 caractères, 1 majuscule, 1 chiffre et 1 caractère spécial',
  })
  password: string;
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
  constructor(
    private readonly config: ConfigService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'default_secret'),
    });
  }

  async validate(payload: any) {
    if (payload.jti && await this.tokenBlacklist.isBlacklisted(payload.jti)) {
      throw new UnauthorizedException('Token révoqué');
    }
    return { id: payload.sub, email: payload.email, role: payload.role, jti: payload.jti };
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
  // Brute-force protection maps (in-memory, per phone number)
  private readonly loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
  private readonly otpAttempts   = new Map<string, { count: number; resetAt: number }>();

  private static readonly MAX_LOGIN_FAILURES = 5;
  private static readonly LOGIN_LOCK_MS      = 15 * 60 * 1000; // 15 min
  private static readonly MAX_OTP_FAILURES   = 3;
  private static readonly OTP_WINDOW_MS      = 10 * 60 * 1000; // 10 min

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {}

  private generateTokens(user: User) {
    const jti = uuidv4();
    const payload = { sub: user.id, email: user.email, role: user.role, jti };
    return {
      access_token: this.jwtService.sign(payload, { expiresIn: '30m' }),
      refresh_token: this.jwtService.sign(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
      user: this.sanitizeUser(user),
    };
  }

  private sanitizeUser(user: User) {
    const { passwordHash, otpCode, otpExpiresAt, otpAttempts, fcmToken, ...safe } = user as any;
    return safe;
  }

  async login(dto: LoginDto) {
    const key = dto.phone;
    const now = Date.now();
    const rec = this.loginAttempts.get(key);

    // Check account lock
    if (rec && rec.lockedUntil > now) {
      const minutesLeft = Math.ceil((rec.lockedUntil - now) / 60000);
      throw new UnauthorizedException(`Compte temporairement verrouillé. Réessayez dans ${minutesLeft} min.`);
    }

    const user = await this.userRepo.findOne({ where: { phone: dto.phone } });
    const valid = user?.passwordHash ? await verifyPassword(user.passwordHash, dto.password) : false;

    if (!user || !valid) {
      const current = (rec && rec.lockedUntil <= now) ? { count: 0, lockedUntil: 0 } : (rec || { count: 0, lockedUntil: 0 });
      const count = current.count + 1;
      const lockedUntil = count >= AuthService.MAX_LOGIN_FAILURES ? now + AuthService.LOGIN_LOCK_MS : 0;
      this.loginAttempts.set(key, { count, lockedUntil });
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!user.isActive) throw new UnauthorizedException('Compte désactivé');

    // Transparent migration: re-hash bcrypt passwords to Argon2id on successful login
    if (valid && isBcryptHash(user.passwordHash)) {
      const newHash = await hashPassword(dto.password);
      await this.userRepo.update(user.id, { passwordHash: newHash });
    }

    // Reset on success
    this.loginAttempts.delete(key);
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
      passwordHash: await hashPassword(dto.password),
    });
    await this.userRepo.save(user);
    return this.generateTokens(user);
  }

  async sendOtp(phone: string) {
    const user = await this.userRepo.findOne({ where: { phone } });
    if (!user) throw new BadRequestException('Numéro inconnu');

    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.userRepo.update(user.id, { otpCode: otp, otpExpiresAt: expiresAt });

    // TODO: send SMS via provider (Twilio / mock)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[OTP DEV] Phone: ${phone} — Code: ${otp}`);
    }
    return { message: 'OTP envoyé' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const key = dto.phone;
    const now = Date.now();
    const rec = this.otpAttempts.get(key) || { count: 0, resetAt: now + AuthService.OTP_WINDOW_MS };

    // Reset window if expired
    const current = rec.resetAt <= now ? { count: 0, resetAt: now + AuthService.OTP_WINDOW_MS } : rec;

    if (current.count >= AuthService.MAX_OTP_FAILURES) {
      throw new UnauthorizedException('Trop de tentatives. Demandez un nouveau code OTP.');
    }

    const user = await this.userRepo.findOne({ where: { phone: dto.phone } });

    if (!user || user.otpCode !== dto.otp) {
      this.otpAttempts.set(key, { count: current.count + 1, resetAt: current.resetAt });
      throw new UnauthorizedException('OTP invalide');
    }

    if (new Date() > user.otpExpiresAt) {
      this.otpAttempts.set(key, { count: current.count + 1, resetAt: current.resetAt });
      throw new UnauthorizedException('OTP expiré. Demandez un nouveau code.');
    }

    // Reset on success
    this.otpAttempts.delete(key);
    await this.userRepo.update(user.id, { otpCode: null, otpExpiresAt: null, isVerified: true });
    return this.generateTokens(user);
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.sanitizeUser(user);
  }

  async logout(jti: string) {
    if (jti) {
      const refreshTtl = 30 * 24 * 3600; // 30 days in seconds — matches refresh token expiry
      await this.tokenBlacklist.blacklist(jti, refreshTtl);
    }
    return { message: 'Déconnecté' };
  }

  async refreshTokens(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    // Blacklist l'ancien jti avant d'en émettre un nouveau (rotation)
    if (payload.jti) {
      await this.tokenBlacklist.blacklist(payload.jti, 60);
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('Compte invalide');

    return this.generateTokens(user);
  }
}

// ─── Auth Controller ────────────────────────────────────────
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @ApiOperation({ summary: 'Connexion par téléphone + mot de passe' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @Post('signup')
  @ApiOperation({ summary: 'Inscription client ou loueur' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Throttle({ default: { limit: 3, ttl: 300000 } })
  @Post('otp/send')
  @ApiOperation({ summary: 'Envoyer un code OTP' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phone);
  }

  @Throttle({ default: { limit: 3, ttl: 300000 } })
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

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Déconnexion et révocation du token' })
  logout(@Request() req: any) {
    return this.authService.logout(req.user.jti);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Renouveler les tokens (rotation)' })
  refresh(@Body() body: { refresh_token: string }) {
    if (!body?.refresh_token) throw new BadRequestException('refresh_token requis');
    return this.authService.refreshTokens(body.refresh_token);
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
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '30m') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthStrategy, RolesGuard, TokenBlacklistService],
  exports: [AuthService, JwtAuthStrategy, RolesGuard, JwtModule, TokenBlacklistService],
})
export class AuthModule {}
