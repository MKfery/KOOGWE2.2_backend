// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();

    const adminCount = await this.user.count({ where: { role: 'ADMIN' } });

    if (adminCount === 0) {
      const adminEmail = 'admin@koogwe.com';
      const plainPassword = process.env.ADMIN_PASSWORD || 'AdminKoogwe2026!';

      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      await this.user.create({
        data: {
          email: adminEmail,
          hashedPassword: hashedPassword,     // ← Plus de soulignement après migration
          firstName: 'Super',
          lastName: 'Admin',
          role: 'ADMIN',
          isActive: true,
          isVerified: true,
          accountStatus: 'ACTIVE',
        },
      });

      this.logger.log(`✅ Premier administrateur créé : ${adminEmail}`);
      this.logger.log(`🔑 Mot de passe : ${plainPassword}`);
      this.logger.warn('⚠️ Change ce mot de passe dès ta première connexion !');
    } else {
      this.logger.log('👤 Un administrateur existe déjà.');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}