// src/face-verification/face-verification.module.ts
import { Module } from '@nestjs/common';
import { FaceVerificationController } from './face-verification.controller';
import { FaceVerificationService } from './face-verification.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    CloudinaryModule,
    PrismaModule,   // ✅ Requis — FaceVerificationService injecte PrismaService
  ],
  controllers: [FaceVerificationController],
  providers: [FaceVerificationService],
  exports: [FaceVerificationService],
})
export class FaceVerificationModule {}