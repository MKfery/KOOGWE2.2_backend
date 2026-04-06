// src/rides/rides.module.ts
// ✅ VERSION PRODUCTION — CommonModule importé pour injecter AppGateway dans RidesService

import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [RidesController],
  providers: [RidesService],
  exports: [RidesService],
})
export class RidesModule {}
