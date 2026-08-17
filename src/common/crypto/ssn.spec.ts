import { decryptSsn, encryptSsn, maskSsn, ssnTail4 } from './ssn';

process.env.TEACHER_SSN_ENCRYPTION_KEY = 'test-encryption-key-1234567890';

describe('ssn encryption helpers', () => {
  it('round-trips a plain SSN', () => {
    const encrypted = encryptSsn('123-45-6789');
    expect(encrypted).not.toContain('123-45-6789');
    expect(decryptSsn(encrypted)).toBe('123-45-6789');
  });

  it('produces a different ciphertext for the same input each time', () => {
    expect(encryptSsn('123-45-6789')).not.toBe(encryptSsn('123-45-6789'));
  });

  it('derives the tail 4 digits ignoring separators', () => {
    expect(ssnTail4('123-45-6789')).toBe('6789');
    expect(ssnTail4('123456789')).toBe('6789');
  });

  it('masks the SSN with only the tail visible', () => {
    const enc = encryptSsn('123-45-6789');
    expect(maskSsn(enc, ssnTail4('123-45-6789'))).toMatch(/●+6789$/);
    expect(maskSsn(null, null)).toBeNull();
  });

  it('throws when the key is missing', () => {
    const previous = process.env.TEACHER_SSN_ENCRYPTION_KEY;
    delete process.env.TEACHER_SSN_ENCRYPTION_KEY;
    expect(() => encryptSsn('123')).toThrow(/not configured/i);
    process.env.TEACHER_SSN_ENCRYPTION_KEY = previous;
  });
});
