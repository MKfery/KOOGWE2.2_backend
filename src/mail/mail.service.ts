// src/mail/mail.service.ts (version Resend)
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;
  private logger = new Logger('MailService');

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendOtp(email: string, code: string, language = 'fr') {
    const subject = language === 'fr' ? 'Votre code Koogwe' : 'Your Koogwe verification code';
    const html = `
      <h1>${code}</h1>
      <p>Ce code expire dans 10 minutes.</p>
    `;
    await this.sendEmail(email, subject, html);
    this.logger.log(`OTP envoyé à ${email}`);
  }

  async sendWelcome(email: string, firstName: string, language = 'fr') {
    const subject = language === 'fr' ? 'Bienvenue sur Koogwe' : 'Welcome to Koogwe';
    const html = `
      <h1>Bienvenue ${firstName} !</h1>
      <p>Votre compte a été créé avec succès.</p>
    `;
    await this.sendEmail(email, subject, html);
  }

  async sendRideConfirmation(email: string, rideDetails: any, language = 'fr') {
    const subject = language === 'fr' ? 'Confirmation de course Koogwe' : 'Koogwe Ride Confirmation';
    const html = `
      <h1>Course confirmée</h1>
      <p>Détails: ${JSON.stringify(rideDetails)}</p>
    `;
    await this.sendEmail(email, subject, html);
  }

  async sendDriverValidation(email: string, approved: boolean, language = 'fr') {
    const subject = approved ? 'Compte chauffeur validé' : 'Compte chauffeur refusé';
    const html = approved ? '<h1>Votre compte est validé !</h1>' : '<h1>Votre compte a été refusé.</h1>';
    await this.sendEmail(email, subject, html);
  }

  async sendPaymentConfirmation(email: string, amount: number, language = 'fr') {
    const subject = 'Confirmation de paiement';
    const html = `<h1>Paiement de ${amount} XOF confirmé</h1>`;
    await this.sendEmail(email, subject, html);
  }

  private async sendEmail(to: string, subject: string, html: string) {
    try {
      await this.resend.emails.send({
        from: 'Koogwe <noreply@koogwe.com>',
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(`Erreur envoi email: ${error.message}`);
      throw error;
    }
  }
}