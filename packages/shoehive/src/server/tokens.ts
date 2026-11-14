// Resume tokens (ADR 0010): v1.<base64url(payload)>.<base64url(HMAC-SHA256)>.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface TokenPayload {
  sub: string;
  name: string;
  iat: number;
  exp: number;
  kid: string;
}

const b64 = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

export class TokenSigner {
  private readonly keys: { kid: string; key: Buffer }[];

  constructor(secrets: readonly string[]) {
    if (secrets.length === 0) throw new Error('At least one secret is required');
    this.keys = secrets.map((secret) => {
      const key = Buffer.from(secret, 'utf8');
      if (key.length < 32) throw new Error('Shoehive secrets must be at least 32 bytes');
      return { kid: createHash('sha256').update(key).digest('base64url').slice(0, 8), key };
    });
  }

  sign(payload: Omit<TokenPayload, 'kid'>): string {
    const { kid, key } = this.keys[0]!;
    const body = `v1.${b64(JSON.stringify({ ...payload, kid }))}`;
    return `${body}.${b64(createHmac('sha256', key).update(body).digest())}`;
  }

  /** The payload of a valid, unexpired token, or `null`. Never throws. */
  verify(token: string, now: number): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      return null;
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      typeof payload.kid !== 'string'
    )
      return null;
    const key = this.keys.find((k) => k.kid === payload.kid);
    if (!key) return null;
    const expected = createHmac('sha256', key.key).update(`v1.${parts[1]!}`).digest();
    const given = Buffer.from(parts[2]!, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (payload.exp <= now) return null;
    return payload;
  }
}

/** A random secret for development (tokens will not survive a restart). */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** A guest id: `g_` plus 128 random bits (ADR 0010). */
export function guestId(): string {
  return `g_${randomBytes(16).toString('base64url')}`;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function guestName(): string {
  const bytes = randomBytes(4);
  return `Guest ${Array.from(bytes, (b) => BASE32[b % 32]!).join('')}`;
}
