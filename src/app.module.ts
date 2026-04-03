// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';

import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { WalletModule } from './wallet/wallet.module';
import { AdminModule } from './admin/admin.module';
import { DocumentsModule } from './documents/documents.module';
import { FaceVerificationModule } from './face-verification/face-verification.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppGateway } from './common/websocket.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting anti-spam OTP
    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 60000,  limit: 10 },
      { name: 'medium', ttl: 600000, limit: 30 },
    ]),

    // JWT pour le WebSocket Gateway (en dehors des modules auth)
    JwtModule.register({}),

    // Core
    PrismaModule,
    MailModule,

    // Feature modules
    AuthModule,
    UsersModule,
    DriversModule,
    RidesModule,
    WalletModule,
    AdminModule,
    DocumentsModule,
    FaceVerificationModule,
  ],
  providers: [
    // ✅ FIX: JwtAuthGuard global → toutes les routes protégées par défaut
    // Utiliser @Public() pour les routes publiques
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting global
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // WebSocket gateway
    AppGateway,
  ],
})
export class AppModule {}
