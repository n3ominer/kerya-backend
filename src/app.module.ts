import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import * as DatabaseEntities from './database/entities';

import { AuthModule } from './modules/auth/auth.module';
import {
  UsersModule,
  PricingModule,
  DocumentsModule,
  ReviewsModule,
  NotificationsModule,
  SupportModule,
  AdminModule,
  AuditModule,
} from './modules/combined.modules';
import { LessorsModule } from './modules/lessors/lessors.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { AvailabilitiesModule } from './modules/availabilities/availabilities.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'vehiculedz'),
        password: config.get('DB_PASSWORD', 'vehiculedz_secret'),
        database: config.get('DB_NAME', 'vehiculedz_db'),
        entities: Object.values(DatabaseEntities),
        migrations: [__dirname + '/database/migrations/**/*{.ts,.js}'],
        synchronize: config.get('DB_SYNC', 'true') === 'true',
        logging: config.get('DB_LOGGING', 'false') === 'true',
        ssl: config.get('NODE_ENV') === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }),
      inject: [ConfigService],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => [{
        ttl: config.get<number>('THROTTLE_TTL', 60),
        limit: config.get<number>('THROTTLE_LIMIT', 100),
      }],
      inject: [ConfigService],
    }),

    // Scheduled tasks
    ScheduleModule.forRoot(),

    // Feature modules
    AuthModule,
    UsersModule,
    LessorsModule,
    VehiclesModule,
    AvailabilitiesModule,
    PricingModule,
    BookingsModule,
    PaymentsModule,
    DocumentsModule,
    ReviewsModule,
    NotificationsModule,
    SupportModule,
    AdminModule,
    AuditModule,
    SettingsModule,
  ],
})
export class AppModule {}
