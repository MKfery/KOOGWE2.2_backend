import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { WalletModule } from './wallet/wallet.module';
import { AdminModule } from './admin/admin.module';
import { DocumentsModule } from './documents/documents.module';
import { FaceVerificationModule } from './face-verification/face-verification.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 60000,  limit: 10 },
      { name: 'medium', ttl: 600000, limit: 30 },
    ]),
    PrismaModule,
    MailModule,
    CommonModule,   // ← ligne ajoutée
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // ← AppGateway supprimé d'ici (il est dans CommonModule maintenant)
  ],
})
export class AppModule {}