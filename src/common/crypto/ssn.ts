import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { ApiError } from '../errors/api-error';
import { ErrorCode } from '../errors/codes';
import { HttpStatus } from '@nestjs/common';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = process.env.TEACHER_SSN_ENCRYPTION_KEY;
  if (!raw) {
    throw new ApiError(
      ErrorCode.SSN_ENCRYPTION_NOT_CONFIGURED,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Teacher SSN encryption is not configured on this server.',
    );
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptSsn(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSsn(encrypted: string): string {
  const [ivB64, tagB64, dataB64] = encrypted.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new ApiError(
      ErrorCode.SSN_INVALID,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Stored SSN data is corrupt.',
    );
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

export function ssnTail4(plain: string): string {
  const digits = plain.replace(/\D/g, '');
  return digits.slice(-4);
}

export function maskSsn(
  encrypted: string | null,
  tail4: string | null,
): string | null {
  if (!encrypted || !tail4) return null;
  return `●●●●●●●${tail4}`;
}
