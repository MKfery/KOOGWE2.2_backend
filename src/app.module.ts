// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { AdminModule } from './admin/admin.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppGateway } from './common/websocket.gateway';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    // 1. Configuration globale (doit être en premier)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Rate Limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000,      // 1 minute
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 600000,     // 10 minutes
        limit: 30,
      },
    ]),

    // 3. Core & Infrastructure
    PrismaModule,
    MailModule,
    CloudinaryModule,           // ← Cloudinary pour les photos de visage et documents

    // 4. JWT (global)
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),

    // 5. Feature Modules
    AuthModule,
    UsersModule,
    DriversModule,      // ← Contient maintenant FaceVerification
    RidesModule,
    AdminModule,
  ],
  providers: [
    // Global Guards
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,      // Protège toutes les routes par défaut
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,    // Protection anti-brute force
    },

    // WebSocket Gateway
    AppGateway,
  ],
})
export class AppModule {}