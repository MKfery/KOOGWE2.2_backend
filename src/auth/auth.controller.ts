// src/auth/auth.controller.ts
import { Controller, Post, Body, Req, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto, RefreshTokenDto } from './dto/auth.dto';
import { Public } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoie un code OTP par email' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifie le code OTP et retourne les tokens JWT' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouvelle les tokens JWT via le refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    const payload = JSON.parse(Buffer.from(dto.refreshToken.split('.')[1], 'base64').toString());
    return this.authService.refreshTokens(payload.sub, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  async logout(@Req() req: any) {
    await this.authService.logout(req.user.id);
    return { message: 'Déconnexion réussie' };
  }

  @Post('fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  async updateFcmToken(@Req() req: any, @Body('fcmToken') fcmToken: string) {
    await this.authService.updateFcmToken(req.user.id, fcmToken);
    return { message: 'FCM token mis à jour' };
  }

  @Get('me')
  @ApiBearerAuth()
  me(@Req() req: any) {
    return req.user;
  }
}
