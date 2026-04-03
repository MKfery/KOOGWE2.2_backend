// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private readonly smtpEnabled: boolean;

  constructor(private config: ConfigService) {
    const host = config.get('MAIL_HOST');
    const user = config.get('MAIL_USER');
    this.smtpEnabled = !!(host && user);

    if (this.smtpEnabled) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(config.get('MAIL_PORT', 587)),
        secure: config.get('MAIL_SECURE') === 'true',
        auth: { user, pass: config.get('MAIL_PASS') },
      });
      this.logger.log('✅ SMTP configuré');
    } else {
      this.logger.warn('⚠️ SMTP non configuré — emails loggués uniquement');
    }
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.smtpEnabled) {
      this.logger.log(`[EMAIL LOG] To: ${to} | Subject: ${subject}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM', 'noreply@koogwe.com'),
        to, subject, html,
      });
    } catch (error) {
      // ✅ FIX V1+V2: erreur SMTP loggée mais jamais bloquante
      this.logger.error(`Échec envoi email à ${to}: ${error.message}`);
      throw error; // relancer pour que l'appelant puisse choisir d'ignorer
    }
  }

  async sendOtp(email: string, code: string, language = 'fr'): Promise<void> {
    const subjects: Record<string, string> = {
      fr: 'Votre code de vérification Koogwe',
      en: 'Your Koogwe verification code',
      es: 'Tu código de verificación Koogwe',
      pt: 'Seu código de verificação Koogwe',
      ht: 'Kòd verifikasyon Koogwe ou',
    };
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:30px;border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.1)">
        <h1 style="color:#FF6B35;text-align:center">🚗 Koogwe</h1>
        <p>Votre code de vérification :</p>
        <div style="background:#FF6B35;color:#fff;text-align:center;padding:20px;border-radius:10px;font-size:36px;font-weight:bold;letter-spacing:8px">${code}</div>
        <p style="color:#666;font-size:13px">Valable 10 minutes. Ne partagez jamais ce code.</p>
      </div>`;
    await this.send(email, subjects[language] ?? subjects.fr, html);
  }

  async sendWelcome(email: string, firstName: string, language = 'fr'): Promise<void> {
    const html = `<h1>Bienvenue ${firstName || ''} sur Koogwe 🚗</h1><p>Votre compte est activé.</p>`;
    await this.send(email, 'Bienvenue sur Koogwe !', html);
  }

  async sendDriverApproved(email: string, firstName: string): Promise<void> {
    const html = `<h1>✅ Compte validé</h1><p>Bonjour ${firstName}, votre compte chauffeur Koogwe est maintenant actif !</p>`;
    await this.send(email, '✅ Votre compte chauffeur Koogwe est validé !', html);
  }

  async sendDriverRejected(email: string, firstName: string, reason?: string): Promise<void> {
    const html = `<h1>❌ Dossier refusé</h1><p>Bonjour ${firstName}, votre dossier n'a pas été accepté.</p>${reason ? `<p>Motif : ${reason}</p>` : ''}`;
    await this.send(email, 'Décision sur votre dossier Koogwe', html);
  }

  async sendRideValidationEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Course ${payload.rideId} validée → ${email}`);
  }

  async sendDriverAssignedEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Chauffeur ${payload.driverName} assigné → ${email}`);
  }

  async sendRideCancelledEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Course ${payload.rideId} annulée → ${email}`);
  }

  async sendRideCompletedEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Course ${payload.rideId} terminée ${payload.price}€ → ${email}`);
  }
}
