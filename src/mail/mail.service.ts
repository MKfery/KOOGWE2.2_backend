// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private config: ConfigService) {
    const mailUser = config.get<string>('MAIL_USER') || process.env.MAIL_USER;
    const mailPass = config.get<string>('MAIL_PASS') || process.env.MAIL_PASS;
    const mailSecure = config.get<string>('MAIL_SECURE') || process.env.MAIL_SECURE;
    this.from = `Koogwe <${mailUser}>`;

    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: mailSecure === 'true' ? 465 : 587,
      secure: mailSecure === 'true',
      auth: {
        user: mailUser,
        pass: mailPass,
      },
    });

    // Vérifier la connexion SMTP au démarrage
    this.transporter.verify((error) => {
      if (error) {
        this.logger.error(`❌ SMTP Gmail non connecté: ${error.message}`);
      } else {
        this.logger.log(`✅ SMTP Gmail connecté — prêt à envoyer depuis ${mailUser}`);
      }
    });
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      this.logger.log(`📤 Envoi email → ${to}`);
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      this.logger.log(`✅ Email envoyé à ${to} | MessageId: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`❌ Échec envoi email à ${to}: ${error.message}`);
      throw error;
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
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:30px;
                  border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.1)">
        <h1 style="color:#FF6B35;text-align:center">🚗 Koogwe</h1>
        <p style="color:#333;font-size:16px">Votre code de vérification :</p>
        <div style="background:#FF6B35;color:#fff;text-align:center;padding:24px;
                    border-radius:12px;font-size:40px;font-weight:bold;letter-spacing:10px;
                    margin:20px 0">${code}</div>
        <p style="color:#888;font-size:13px">
          Ce code est valable <strong>10 minutes</strong>.<br>
          Ne le partagez jamais.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
        <p style="color:#bbb;font-size:11px;text-align:center">
          © ${new Date().getFullYear()} Koogwe Transport
        </p>
      </div>`;
    await this.send(email, subjects[language] ?? subjects.fr, html);
  }

  async sendWelcome(email: string, firstName: string, language = 'fr'): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:30px">
        <h1 style="color:#FF6B35">🚗 Bienvenue sur Koogwe !</h1>
        <p>Bonjour ${firstName || 'là'},</p>
        <p>Votre compte est activé. Vous pouvez maintenant commander des courses.</p>
        <p style="color:#888;font-size:12px">© ${new Date().getFullYear()} Koogwe Transport</p>
      </div>`;
    await this.send(email, 'Bienvenue sur Koogwe !', html);
  }

  async sendDriverApproved(email: string, firstName: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:30px">
        <h1 style="color:#10B981">✅ Compte validé !</h1>
        <p>Bonjour ${firstName},</p>
        <p>Votre compte chauffeur Koogwe est maintenant <strong>actif</strong>.</p>
        <p>Vous pouvez vous connecter et commencer à accepter des courses.</p>
        <p style="color:#888;font-size:12px">© ${new Date().getFullYear()} Koogwe Transport</p>
      </div>`;
    await this.send(email, '✅ Votre compte chauffeur Koogwe est validé !', html);
  }

  async sendDriverRejected(email: string, firstName: string, reason?: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:30px">
        <h1 style="color:#EF4444">❌ Dossier non accepté</h1>
        <p>Bonjour ${firstName},</p>
        <p>Votre dossier chauffeur n'a pas été accepté.</p>
        ${reason ? `<p><strong>Motif :</strong> ${reason}</p>` : ''}
        <p>Contactez notre support pour plus d'informations.</p>
        <p style="color:#888;font-size:12px">© ${new Date().getFullYear()} Koogwe Transport</p>
      </div>`;
    await this.send(email, 'Décision sur votre dossier Koogwe', html);
  }

  async sendRideValidationEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Course ${payload?.rideId} validée → ${email}`);
  }

  async sendDriverAssignedEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Chauffeur ${payload?.driverName} assigné → ${email}`);
  }

  async sendRideCancelledEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Course ${payload?.rideId} annulée → ${email}`);
  }

  async sendRideCompletedEmail(email: string, payload: any): Promise<void> {
    this.logger.log(`[EMAIL] Course ${payload?.rideId} terminée → ${email}`);
  }
}
