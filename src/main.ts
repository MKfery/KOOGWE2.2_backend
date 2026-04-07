// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ─── CORS ─────────────────────────────────────────────────────────────────
  // On autorise toutes les origines (apps mobiles Flutter + admin web)
  app.enableCors({
    origin: true,   // ✅ Accepte toutes les origines
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // ─── Validation globale ───────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ─── Préfixe global /api ──────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ─── Swagger Documentation ────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Koogwe Transport API')
    .setDescription('Backend API pour les applications passager et chauffeur Koogwe')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentification OTP par email')
    .addTag('Admin', 'Administration')
    .addTag('Users', 'Gestion des profils utilisateurs')
    .addTag('Rides', 'Cycle de vie des courses')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  logger.log('📚 Swagger disponible sur /api/docs');

  // ─── Démarrage ────────────────────────────────────────────────────────────
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Koogwe API démarrée sur le port ${port}`);
  logger.log(`🌍 Environnement: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap();
