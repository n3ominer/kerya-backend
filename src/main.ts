import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

  // Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow images/assets from cross-origin (uploads served on different port in dev)
  }));

  // Global prefix
  app.setGlobalPrefix(apiPrefix);

  // Serve uploaded files (photos, documents) as static assets
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads/' });

  // CORS
  const isProduction = configService.get('NODE_ENV') === 'production';
  const allowedOrigins = configService
    .get<string>('FRONTEND_URL', 'http://localhost:3001')
    .split(',')
    .map((u) => u.trim());
  app.enableCors({
    origin: isProduction
      ? allowedOrigins
      : (origin, callback) => {
          if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger documentation
  if (configService.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('VehiculeDZ API')
      .setDescription('API de location de véhicules en Algérie')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentification')
      .addTag('vehicles', 'Gestion des véhicules')
      .addTag('bookings', 'Réservations')
      .addTag('payments', 'Paiements')
      .addTag('lessors', 'Loueurs')
      .addTag('admin', 'Administration')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    Logger.log(`📖 Swagger: http://localhost:${port}/docs`, 'Bootstrap');
  }

  // Health check (outside the global prefix so Docker/Cloudflare can reach it simply)
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req, res: any) => res.send({ status: 'ok' }));
  httpAdapter.get(`/${apiPrefix}/health`, (_req, res: any) => res.send({ status: 'ok' }));

  await app.listen(port);
  Logger.log(`🚀 VehiculeDZ API started on port ${port}`, 'Bootstrap');
  Logger.log(`🌍 Env: ${configService.get('NODE_ENV')}`, 'Bootstrap');
}

bootstrap();
