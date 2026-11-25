import nodemailer from 'nodemailer';
import type { SmtpConfig } from './types.ts';

export interface EmailSendResult {
  sent: boolean;
  message: string;
  timestamp: string;
}

let lastAlertResult: EmailSendResult | null = null;

export function getEnvSmtpDefaults(): SmtpConfig {
  return {
    enabled: Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO),
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'chronodav@localhost',
    alertTo: process.env.ALERT_EMAIL_TO || '',
  };
}

export function getLastAlertResult(): EmailSendResult | null {
  return lastAlertResult;
}

export async function sendMailNotification(
  config: SmtpConfig,
  subject: string,
  textBody: string,
  htmlBody: string,
): Promise<EmailSendResult> {
  const now = new Date().toISOString();
  if (!config.enabled || !config.host || !config.alertTo) {
    lastAlertResult = {
      sent: false,
      message: 'SMTP-Benachrichtigung nicht konfiguriert (Host oder Empfänger fehlt).',
      timestamp: now,
    };
    return lastAlertResult;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: Number(config.port) || 587,
      secure: Boolean(config.secure),
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
    });

    await transporter.sendMail({
      from: config.from || 'chronodav@localhost',
      to: config.alertTo,
      subject,
      text: textBody,
      html: htmlBody,
    });

    lastAlertResult = {
      sent: true,
      message: `E-Mail erfolgreich an ${config.alertTo} gesendet.`,
      timestamp: now,
    };
    return lastAlertResult;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    lastAlertResult = {
      sent: false,
      message: `SMTP-Fehler: ${errMsg}`,
      timestamp: now,
    };
    return lastAlertResult;
  }
}

export async function sendDbFailoverAlert(config: SmtpConfig, reason: string): Promise<EmailSendResult> {
  const subject = '[ChronoDAV WARNUNG] MariaDB nicht erreichbar — Failover auf SQLite Backup aktiv';
  const text = [
    'Achtung DB nciht erreeichbar, es wird auf SQLITE ( Backup ) zugegriffen.',
    '',
    `Zeitpunkt: ${new Date().toISOString()}`,
    `Ursache: ${reason}`,
    '',
    'Alle Änderungen werden lokal im SQLite-Backup zwischengespeichert und automatisch mit dem MariaDB-Master synchronisiert, sobald die Verbindung wiederhergestellt ist.',
  ].join('\n');

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #dc2626; margin-top: 0;">Achtung: MariaDB-Verbindungsabbruch</h2>
      <p><strong>Achtung DB nciht erreeichbar, es wird auf SQLITE ( Backup ) zugegriffen</strong></p>
      <p style="color: #374151;">Zeitpunkt: ${new Date().toISOString()}<br/>Ursache: <code>${escapeHtml(reason)}</code></p>
      <p style="color: #4b5563; font-size: 14px;">ChronoDAV speichert alle Änderungen sicher in der SQLite-Backup-Datenbank und führt automatisch einen Master-Sync durch, sobald MariaDB wieder erreichbar ist.</p>
    </div>
  `;
  return sendMailNotification(config, subject, text, html);
}

export async function sendDbRecoveryAlert(config: SmtpConfig, syncedRecords: number): Promise<EmailSendResult> {
  const subject = '[ChronoDAV INFO] MariaDB wiederhergestellt — Master-Sync abgeschlossen';
  const text = [
    'Die Verbindung zum MariaDB-Master wurde wiederhergestellt.',
    `Zeitpunkt: ${new Date().toISOString()}`,
    `Synchronisierte Datensätze aus SQLite-Backup: ${syncedRecords}`,
  ].join('\n');

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #16a34a; margin-top: 0;">MariaDB-Verbindung wiederhergestellt</h2>
      <p>Die Verbindung zum MariaDB-Master ist wieder aktiv. Alle lokalen Backup-Änderungen wurden synchronisiert.</p>
      <p style="color: #374151;">Zeitpunkt: ${new Date().toISOString()}<br/>Synchronisierte Datensätze: <strong>${syncedRecords}</strong></p>
    </div>
  `;
  return sendMailNotification(config, subject, text, html);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
