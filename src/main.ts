import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  const fallback =
    process.env.DATABASE_PRIVATE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.POSTGRES_URL;
  if (fallback) { process.env.DATABASE_URL = fallback; return; }
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (PGHOST && PGPORT && PGUSER && PGPASSWORD && PGDATABASE) {
    const u = encodeURIComponent(PGUSER);
    const p = encodeURIComponent(PGPASSWORD);
    process.env.DATABASE_URL = `postgresql://${u}:${p}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public`;
  }
}

async function bootstrap() {
  ensureDatabaseUrl();
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ── Body limit pour photos base64 (vérification faciale) ──────────────────
  app.use(require('express').json({ limit: '50mb' }));
  app.use(require('express').urlencoded({ limit: '50mb', extended: true }));

  // ── Dossier uploads statique ───────────────────────────────────────────────
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', require('express').static(uploadsDir));

  // ── Préfixe global /api ────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Validation globale ─────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── CORS — liste blanche + mobiles Flutter sans Origin ────────────────────
  const allowedOrigins: string[] = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://10.0.2.2:3000',
  ];
  if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL.trim());
  if (process.env.FRONTEND_URLS) {
    process.env.FRONTEND_URLS.split(',')
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((u) => allowedOrigins.push(u));
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Pas d'origin = app mobile Flutter / curl → autorisé
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(`⛔ CORS bloqué: ${origin}`);
      callback(new Error(`CORS bloqué: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
  });

  // ── Swagger (désactivé en production) ─────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Koogwe API v3')
      .setDescription('Backend fusionné — passager, chauffeur, admin · Guyane')
      .setVersion('3.0')
      .addBearerAuth()
      .addTag('Auth', 'OTP email authentication')
      .addTag('Users', 'Profils utilisateurs')
      .addTag('Drivers', 'Chauffeurs et documents')
      .addTag('Rides', 'Cycle de vie des courses')
      .addTag('Wallet', 'Portefeuille électronique')
      .addTag('Admin', 'Dashboard administrateur')
      .addTag('FaceVerification', 'Vérification faciale AWS')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log('📚 Swagger: http://localhost:3000/api/docs');
  }

  // ── Bootstrap compte admin depuis variables d'environnement ───────────────
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const prisma = app.get(PrismaService);
    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { role: 'ADMIN', isVerified: true, isActive: true, accountStatus: 'ACTIVE' },
      create: {
        email: adminEmail,
        role: 'ADMIN',
        isVerified: true,
        isActive: true,
        accountStatus: 'ACTIVE',
        wallet: { create: {} },
      },
    });
    logger.log(`✅ Compte admin prêt: ${adminEmail}`);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Koogwe API v3 démarrée sur le port ${port}`);
  logger.log(`🌍 Environnement: ${process.env.NODE_ENV ?? 'development'}`);
  logger.log(`🔐 CORS: ${allowedOrigins.length} origines web + mobiles Flutter`);
}

bootstrap();
