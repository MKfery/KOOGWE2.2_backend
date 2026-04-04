// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | undefined;
  private readonly from: string;

  constructor(private config: ConfigService) {
    // Lire via ConfigService ET process.env en fallback
    this.apiKey = config.get<string>('RESEND_API_KEY') || process.env.RESEND_API_KEY;
    this.from   = config.get<string>('MAIL_FROM') || process.env.MAIL_FROM || 'Koogwe <onboarding@resend.dev>';

    this.logger.log(`🔑 RESEND_API_KEY présente: ${!!this.apiKey}`);
    this.logger.log(`🔑 Valeur début: ${this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'VIDE'}`);
    this.logger.log(`📧 MAIL_FROM: ${this.from}`);

    if (this.apiKey) {
      this.logger.log('✅ Resend API configuré');
    } else {
      this.logger.warn('⚠️ RESEND_API_KEY manquant — vérifiez les variables Railway');
    }
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`⚠️ Email NON envoyé (pas de clé API) → To: ${to} | Subject: ${subject}`);
      this.logger.warn('👉 Ajoutez RESEND_API_KEY dans les variables Railway et redéployez');
      return;
    }

    try {
      this.logger.log(`📤 Envoi email via Resend → ${to}`);

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to, subject, html }),
      });

      const responseText = await res.text();

      if (!res.ok) {
        this.logger.error(`❌ Resend API erreur ${res.status}: ${responseText}`);
        throw new Error(`Resend API error ${res.status}: ${responseText}`);
      }

      this.logger.log(`✅ Email envoyé avec succès à ${to} | Réponse: ${responseText}`);
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