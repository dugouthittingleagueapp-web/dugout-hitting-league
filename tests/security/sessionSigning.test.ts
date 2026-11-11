import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthFromRequest, signSessionToken, verifySessionToken } from '../../api/auth';

describe('Session signing key configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to issue signed admin sessions when no secret is configured', () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('ADMIN_SECRET', 'legacy-fallback-must-not-be-used');
    expect(() => signSessionToken('admin')).toThrow(/SESSION_SECRET/);
  });

  it('rejects all tokens when signing secret is missing or too short', () => {
    vi.stubEnv('SESSION_SECRET', 'a-private-preview-signing-secret-over-32-chars');
    const token = signSessionToken('umpire');
    vi.stubEnv('SESSION_SECRET', '');
    expect(verifySessionToken(token)).toEqual({ valid: false });
    expect(getAuthFromRequest({ headers: { authorization: `Bearer ${token}` } }).authenticated).toBe(false);
    vi.stubEnv('SESSION_SECRET', 'short');
    expect(verifySessionToken(token).valid).toBe(false);
  });

  it('accepts signatures only for the current private key', () => {
    vi.stubEnv('SESSION_SECRET', 'a-private-preview-signing-secret-over-32-chars');
    const token = signSessionToken('admin');
    expect(verifySessionToken(token)).toEqual({ valid: true, role: 'admin' });
    vi.stubEnv('SESSION_SECRET', 'another-strong-preview-signing-secret-over-32-chars');
    expect(verifySessionToken(token).valid).toBe(false);
  });

  it('rejects a forged role, even if it is validly signed', () => {
    vi.stubEnv('SESSION_SECRET', 'a-private-preview-signing-secret-over-32-chars');
    const token = signSessionToken('umpire');
    const [payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() / 1000 + 3600 })).toString('base64url');
    expect(verifySessionToken(`${forgedPayload}.${signature}`).valid).toBe(false);
    expect(verifySessionToken(`${payload}.${signature}`).role).toBe('umpire');
  });
});
