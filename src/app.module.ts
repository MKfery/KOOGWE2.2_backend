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
import { AdminModule } from './admin/admin.module';      // ✅ NOUVEAU
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppGateway } from './common/websocket.gateway';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    // Config global
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting (anti-spam OTP)
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 600000,
        limit: 30,
      },
    ]),

    // Core
    PrismaModule,
    MailModule,

    // JWT pour le WebSocket Gateway
    JwtModule.register({}),

    // Feature modules
    AuthModule,
    UsersModule,
    DriversModule,
    RidesModule,
    AdminModule,    // ✅ NOUVEAU
  ],
  providers: [
    // Guard JWT global (toutes les routes protégées par défaut)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting global
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // WebSocket
    AppGateway,
  ],
})
export class AppModule {}
