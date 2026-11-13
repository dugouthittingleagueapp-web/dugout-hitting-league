import { describe, expect, it } from 'vitest';
import { explainSaveError, explainPitchSyncIssue } from '../../utils/friendlyErrors';

describe('Calm, easy-to-follow umpire messages', () => {
  const simpleWords = (message: string) => {
    expect(message).not.toMatch(/HTTP|409|428|Neon|database|Postgres|sync|JSON|cache|token|server revision|conflict/i);
    expect(message).toMatch(/keep this page|keep them|ask|please|try|check|sign in/i);
  };

  it('explains a sign-in problem with one next step', () => {
    const message = explainSaveError(new Error('HTTP 401 Unauthorized'), 'lineup');
    expect(message).toContain('sign in again');
    simpleWords(message);
  });
  it('explains permissions without technical terms', () => {
    const message = explainSaveError(new Error('Umpires may only add substitutes; permanent changes require an admin.'), 'substitute');
    expect(message).toContain('Ask');
    simpleWords(message);
  });
  it('does not advise reloading when a score might be local only', () => {
    const message = explainSaveError(new TypeError('Failed to fetch'), 'match');
    expect(message).toContain('Keep this page open');
    expect(message).not.toMatch(/refresh|reload/i);
    simpleWords(message);
  });
  it('says when a lineup change can be made safely', () => {
    const message = explainSaveError(new Error('cannot remove a batter who already has recorded pitches'), 'lineup');
    expect(message).toContain('next inning');
    simpleWords(message);
  });
  it('explains missing games without suggesting recreation', () => {
    const message = explainSaveError(new Error('Match not found'), 'match');
    expect(message).toContain('Do not create another game');
    simpleWords(message);
  });
  it('keeps raw technical messages in logs, not visible notices', () => {
    const message = explainSaveError(new Error('postgres column secret_token cannot parse abc'), 'stats');
    expect(message).not.toContain('secret_token');
    simpleWords(message);
  });
  it('shows a reassuring message when the device has unsent scores', () => {
    const message = explainSaveError(new Error('HTTP 409: Some pitches are only saved on this device.'), 'finalize');
    expect(message).toContain('scores are still waiting');
    expect(message).not.toMatch(/refresh|reload/i);
    simpleWords(message);
  });
  it('explains another-device changes without telling an umpire to erase local scores', () => {
    const message = explainSaveError(new Error('HTTP 409: Another device updated this pitch'), 'match');
    expect(message).toContain('not confirmed');
    expect(message).not.toMatch(/refresh|reload/i);
    simpleWords(message);
  });
  it('explains when another umpire holds scoring control', () => {
    const message = explainSaveError('HTTP 423 scoring_locked', 'match');
    expect(message).toContain('Another umpire');
    expect(message).toContain('not confirmed');
    simpleWords(message);
  });
  it('does not expose raw errors in the scoreboard banner', () => {
    for (const raw of ['HTTP 409: Another device changed this pitch', 'HTTP 500: database failure', 'Offline pitch backup is unreadable']) {
      const message = explainPitchSyncIssue(raw);
      simpleWords(message);
      expect(message).toContain('Keep this page open');
    }
  });
});
