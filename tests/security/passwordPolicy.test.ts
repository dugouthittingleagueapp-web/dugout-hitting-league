import { describe, expect, it } from 'vitest';
import { configuredLoginCredential, requiredInitialPassword } from '../../server/passwordPolicy';

describe('server login credentials', () => {
  it('never accepts public default passwords when neither database nor environment is configured', () => {
    expect(configuredLoginCredential(null, undefined)).toBeNull();
    expect(configuredLoginCredential('', '')).toBeNull();
    expect(configuredLoginCredential('  ', undefined)).toBeNull();
  });

  it('preserves existing stored credentials rather than replacing them with recovery environment values', () => {
    expect(configuredLoginCredential('existing-bcrypt-hash', 'different-env-password')).toBe('existing-bcrypt-hash');
    expect(configuredLoginCredential('legacy-explicit-password', undefined)).toBe('legacy-explicit-password');
  });

  it('allows an explicitly configured recovery credential if no database password exists', () => {
    expect(configuredLoginCredential(null, 'recovery-password')).toBe('recovery-password');
  });

  it('requires explicit initial credentials for both roles on new database setup', () => {
    expect(() => requiredInitialPassword('admin', undefined)).toThrow(/ADMIN_PASSWORD/);
    expect(() => requiredInitialPassword('umpire', '')).toThrow(/UMPIRE_PASSWORD/);
    expect(requiredInitialPassword('admin', 'set-from-deployment')).toBe('set-from-deployment');
    expect(requiredInitialPassword('umpire', 'set-for-umpire')).toBe('set-for-umpire');
  });
});
