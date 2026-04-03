// src/face-verification/face-verification.controller.ts
import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FaceVerificationService } from './face-verification.service';

@ApiTags('FaceVerification')
@ApiBearerAuth()
@Controller('face-verification')
export class FaceVerificationController {
  constructor(private faceVerificationService: FaceVerificationService) {}

  @Post('verify-live')
  @ApiOperation({ summary: 'Vérification faciale en direct (étape 1)' })
  verifyLiveFace(@Req() req: any, @Body() body: { imageBase64: string }) {
    return this.faceVerificationService.verifyLiveFace(req.user.id, body.imageBase64);
  }

  @Post('verify-movements')
  @ApiOperation({ summary: 'Vérification mouvements tête (étape 2)' })
  verifyHeadMovements(
    @Req() req: any,
    @Body() body: { leftImage: string; rightImage: string; upImage: string; downImage: string },
  ) {
    return this.faceVerificationService.verifyHeadMovements(
      req.user.id, body.leftImage, body.rightImage, body.upImage, body.downImage,
    );
  }
}
