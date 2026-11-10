import { describe, expect, it } from 'vitest';
import { setPitchScore, setTieBreakerPitchScore } from '../../utils/scorePatches';
import type { Match, Inning } from '../../types';

const createMatch = (): Match => ({
  id: 'game-perf',
  date: '2026-11-11',
  season: '2026',
  league: '9U 3v3',
  homeTeamId: 'home',
  awayTeamId: 'away',
  isComplete: false,
  is_practice: false,
  status: 'SCHEDULED',
  innings: Array.from({length: 6}, (_, i): Inning => ({
    number: i + 1,
    home: { teamId: 'home', playerScores: ['h1', 'h2', 'h3'].map(playerId => ({
      playerId,
      pitches: Array.from({length: 10}, () => ({points: null}))
    }))},
    away: { teamId: 'away', playerScores: ['a1', 'a2', 'a3'].map(playerId => ({
      playerId,
      pitches: Array.from({length: 10}, () => ({points: null}))
    }))}
  }))
});

describe('fast pitch-score patches', () => {
  it('changes only one pitch and retains unrelated references', () => {
    const match = createMatch();
    const updated = setPitchScore(match, 2, 'home', 1, 4, 2);
    expect(updated.innings[2].home.playerScores[1].pitches[4].points).toBe(2);
    expect(updated.status).toBe('IN_PROGRESS');
    expect(match.innings[2].home.playerScores[1].pitches[4].points).toBeNull();
    expect(updated.innings[0]).toBe(match.innings[0]);
    expect(updated.innings[2].away).toBe(match.innings[2].away);
    expect(updated.innings[2].home.playerScores[0]).toBe(match.innings[2].home.playerScores[0]);
    expect(updated.innings[2].home.playerScores[1].pitches[3]).toBe(match.innings[2].home.playerScores[1].pitches[3]);
  });

  it('supports zeroes, edits, and undo without erasing neighboring pitches', () => {
    const original = createMatch();
    const scored = setPitchScore(original, 0, 'away', 0, 0, 0);
    const edited = setPitchScore(scored, 0, 'away', 0, 0, 4);
    const withSecond = setPitchScore(edited, 0, 'away', 0, 1, 3);
    const undone = setPitchScore(withSecond, 0, 'away', 0, 1, null);
    expect(scored.innings[0].away.playerScores[0].pitches[0].points).toBe(0);
    expect(edited.innings[0].away.playerScores[0].pitches[0].points).toBe(4);
    expect(undone.innings[0].away.playerScores[0].pitches[0].points).toBe(4);
    expect(undone.innings[0].away.playerScores[0].pitches[1].points).toBeNull();
  });

  it('avoids an unnecessary state update when a score is unchanged or out of range', () => {
    const match = createMatch();
    expect(setPitchScore(match, 0, 'home', 0, 0, null)).toBe(match);
    expect(setPitchScore(match, 50, 'home', 0, 0, 2)).toBe(match);
    expect(setPitchScore(match, 0, 'home', 0, 60, 2)).toBe(match);
  });

  it.each([0, 1, 2, 3, 4])('records score %i through the same regular pitching path', points => {
    const match = createMatch();
    const updated = setPitchScore(match, 3, 'away', 2, 5, points);
    expect(updated.innings[3].away.playerScores[2].pitches[5].points).toBe(points);
    expect(updated.innings[3].away.playerScores[2].pitches[4].points).toBeNull();
    expect(updated.innings[1]).toBe(match.innings[1]);
  });

  it.each([0, 1, 2, 3, 4])('records score %i through the same tie-breaker pitching path', points => {
    const match = createMatch();
    match.tieBreaker = [{
      roundNumber: 1, pitchLimit: 5, homePlayerId: 'h1', awayPlayerId: 'a1',
      homeScores: [null, null, null, null, null],
      awayScores: [null, null, null, null, null]
    }];
    const updated = setTieBreakerPitchScore(match, 0, 'home', 1, points);
    expect(updated.tieBreaker?.[0].homeScores[1]).toBe(points);
    expect(updated.tieBreaker?.[0].awayScores).toBe(match.tieBreaker[0].awayScores);
    expect(updated.innings).toBe(match.innings);
    expect(match.tieBreaker[0].homeScores[1]).toBeNull();
  });

  it('edits or undoes a tie-breaker pitch without touching other rounds', () => {
    const match = createMatch();
    match.tieBreaker = [
      { roundNumber: 1, pitchLimit: 3, homePlayerId: 'h1', awayPlayerId: 'a1',
        homeScores: [null, null, null], awayScores: [null, null, null] },
      { roundNumber: 2, pitchLimit: 1, homePlayerId: 'h2', awayPlayerId: 'a2',
        homeScores: [null], awayScores: [null] }
    ];
    const scored = setTieBreakerPitchScore(match, 0, 'away', 0, 2);
    const edited = setTieBreakerPitchScore(scored, 0, 'away', 0, 4);
    const undone = setTieBreakerPitchScore(edited, 0, 'away', 0, null);
    expect(undone.tieBreaker?.[0].awayScores[0]).toBeNull();
    expect(edited.tieBreaker?.[0].awayScores[0]).toBe(4);
    expect(scored.tieBreaker?.[0].awayScores[0]).toBe(2);
    expect(undone.tieBreaker?.[1]).toBe(match.tieBreaker[1]);
    expect(setTieBreakerPitchScore(match, 5, 'home', 0, 2)).toBe(match);
    expect(setTieBreakerPitchScore(match, 0, 'home', 50, 2)).toBe(match);
  });

  it('does not change completion status of a previously finalized game', () => {
    const match = {...createMatch(), isComplete: true, status: 'FINAL' as const};
    const updated = setPitchScore(match, 0, 'home', 0, 0, 2);
    expect(updated.isComplete).toBe(true);
    expect(updated.status).toBe('FINAL');
  });
});
