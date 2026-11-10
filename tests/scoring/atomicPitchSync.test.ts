import { describe, it, expect } from 'vitest';
import type { Match } from '../../types';
import { applyPitchEdit, validatePitchEdit, type PitchEdit } from '../../utils/pitchSync';

const fixture = (): Match => ({
  id: 'game-1', league: 'A', season: '2026', date: '2026-11-11',
  homeTeamId: 'home', awayTeamId: 'away', isComplete: false, status: 'IN_PROGRESS',
  is_practice: false,
  innings: Array.from({ length: 6 }, (_, index) => ({
    number: index + 1,
    home: { teamId: 'home', playerScores: [
      { playerId: 'h1', pitches: Array.from({ length: 10 }, () => ({ points: null })) },
      { playerId: 'h2', pitches: Array.from({ length: 10 }, () => ({ points: null })) }
    ]},
    away: { teamId: 'away', playerScores: [
      { playerId: 'a1', pitches: Array.from({ length: 10 }, () => ({ points: null })) },
      { playerId: 'a2', pitches: Array.from({ length: 10 }, () => ({ points: null })) }
    ]}
  })),
  tieBreaker: [{ roundNumber: 1, pitchLimit: 3, homePlayerId: 'h1', awayPlayerId: 'a1',
    homeScores: [null, null, null], awayScores: [null, null, null] }]
});

const edit = (overrides: Partial<PitchEdit> = {}): PitchEdit => ({
  id: 'game-1', side: 'home', inningIdx: 0, lineupIdx: 0,
  playerId: 'h1', pitchIdx: 0, expectedPoints: null, points: 2,
  ...overrides
});

describe('atomic pitch synchronization preconditions', () => {
  it('accepts every legitimate score 0-4 and never mutates existing match records', () => {
    for (const points of [0,1,2,3,4]) {
      const source = fixture();
      const applied = applyPitchEdit(source, edit({ points }), false);
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(applied.updated.innings[0].home.playerScores[0].pitches[0].points).toBe(points);
        expect(source.innings[0].home.playerScores[0].pitches[0].points).toBe(null);
      }
    }
  });

  it('keeps simultaneous edits to different pitches, including edits by another device', () => {
    const first = applyPitchEdit(fixture(), edit(), false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const otherDevice = applyPitchEdit(first.updated, edit({
      side: 'away', lineupIdx: 1, playerId: 'a2', pitchIdx: 7, points: 4
    }), false);
    expect(otherDevice.ok).toBe(true);
    if (!otherDevice.ok) return;
    expect(otherDevice.updated.innings[0].home.playerScores[0].pitches[0].points).toBe(2);
    expect(otherDevice.updated.innings[0].away.playerScores[1].pitches[7].points).toBe(4);
  });

  it('rejects a second umpire replacing a score on the same pitch', () => {
    const first = applyPitchEdit(fixture(), edit({ points: 3 }), false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyPitchEdit(first.updated, edit({ expectedPoints: null, points: 4 }), false);
    expect(second).toMatchObject({ ok: false, conflict: true });
    expect(first.updated.innings[0].home.playerScores[0].pitches[0].points).toBe(3);
  });

  it('accepts retry after response is lost, without applying changes twice', () => {
    const first = applyPitchEdit(fixture(), edit({ points: 0 }), false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const retry = applyPitchEdit(first.updated, edit({ points: 0 }), false);
    expect(retry).toMatchObject({ ok: true, alreadyApplied: true });
  });

  it('rejects stale lineup assignments and nonexistent pitches', () => {
    expect(applyPitchEdit(fixture(), edit({ playerId: 'unknown' }), false)).toMatchObject({ ok: false, conflict: true });
    expect(applyPitchEdit(fixture(), edit({ pitchIdx: 13 }), false)).toMatchObject({ ok: false, conflict: true });
    expect(validatePitchEdit(edit({ points: 5 }))).toBeTruthy();
  });

  it('protects completed games from umpires and allows admin corrections', () => {
    const completed = { ...fixture(), isComplete: true, status: 'FINAL' as const };
    expect(applyPitchEdit(completed, edit(), false)).toMatchObject({ ok: false, conflict: true });
    const result = applyPitchEdit(completed, edit(), true);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.updated.status).toBe('FINAL');
  });

  it('applies tie-breaker edits and safe undo without touching innings', () => {
    const first = applyPitchEdit(fixture(), edit({
      inningIdx: undefined, lineupIdx: undefined, roundIdx: 0,
      side: 'away', playerId: 'a1', pitchIdx: 1, points: 4
    }), false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.updated.tieBreaker?.[0].awayScores[1]).toBe(4);
    expect(first.updated.innings).toBeDefined();
    const undone = applyPitchEdit(first.updated, edit({
      inningIdx: undefined, lineupIdx: undefined, roundIdx: 0,
      side: 'away', playerId: 'a1', pitchIdx: 1, expectedPoints: 4, points: null
    }), false);
    expect(undone).toMatchObject({ ok: true });
    if (undone.ok) expect(undone.updated.tieBreaker?.[0].awayScores[1]).toBe(null);
  });
});
