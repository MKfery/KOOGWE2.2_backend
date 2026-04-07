// src/drivers/drivers.module.ts
import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { FaceVerificationController } from '../face-verification/face-verification.controller';
import { FaceVerificationService } from '../face-verification/face-verification.service';

import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    CloudinaryModule,
    PrismaModule,
  ],
  controllers: [
    DriversController,
    FaceVerificationController,     // ← Important
  ],
  providers: [
    DriversService,
    FaceVerificationService,        // ← Important
  ],
  exports: [
    DriversService,
    FaceVerificationService,
  ],
})
export class DriversModule {}