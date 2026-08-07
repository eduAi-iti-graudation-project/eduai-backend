import * as crypto from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { ApiError } from '../common/errors/api-error';
import { SupabaseService } from './supabase.service';

const PROJECT_URL = 'https://test-project.supabase.co';
const KID = 'test-key-1';
const JWKS_URL = `${PROJECT_URL}/auth/v1/.well-known/jwks.json`;

const KEYPAIR = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER_KEYPAIR = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const EC_KEYPAIR = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});

function validPayload(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-123',
    exp: now + 3600,
    iat: now - 60,
    iss: `${PROJECT_URL}/auth/v1`,
    aud: 'authenticated',
  };
}

function createJwt(
  payload: Record<string, unknown>,
  privateKey: KeyObject = KEYPAIR.privateKey,
  header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
): string {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

function derToRaw(der: Buffer): Buffer {
  let off = 0;
  const next = (): number => der[off++];
  const expectByte = (v: number): void => {
    if (next() !== v) throw new Error('Bad DER');
  };

  expectByte(0x30);
  next();
  expectByte(0x02);
  const rLen = next();
  const rRaw = der.subarray(off, off + rLen);
  off += rLen;
  expectByte(0x02);
  const sLen = next();
  const sRaw = der.subarray(off, off + sLen);

  const strip = (b: Buffer): Buffer =>
    b.length === 33 && b[0] === 0 ? b.subarray(1) : b;
  const pad = (b: Buffer): Buffer =>
    b.length < 32 ? Buffer.concat([Buffer.alloc(32 - b.length), b]) : b;

  return Buffer.concat([pad(strip(rRaw)), pad(strip(sRaw))]);
}

function createEs256Jwt(payload: Record<string, unknown>, kid: string): string {
  const enc = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = { alg: 'ES256', kid, typ: 'JWT' };
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const derSig = crypto.sign(
    'sha256',
    Buffer.from(signingInput),
    EC_KEYPAIR.privateKey,
  );
  const signature = derToRaw(derSig).toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('SupabaseService', () => {
  let service: SupabaseService;
  let fetchMock: jest.Mock;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_KEY;

  beforeEach(() => {
    const exported = KEYPAIR.publicKey.export({
      format: 'jwk',
    }) as Record<string, unknown>;
    const jwk = { ...exported, kid: KID };

    process.env.SUPABASE_URL = PROJECT_URL;
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

    fetchMock = jest.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({ keys: [jwk] }),
    });
    global.fetch = fetchMock;

    service = new SupabaseService();
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_KEY = originalKey;
    }
    fetchMock.mockReset();
  });

  it('should verify a valid token locally', async () => {
    const result = await service.verifyToken(createJwt(validPayload()));

    expect(result.id).toBe('user-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(JWKS_URL);
  });

  it('should cache JWKS across multiple verifications', async () => {
    await service.verifyToken(createJwt(validPayload()));
    await service.verifyToken(createJwt(validPayload()));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should share a single JWKS fetch across concurrent verifications', async () => {
    await Promise.all([
      service.verifyToken(createJwt(validPayload())),
      service.verifyToken(createJwt(validPayload())),
      service.verifyToken(createJwt(validPayload())),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should reject an expired token', async () => {
    const expired = {
      ...validPayload(),
      exp: Math.floor(Date.now() / 1000) - 60,
    };

    await expect(service.verifyToken(createJwt(expired))).rejects.toThrow(
      ApiError,
    );
  });

  it('should reject a tampered signature', async () => {
    const token = createJwt(validPayload());
    const [header, payload] = token.split('.');
    const tampered = `${header}.${payload}.${Buffer.from('AAAA').toString(
      'base64url',
    )}`;

    await expect(service.verifyToken(tampered)).rejects.toThrow(ApiError);
  });

  it('should reject a token signed by a different key', async () => {
    const token = createJwt(validPayload(), OTHER_KEYPAIR.privateKey);

    await expect(service.verifyToken(token)).rejects.toThrow(ApiError);
  });

  it('should reject an unknown kid', async () => {
    const token = createJwt(validPayload(), KEYPAIR.privateKey, {
      alg: 'RS256',
      kid: 'unknown-key',
    });

    await expect(service.verifyToken(token)).rejects.toThrow(ApiError);
  });

  it('should reject alg none', async () => {
    const token = createJwt(validPayload(), KEYPAIR.privateKey, {
      alg: 'none',
      kid: KID,
    });

    await expect(service.verifyToken(token)).rejects.toThrow(ApiError);
  });

  it('should verify an ES256 token signed with a P-256 key', async () => {
    const ecJwk = {
      ...(EC_KEYPAIR.publicKey.export({
        format: 'jwk',
      }) as Record<string, unknown>),
      kid: 'ec-key-1',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({ keys: [ecJwk] }),
    });

    const result = await service.verifyToken(
      createEs256Jwt(validPayload(), 'ec-key-1'),
    );
    expect(result.id).toBe('user-123');
  });

  it('should reject an ES256 token when the JWKS only has RSA keys', async () => {
    await expect(
      service.verifyToken(createEs256Jwt(validPayload(), 'ec-key-1')),
    ).rejects.toThrow(ApiError);
  });

  it('should reject an RS256 token when the JWKS only has EC keys', async () => {
    const ecJwk = {
      ...(EC_KEYPAIR.publicKey.export({
        format: 'jwk',
      }) as Record<string, unknown>),
      kid: 'ec-key-1',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({ keys: [ecJwk] }),
    });

    const token = createJwt(validPayload(), KEYPAIR.privateKey, {
      alg: 'RS256',
      kid: 'ec-key-1',
    });

    await expect(service.verifyToken(token)).rejects.toThrow(ApiError);
  });

  it('should reject an ES256 token with a tampered signature', async () => {
    const ecJwk = {
      ...(EC_KEYPAIR.publicKey.export({
        format: 'jwk',
      }) as Record<string, unknown>),
      kid: 'ec-key-1',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({ keys: [ecJwk] }),
    });

    const token = createEs256Jwt(validPayload(), 'ec-key-1');
    const [header, payload] = token.split('.');
    const tampered = `${header}.${payload}.${Buffer.from('AAAA').toString(
      'base64url',
    )}`;

    await expect(service.verifyToken(tampered)).rejects.toThrow(ApiError);
  });

  it('should reject malformed tokens', async () => {
    await expect(service.verifyToken('not-a-jwt')).rejects.toThrow(ApiError);
    await expect(service.verifyToken('a.b')).rejects.toThrow(ApiError);
    await expect(service.verifyToken('!!!.!!!.!!!')).rejects.toThrow(ApiError);
  });

  it('should reject a token with a wrong issuer', async () => {
    const wrongIss = {
      ...validPayload(),
      iss: 'https://evil-project.supabase.co/auth/v1',
    };

    await expect(service.verifyToken(createJwt(wrongIss))).rejects.toThrow(
      ApiError,
    );
  });

  it('should retry the JWKS fetch on the next request after a failure', async () => {
    const noBackoffService = new SupabaseService(0);
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      noBackoffService.verifyToken(createJwt(validPayload())),
    ).rejects.toThrow('network down');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => ({
        keys: [{ ...KEYPAIR.publicKey.export({ format: 'jwk' }), kid: KID }],
      }),
    });

    const result = await noBackoffService.verifyToken(
      createJwt(validPayload()),
    );
    expect(result.id).toBe('user-123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should fail fast within the backoff window after a JWKS failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      service.verifyToken(createJwt(validPayload())),
    ).rejects.toThrow('network down');

    await expect(
      service.verifyToken(createJwt(validPayload())),
    ).rejects.toThrow('Supabase JWKS unreachable');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
