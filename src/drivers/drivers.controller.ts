// src/drivers/drivers.controller.ts
import { Controller, Get, Post, Patch, Body, Req, Query, Param, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriversService } from './drivers.service';
import { FaceVerificationService } from '../face-verification/face-verification.service';
import { Roles, RolesGuard, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Drivers')
@ApiBearerAuth()
@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly faceVerificationService: FaceVerificationService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // PROFIL CHAUFFEUR
  // ─────────────────────────────────────────────────────────────────────────
  @Post('profile')
  @ApiOperation({ summary: 'Créer ou mettre à jour le profil chauffeur' })
  createProfile(@Req() req: any, @Body() dto: any) {
    return this.driversService.createProfile(req.user.id, dto);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Obtenir son profil chauffeur' })
  getProfile(@Req() req: any) {
    return this.driversService.getProfile(req.user.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VÉRIFICATION FACIALE
  // ─────────────────────────────────────────────────────────────────────────
  @Post('verify-face')
  @ApiOperation({ summary: 'Vérification faciale du chauffeur (selfie)' })
  async verifyFace(@Req() req: any, @Body() body: { imageBase64: string }) {
    if (!body.imageBase64) {
      return { success: false, message: 'Image base64 requise' };
    }
    return this.faceVerificationService.verifyFace(req.user.id, body.imageBase64);
  }

  @Get('face-status')
  @ApiOperation({ summary: 'Récupérer le statut de vérification faciale' })
  async getFaceStatus(@Req() req: any) {
    return this.faceVerificationService.getFaceVerificationStatus(req.user.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DISPONIBILITÉ & LOCALISATION
  // ─────────────────────────────────────────────────────────────────────────
  @Patch('availability')
  @ApiOperation({ summary: 'Passer en ligne / hors ligne' })
  updateAvailability(@Req() req: any, @Body() dto: any) {
    return this.driversService.updateAvailability(req.user.id, dto);
  }

  @Patch('location')
  @ApiOperation({ summary: 'Mettre à jour la position GPS' })
  updateLocation(@Req() req: any, @Body() dto: any) {
    return this.driversService.updateLocation(req.user.id, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATISTIQUES & HISTORIQUE
  // ─────────────────────────────────────────────────────────────────────────
  @Get('stats')
  @ApiOperation({ summary: 'Statistiques et gains du chauffeur' })
  getStats(@Req() req: any) {
    return this.driversService.getStats(req.user.id);
  }

  @Get('rides')
  @ApiOperation({ summary: 'Historique des courses du chauffeur' })
  getRides(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '10') {
    return this.driversService.getRideHistory(req.user.id, +page, +limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENTS
  // ─────────────────────────────────────────────────────────────────────────
  @Post('documents')
  @ApiOperation({ summary: 'Enregistrer un document (multipart file)' })
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Req() req: any,
    @Body('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // Si c'est un fichier uploadé, utiliser l'URL
    if (file) {
      return this.driversService.uploadDocument(req.user.id, type, file.path);
    }
    // Sinon accepter aussi fileUrl (compatibilité)
    const { fileUrl } = req.body;
    return this.driversService.uploadDocument(req.user.id, type, fileUrl);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ROUTES ADMIN SEULEMENT
  // ─────────────────────────────────────────────────────────────────────────
  @Get('admin/pending')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[ADMIN] Liste des chauffeurs en attente' })
  getPendingDrivers() {
    return this.driversService.getPendingDrivers();
  }

  @Patch('admin/:id/approve')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[ADMIN] Approuver un chauffeur' })
  approveDriver(@Param('id') id: string) {
    return this.driversService.approveDriver(id);
  }

  @Patch('admin/:id/reject')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[ADMIN] Rejeter un chauffeur' })
  rejectDriver(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.driversService.rejectDriver(id, reason);
  }
}