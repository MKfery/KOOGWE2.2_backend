// src/auth/auth.service.ts
import {
  Injectable, BadRequestException, UnauthorizedException,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SendOtpDto, VerifyOtpDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // ─── Envoi OTP ────────────────────────────────────────────────────────────
  async sendOtp(dto: SendOtpDto): Promise<{ message: string; expiresIn: number }> {
    const { language = 'fr' } = dto;
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { otpAttempts: true, otpExpiresAt: true },
    });

    if (existing?.otpAttempts >= 5 && existing?.otpExpiresAt > new Date()) {
      throw new HttpException(
        'Trop de tentatives. Réessayez dans 10 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otpCode = this.generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.user.upsert({
      where: { email },
      create: { email, otpCode, otpExpiresAt: expiresAt, otpAttempts: 0, language, accountStatus: 'EMAIL_NOT_VERIFIED' },
      update: { otpCode, otpExpiresAt: expiresAt, otpAttempts: 0, language },
    });

    // ✅ FIX V2: mail non-bloquant — si SMTP down, l'inscription ne plante pas
    try {
      await this.mail.sendOtp(email, otpCode, language);
    } catch (e) {
      this.logger.error(`Échec envoi OTP à ${email}: ${e.message}`);
      // En dev, log le code pour pouvoir tester
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`[DEV] OTP pour ${email}: ${otpCode}`);
      }
    }

    return { message: 'Code OTP envoyé par email', expiresIn: 600 };
  }

  // ─── Vérification OTP ─────────────────────────────────────────────────────
  async verifyOtp(dto: VerifyOtpDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { driverProfile: true },
    });

    if (!user) throw new BadRequestException('Aucun compte trouvé pour cet email');

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new BadRequestException('Le code OTP a expiré. Demandez-en un nouveau.');
    }

    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS', 5));
    if (user.otpAttempts >= maxAttempts) {
      throw new HttpException('Trop de tentatives incorrectes. Demandez un nouveau code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (user.otpCode !== dto.code) {
      await this.prisma.user.update({
        where: { email },
        data: { otpAttempts: { increment: 1 } },
      });
      const remaining = maxAttempts - user.otpAttempts - 1;
      throw new BadRequestException(`Code incorrect. ${remaining} tentative(s) restante(s).`);
    }

    const isNewUser = !user.isVerified;
    const updatedUser = await this.prisma.user.update({
      where: { email },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        accountStatus: user.role === 'DRIVER' ? 'FACE_VERIFICATION_PENDING' : 'ACTIVE',
        wallet: isNewUser ? { create: {} } : undefined,
      },
    });

    if (isNewUser) {
      this.mail.sendWelcome(email, user.firstName ?? '', user.language).catch(() => {});
    }

    const tokens = await this.generateTokens(updatedUser.id, updatedUser.email, updatedUser.role);

    // ✅ FIX V2: refresh token hashé avant stockage
    const hashedRefresh = await bcrypt.hash(tokens.refreshToken, 10);
    await this.prisma.user.update({
      where: { id: updatedUser.id },
      data: { refreshToken: hashedRefresh },
    });

    return {
      ...tokens,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        accountStatus: updatedUser.accountStatus,
        language: updatedUser.language,
        hasDriverProfile: !!user.driverProfile,
      },
      isNewUser,
    };
  }

  // ─── Refresh token ────────────────────────────────────────────────────────
  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, refreshToken: true, isActive: true },
    });

    if (!user || !user.isActive || !user.refreshToken) {
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    // ✅ FIX V2: comparer avec hash
    const isValid = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!isValid) throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    const hashedRefresh = await bcrypt.hash(tokens.refreshToken, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshToken: hashedRefresh } });
    return tokens;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, fcmToken: null },
    });
  }

  // ─── FCM Token ────────────────────────────────────────────────────────────
  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { fcmToken } });
  }

  // ─── Génération tokens JWT ────────────────────────────────────────────────
  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
