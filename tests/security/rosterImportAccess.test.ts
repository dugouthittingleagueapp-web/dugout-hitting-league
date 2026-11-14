import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/parse-roster';
import { signSessionToken } from '../../api/auth';

const makeResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

describe('AI roster import security boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rejects anonymous requests before invoking Gemini or the fallback parser', async () => {
    const res = makeResponse();
    await handler({ method: 'POST', headers: {}, body: { text: 'Team 1: A B' } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects non-admin umpire sessions', async () => {
    vi.stubEnv('SESSION_SECRET', 'test-preview-only-umpire-signing-key-over-32-characters');
    const res = makeResponse();
    const token = signSessionToken('umpire');
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { text: 'Team 1: A B' } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects oversized uploads before any AI request', async () => {
    vi.stubEnv('SESSION_SECRET', 'test-preview-only-admin-signing-key-over-32-characters');
    const res = makeResponse();
    const token = signSessionToken('admin');
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { text: 'a'.repeat(100_001) } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(413);
  });
});
