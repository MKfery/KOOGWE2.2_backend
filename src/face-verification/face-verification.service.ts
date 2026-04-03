// src/face-verification/face-verification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AWSRekognitionService } from './aws-rekognition.service';

@Injectable()
export class FaceVerificationService {
  private readonly logger = new Logger(FaceVerificationService.name);
  private readonly strictMode: boolean;
  private readonly bypassEnabled: boolean;

  constructor(private prisma: PrismaService, private aws: AWSRekognitionService) {
    this.strictMode = process.env.FACE_VERIFICATION_STRICT !== 'false';
    this.bypassEnabled = process.env.FACE_VERIFICATION_BYPASS === 'true';
  }

  private async approveFace(userId: string, faceImageUrl?: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { faceVerified: true, ...(faceImageUrl ? { faceImageUrl } : {}), accountStatus: 'DOCUMENTS_PENDING' as any },
    });
    await this.prisma.driverProfile.update({
      where: { userId },
      data: { faceVerified: true, faceVerifiedAt: new Date() },
    }).catch(() => undefined);
  }

  async verifyLiveFace(userId: string, imageBase64: string): Promise<{ success: boolean; message: string }> {
    try {
      if (this.bypassEnabled) {
        await this.approveFace(userId);
        return { success: true, message: 'Vérification faciale validée (mode bypass)' };
      }

      if (!imageBase64 || imageBase64.length < 500) return { success: false, message: 'Image invalide. Réessayez.' };

      const minConf = Number(process.env.FACE_LIVE_MIN_CONFIDENCE ?? (this.strictMode ? 90 : 70));
      const { isLive, confidence } = await this.aws.detectLiveness(imageBase64);
      const passed = this.strictMode ? isLive && confidence >= minConf : isLive || confidence >= minConf;

      if (!passed) return { success: false, message: 'Visage non détecté correctement. Assurez-vous d\'être bien éclairé.' };

      const faceUrl = await this.aws.uploadFaceImage(userId, imageBase64);
      await this.approveFace(userId, faceUrl);
      this.logger.log(`✅ Face live verification OK: ${userId}`);
      return { success: true, message: 'Visage vérifié avec succès' };
    } catch (error) {
      this.logger.error(`verifyLiveFace error: ${error.message}`);
      return { success: false, message: 'Erreur lors de la vérification du visage' };
    }
  }

  async verifyHeadMovements(userId: string, leftImage: string, rightImage: string, upImage: string, downImage: string): Promise<{ success: boolean; message: string }> {
    try {
      if (this.bypassEnabled) {
        await this.approveFace(userId);
        return { success: true, message: 'Vérification faciale validée (mode bypass)' };
      }

      const images = [leftImage, rightImage, upImage, downImage].filter((img) => img?.length > 500);
      if (images.length < 2) return { success: false, message: 'Veuillez compléter tous les mouvements de tête' };

      const minSimilarity = Number(process.env.FACE_MIN_SIMILARITY ?? (this.strictMode ? 75 : 60));
      const requiredMatches = Number(process.env.FACE_REQUIRED_MATCHES ?? (this.strictMode ? 2 : 1));

      const similarities: number[] = [];
      for (let i = 1; i < images.length; i++) {
        const { similarity } = await this.aws.compareFaces(images[0], images[i]);
        similarities.push(similarity);
      }

      const valid = similarities.filter((s) => s > 0);
      const strong = valid.filter((s) => s >= minSimilarity);
      const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
      const required = Math.min(requiredMatches, similarities.length);

      this.logger.log(`Face movements: valid=${valid.length} strong=${strong.length}/${required} avg=${avg.toFixed(0)}%`);

      if (strong.length < required) {
        return { success: false, message: `Correspondance insuffisante (score: ${avg.toFixed(0)}%, seuil: ${minSimilarity}%). Réessayez avec une bonne lumière.` };
      }

      const faceUrl = await this.aws.uploadFaceImage(userId, images[0]);
      await this.approveFace(userId, faceUrl);
      this.logger.log(`✅ Face movements OK: ${userId} (avg ${avg.toFixed(0)}%)`);
      return { success: true, message: 'Vérification faciale réussie' };
    } catch (error) {
      this.logger.error(`verifyHeadMovements error: ${error.message}`);
      return { success: false, message: 'Erreur lors de la vérification' };
    }
  }
}
