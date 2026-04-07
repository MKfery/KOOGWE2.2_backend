// src/face-verification/face-verification.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FaceVerificationService } from './face-verification.service';

@ApiTags('Face Verification')
@ApiBearerAuth()
@Controller('drivers')
@UseGuards(JwtAuthGuard)   // Protection par JWT (obligatoire pour chauffeur)
export class FaceVerificationController {
  constructor(private readonly faceVerificationService: FaceVerificationService) {}

  /**
   * Vérification faciale principale (selfie)
   * Utilisée par l'écran FaceVerificationScreen du chauffeur
   */
  @Post('verify-face')
  @ApiOperation({
    summary: 'Vérification faciale du chauffeur (selfie)',
    description: 'Envoie une photo selfie en base64 pour vérifier l\'identité du chauffeur.'
  })
  @ApiResponse({
    status: 200,
    description: 'Vérification réussie',
    schema: {
      example: {
        success: true,
        message: 'Face verified successfully',
        verified: true,
        confidence: 0.92
      }
    }
  })
  async verifyFace(
    @Req() req: any,
    @Body() body: { imageBase64: string }
  ) {
    if (!body.imageBase64) {
      return {
        success: false,
        message: 'Image base64 requise'
      };
    }

    return this.faceVerificationService.verifyFace(
      req.user.id,
      body.imageBase64
    );
  }

  /**
   * (Optionnel - pour version plus stricte plus tard)
   * Vérification avec plusieurs mouvements de tête
   */
  @Post('verify-face/movements')
  @ApiOperation({
    summary: 'Vérification faciale avec mouvements (plus stricte)',
    description: 'Utilise plusieurs photos avec mouvements de tête pour une vérification renforcée.'
  })
  async verifyFaceWithMovements(
    @Req() req: any,
    @Body() body: {
      frontImage: string;
      leftImage?: string;
      rightImage?: string;
      smileImage?: string;
    }
  ) {
    return this.faceVerificationService.verifyFaceWithMovements(
      req.user.id,
      body.frontImage,
      body.leftImage,
      body.rightImage,
      body.smileImage,
    );
  }

  /**
   * Récupérer le statut de vérification faciale du chauffeur
   */
  @Post('face-status')
  @ApiOperation({ summary: 'Récupérer le statut de vérification faciale' })
  async getFaceStatus(@Req() req: any) {
    return this.faceVerificationService.getFaceVerificationStatus(req.user.id);
  }
}