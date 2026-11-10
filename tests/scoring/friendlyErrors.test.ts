import { describe, expect, it } from 'vitest';
import { explainSaveError } from '../../utils/friendlyErrors';

describe('Plain-English game save errors', () => {
  it('explains expired login and what to do', () => {
    const text = explainSaveError(new Error('HTTP 401 Unauthorized'), 'lineup');
    expect(text).toContain('login');
    expect(text).toContain('Sign in again');
    expect(text).toContain('not saved');
  });
  it('explains forbidden substitutions without exposing technical errors', () => {
    const text = explainSaveError(new Error('Umpires may only add substitutes; permanent changes require an admin.'), 'substitute');
    expect(text).toContain('permission');
    expect(text).toContain('admin');
    expect(text).not.toContain('HTTP');
  });
  it('guides recovery after a network interruption', () => {
    const text = explainSaveError(new TypeError('Failed to fetch'), 'finalize');
    expect(text).toContain('connection');
    expect(text).toContain('Refresh');
    expect(text).toContain('before entering a score twice');
  });
  it('protects scored pitches when changing a lineup', () => {
    const text = explainSaveError(new Error('Inning 2: cannot remove a batter who already has recorded pitches'), 'lineup');
    expect(text).toContain('pitches');
    expect(text).toContain('next inning');
    expect(text).toContain('safe');
  });
  it('explains missing games without suggesting recreation', () => {
    const text = explainSaveError(new Error('Match not found; no scoring data was saved.'), 'match');
    expect(text).toContain('dashboard');
    expect(text).toContain('Do not recreate');
  });
  it('never exposes unknown technical internals', () => {
    const text = explainSaveError(new Error('postgres column secret_token cannot parse value abc'), 'stats');
    expect(text).not.toContain('secret_token');
    expect(text).toContain('game server');
    expect(text).not.toContain('Neon');
  });
});
