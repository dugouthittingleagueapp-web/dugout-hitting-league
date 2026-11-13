import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword, updateAdminPassword, updateUmpirePassword } from '../../services/storageService';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('Server-only login verification', () => {
  let local: ReturnType<typeof memoryStorage>;
  let session: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    local = memoryStorage({
      dugout_cached_admin_pw: 'admin',
      dugout_cached_umpire_pw: 'umpire',
      dugout_pending_sync_matches: '{"game-1":{"id":"game-1"}}',
      dugout_active_match_id: 'game-1',
    });
    session = memoryStorage();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('does not grant admin or umpire access using cached/default passwords while offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await verifyPassword('admin')).success).toBe(false);
    expect((await verifyPassword('umpire')).success).toBe(false);
    expect(local.getItem('dugout_cached_admin_pw')).toBeNull();
    expect(local.getItem('dugout_cached_umpire_pw')).toBeNull();
    expect(local.getItem('dugout_pending_sync_matches')).toBe('{"game-1":{"id":"game-1"}}');
    expect(local.getItem('dugout_active_match_id')).toBe('game-1');
  });

  it('requires a server-issued token before granting a role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, role: 'admin',
    }), { status: 200 })));
    expect((await verifyPassword('correct-password')).success).toBe(false);
    expect(local.getItem('dugout_auth_token')).toBeNull();
  });

  it('accepts a real verified server login and retains its session token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, role: 'umpire', token: 'server-issued-token',
    }), { status: 200 })));
    expect(await verifyPassword('correct-password')).toEqual({ success: true, role: 'umpire' });
    expect(local.getItem('dugout_auth_token')).toBe('server-issued-token');
    expect(session.getItem('dugout_auth_token')).toBe('server-issued-token');
  });

  it('gives an understandable message on server failure without granting access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const result = await verifyPassword('admin');
    expect(result.success).toBe(false);
    expect(result.error).toContain('temporarily unavailable');
  });

  it('does not cache newly changed passwords, including after a successful update', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"success":true}', { status: 200 })));
    await updateAdminPassword('new-secret-admin');
    await updateUmpirePassword('new-secret-umpire');
    expect(local.getItem('dugout_cached_admin_pw')).toBeNull();
    expect(local.getItem('dugout_cached_umpire_pw')).toBeNull();
    expect(local.getItem('dugout_pending_sync_matches')).not.toBeNull();
  });
});
