import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class TokenBlacklistService implements OnModuleInit {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private redis: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redis.on('error', (e) => this.logger.error('Redis error', e.message));
  }

  async blacklist(jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`bl:${jti}`, '1', 'EX', ttlSeconds);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const val = await this.redis.get(`bl:${jti}`);
    return val === '1';
  }
}
