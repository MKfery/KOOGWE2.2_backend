// src/face-verification/face-verification.module.ts
import { Module } from '@nestjs/common';
import { FaceVerificationController } from './face-verification.controller';
import { FaceVerificationService } from './face-verification.service';
import { AWSRekognitionService } from './aws-rekognition.service';

@Module({
  controllers: [FaceVerificationController],
  providers: [FaceVerificationService, AWSRekognitionService],
  exports: [FaceVerificationService, AWSRekognitionService],
})
export class FaceVerificationModule {}
