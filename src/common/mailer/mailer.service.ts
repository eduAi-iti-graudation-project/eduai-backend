import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailContent {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isEmailDisabled(): boolean {
  return process.env.EMAILS_DISABLED === 'true';
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private getTransporterCache: Transporter | null = null;

  private getTransporter(): Transporter | null {
    if (!isSmtpConfigured() || isEmailDisabled()) return null;
    if (!this.getTransporterCache) {
      this.getTransporterCache = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      });
    }
    return this.getTransporterCache;
  }

  async send(content: MailContent): Promise<{ sent: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(
        `SMTP not configured (or EMAILS_DISABLED) — logging email instead of sending to ${content.to}: ${content.subject}`,
      );
      this.logger.log(content.html);
      return { sent: false };
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER!,
      to: content.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return { sent: true };
  }
}
