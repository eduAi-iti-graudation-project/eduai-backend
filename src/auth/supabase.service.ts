import { Injectable, HttpStatus, Optional } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';
import type {
  AuthResponse,
  AuthTokenResponse,
  OAuthResponse,
  Provider,
  SupabaseClient,
} from '@supabase/supabase-js';
import * as crypto from 'node:crypto';

type Database = Record<string, never>;

export type OAuthProvider = 'google' | 'microsoft';

interface JwksKey {
  kty: string;
  kid: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  iss?: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_RETRY_BACKOFF_MS = 15_000;
const CLOCK_SKEW_S = 30;

function rawToDer(raw: Buffer): Buffer {
  if (raw.length !== 64) {
    throw new Error('Invalid ES256 signature length');
  }

  const derInt = (int: Buffer): Buffer => {
    let start = 0;
    while (start < int.length - 1 && int[start] === 0) start++;
    const body = int.subarray(start);
    const padded =
      body.length === 0 || (body[0] & 0x80) !== 0
        ? Buffer.concat([Buffer.from([0x00]), body])
        : body;
    return Buffer.concat([Buffer.from([0x02, padded.length]), padded]);
  };

  const r = derInt(raw.subarray(0, 32));
  const s = derInt(raw.subarray(32, 64));
  const seq = Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
  return seq;
}

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient<Database>;
  private jwksCache: { keys: JwksKey[]; fetchedAt: number } | null = null;
  private jwksFetch: Promise<JwksKey[]> | null = null;
  private jwksLastFailureAt: number | null = null;

  constructor(
    @Optional() private readonly jwksRetryBackoffMs = JWKS_RETRY_BACKOFF_MS,
  ) {
    this.client = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      {
        auth: {
          persistSession: false,
          flowType: 'pkce',
        },
      },
    );
  }

  getClient(): SupabaseClient<Database> {
    return this.client;
  }

  async signInWithOAuth(
    provider: OAuthProvider,
    redirectTo: string,
  ): Promise<OAuthResponse> {
    const supabaseProvider: Provider =
      provider === 'microsoft' ? 'azure' : provider;
    return this.client.auth.signInWithOAuth({
      provider: supabaseProvider,
      options: { redirectTo },
    });
  }

  async exchangeCodeForSession(authCode: string): Promise<AuthTokenResponse> {
    return this.client.auth.exchangeCodeForSession(authCode);
  }

  async refreshSession(refreshToken: string): Promise<AuthResponse> {
    return this.client.auth.refreshSession({ refresh_token: refreshToken });
  }

  async verifyToken(token: string): Promise<{ id: string }> {
    const payload = await this.verifyJwtLocally(token);
    return { id: payload.sub as string };
  }

  async signOut(authId: string): Promise<void> {
    const { error } = await this.client.auth.admin.signOut(authId);
    if (error) {
      throw new ApiError(
        ErrorCode.AUTH_LOGOUT_FAILED,
        HttpStatus.UNAUTHORIZED,
        'We could not sign you out. Please try again.',
        { cause: error },
      );
    }
  }

  private invalidToken(): ApiError {
    return new ApiError(
      ErrorCode.AUTH_TOKEN_INVALID,
      HttpStatus.UNAUTHORIZED,
      'Your session is no longer valid. Please log in again.',
      { hint: ErrorHint.RE_LOGIN },
    );
  }

  private async verifyJwtLocally(token: string): Promise<JwtPayload> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw this.invalidToken();
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    let header: JwtHeader;
    let payload: JwtPayload;
    try {
      header = JSON.parse(
        Buffer.from(headerB64, 'base64url').toString('utf8'),
      ) as JwtHeader;
      payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as JwtPayload;
    } catch {
      throw this.invalidToken();
    }

    if (header.alg !== 'RS256' && header.alg !== 'ES256') {
      throw this.invalidToken();
    }
    if (!header.kid) {
      throw this.invalidToken();
    }

    const keys = await this.fetchJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      throw this.invalidToken();
    }

    const signingInput = `${headerB64}.${payloadB64}`;
    const rawSignature = Buffer.from(signatureB64, 'base64url');

    let publicKey: crypto.KeyObject;
    let signature: Buffer;
    let hashAlg: string;
    try {
      if (jwk.kty === 'RSA' && header.alg === 'RS256' && jwk.n && jwk.e) {
        publicKey = crypto.createPublicKey({
          key: { kty: 'RSA', n: jwk.n, e: jwk.e },
          format: 'jwk',
        });
        signature = rawSignature;
        hashAlg = 'RSA-SHA256';
      } else if (
        jwk.kty === 'EC' &&
        header.alg === 'ES256' &&
        jwk.crv === 'P-256' &&
        jwk.x &&
        jwk.y
      ) {
        publicKey = crypto.createPublicKey({
          key: { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y },
          format: 'jwk',
        });
        signature = rawToDer(rawSignature);
        hashAlg = 'sha256';
      } else {
        throw new Error('Unsupported key type or algorithm');
      }
    } catch {
      throw this.invalidToken();
    }

    const signatureValid = crypto.verify(
      hashAlg,
      Buffer.from(signingInput),
      publicKey,
      signature,
    );
    if (!signatureValid) {
      throw this.invalidToken();
    }

    if (
      typeof payload.exp !== 'number' ||
      Date.now() / 1000 > payload.exp + CLOCK_SKEW_S
    ) {
      throw this.invalidToken();
    }

    const expectedIss = `${process.env.SUPABASE_URL}/auth/v1`;
    if (payload.iss !== expectedIss || !payload.sub) {
      throw this.invalidToken();
    }

    return payload;
  }

  private async fetchJwks(): Promise<JwksKey[]> {
    if (this.jwksCache && Date.now() - this.jwksCache.fetchedAt < JWKS_TTL_MS) {
      return this.jwksCache.keys;
    }

    if (
      this.jwksLastFailureAt &&
      Date.now() - this.jwksLastFailureAt < this.jwksRetryBackoffMs
    ) {
      throw new Error('Supabase JWKS unreachable');
    }

    if (!this.jwksFetch) {
      this.jwksFetch = this.loadJwks()
        .catch((err: unknown) => {
          this.jwksLastFailureAt = Date.now();
          throw err;
        })
        .finally(() => {
          this.jwksFetch = null;
        });
    }

    return this.jwksFetch;
  }

  private async loadJwks(): Promise<JwksKey[]> {
    const url = `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Supabase JWKS: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { keys?: JwksKey[] };
    if (!data.keys || data.keys.length === 0) {
      throw new Error('Supabase JWKS contained no keys');
    }

    this.jwksCache = { keys: data.keys, fetchedAt: Date.now() };
    return data.keys;
  }
}
