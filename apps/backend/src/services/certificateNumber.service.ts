import crypto from 'crypto';
import qrcode from 'qrcode';
import { config } from '../config/env';

/**
 * Generates a unique, predictable certificate number.
 * Format: CERT-YYYY-XXXXXXXX (e.g., CERT-2026-A1B2C3D4)
 * Does NOT use sensitive PII like student email or phone.
 */
export function generateCertificateNumber(year?: number): string {
  const certYear = year || new Date().getFullYear();
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `CERT-${certYear}-${randomHex}`;
}

/**
 * Generates a cryptographically secure random verification token.
 */
export function generateVerificationToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generates the public verification URL and corresponding QR Code image buffer.
 */
export async function generateCertificateQr(verificationToken: string): Promise<{ qrCodeUrl: string; qrCodeBuffer: Buffer }> {
  const qrCodeUrl = `${config.verificationBaseUrl}/${verificationToken}`;
  const qrCodeBuffer = await qrcode.toBuffer(qrCodeUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 140
  });

  return {
    qrCodeUrl,
    qrCodeBuffer
  };
}
