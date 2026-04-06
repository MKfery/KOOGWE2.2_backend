// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AppGateway } from '../common/websocket.gateway';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [AdminController],
  providers: [AdminService, AppGateway],
  exports: [AdminService],
})
export class AdminModule {}