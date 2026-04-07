// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto, RefreshTokenDto, AdminLoginDto } from './dto/auth.dto';
import { Public } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── POST /api/auth/send-otp ──────────────────────────────────────────────
  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoie un code OTP par email' })
  @ApiResponse({ status: 200, description: 'OTP envoyé avec succès' })
  @ApiResponse({ status: 429, description: 'Trop de tentatives' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  // ─── POST /api/auth/verify-otp ────────────────────────────────────────────
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifie le code OTP et retourne les tokens JWT' })
  @ApiResponse({ status: 200, description: 'Authentification réussie' })
  @ApiResponse({ status: 400, description: 'Code incorrect ou expiré' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  // ─── POST /api/auth/admin-login ───────────────────────────────────────────
  // ✅ NOUVELLE ROUTE — Connexion admin par email + mot de passe
  @Public()
  @Post('admin-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion administrateur (email + mot de passe)' })
  @ApiResponse({ status: 200, description: 'Connexion admin réussie' })
  @ApiResponse({ status: 401, description: 'Identifiants invalides ou compte non-admin' })
  async adminLogin(@Body() dto: AdminLoginDto) {
    return this.authService.adminLogin(dto);
  }

  // ─── POST /api/auth/refresh ───────────────────────────────────────────────
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouvelle les tokens JWT via le refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    const payload = JSON.parse(
      Buffer.from(dto.refreshToken.split('.')[1], 'base64').toString(),
    );
    return this.authService.refreshTokens(payload.sub, dto.refreshToken);
  }

  // ─── POST /api/auth/logout ────────────────────────────────────────────────
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnexion — invalide le refresh token' })
  async logout(@Req() req: any) {
    await this.authService.logout(req.user.id);
    return { message: 'Déconnexion réussie' };
  }

  // ─── POST /api/auth/fcm-token ─────────────────────────────────────────────
  @Post('fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Met à jour le FCM token pour les notifications push' })
  async updateFcmToken(@Req() req: any, @Body('fcmToken') fcmToken: string) {
    await this.authService.updateFcmToken(req.user.id, fcmToken);
    return { message: 'FCM token mis à jour' };
  }

  // ─── GET /api/auth/me ─────────────────────────────────────────────────────
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Retourne le profil de l'utilisateur connecté" })
  async me(@Req() req: any) {
    return req.user;
  }
}
