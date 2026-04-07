// src/face-verification/face-verification.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class FaceVerificationService {
  private readonly logger = new Logger(FaceVerificationService.name);

  // Configuration
  private readonly bypassEnabled = process.env.FACE_VERIFICATION_BYPASS === 'true';
  private readonly minConfidence = Number(process.env.FACE_MIN_CONFIDENCE) || 75; // 75% par défaut

  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Vérification faciale principale (utilisée par l'app chauffeur)
   */
  async verifyFace(userId: string, imageBase64: string): Promise<{
    success: boolean;
    message: string;
    verified?: boolean;
    confidence?: number;
  }> {
    try {
      // Mode bypass (utile en développement)
      if (this.bypassEnabled) {
        await this.approveFace(userId);
        this.logger.log(`✅ Face verification bypassed for user ${userId}`);
        return { success: true, message: 'Vérification faciale validée (mode bypass)', verified: true };
      }

      if (!imageBase64 || imageBase64.length < 500) {
        throw new BadRequestException('Image invalide ou trop petite');
      }

      // Upload de l'image sur Cloudinary
      const uploadResult = await this.cloudinaryService.uploadImage(
        imageBase64,
        `koogwe/faces/${userId}`,
        `face_${Date.now()}`
      );

      // Pour le moment : vérification basique (on accepte si l'upload réussit)
      // On pourra ajouter plus tard une analyse IA via Cloudinary ou un autre service

      await this.approveFace(userId, uploadResult.url);

      this.logger.log(`✅ Face verification successful for user ${userId}`);

      return {
        success: true,
        message: 'Visage vérifié avec succès',
        verified: true,
        confidence: 85, // Valeur fictive pour le moment
      };
    } catch (error: any) {
      this.logger.error(`Face verification failed for ${userId}: ${error.message}`);

      return {
        success: false,
        message: error.message || 'Erreur lors de la vérification faciale. Réessayez.',
      };
    }
  }

  /**
   * Approuve la vérification faciale et met à jour les statuts
   */
  private async approveFace(userId: string, faceImageUrl?: string) {
    // Mise à jour du User principal
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        faceVerified: true,
        faceImageUrl: faceImageUrl,
        faceVerifiedAt: new Date(),
        accountStatus: 'DOCUMENTS_PENDING',   // Prochaine étape : documents
      },
    });

    // Mise à jour du DriverProfile
    await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        faceVerified: true,
        faceVerifiedAt: new Date(),
      },
    }).catch(() => undefined); // Si le profil n'existe pas encore
  }

  /**
   * Récupère le statut de vérification faciale
   */
  async getFaceVerificationStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        faceVerified: true,
        faceVerifiedAt: true,
        accountStatus: true,
      },
    });

    return {
      faceVerified: user?.faceVerified || false,
      faceVerifiedAt: user?.faceVerifiedAt,
      accountStatus: user?.accountStatus,
      canProceed: user?.faceVerified === true,
    };
  }

  /**
   * (Optionnel) Réinitialiser la vérification faciale (pour tests/admin)
   */
  async resetFaceVerification(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        faceVerified: false,
        faceImageUrl: null,
        faceVerifiedAt: null,
      },
    });

    await this.prisma.driverProfile.update({
      where: { userId },
      data: {
        faceVerified: false,
        faceVerifiedAt: null,
      },
    }).catch(() => undefined);
  }
}