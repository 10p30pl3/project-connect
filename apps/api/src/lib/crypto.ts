import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const KEY_ENV = process.env.TOKEN_ENCRYPTION_KEY?.trim() || config.jwtSecret;
const ENC_PREFIX = 'v1:';

function deriveKey(secret = KEY_ENV): Buffer {
  return createHash('sha256').update(`voll-plan-aes256:${secret}`).digest();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeTokenCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function encryptSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(ENC_PREFIX)) return trimmed;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload || typeof payload !== 'string') return '';
  const trimmed = payload.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith(ENC_PREFIX)) return trimmed;

  const parts = trimmed.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return '';
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 10) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}
