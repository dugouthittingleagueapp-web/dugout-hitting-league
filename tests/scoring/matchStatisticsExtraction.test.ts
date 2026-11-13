import { describe, expect, it } from 'vitest';
import type { Match, Team } from '../../types';
import { calculateMatchStats as pureCalculate } from '../../utils/matchStatistics';
import { calculateMatchStats as serviceCalculate } from '../../services/storageService';

const home: Team = {
  id: 'home', name: 'Home', league: '11U', season: '2026',
  players: [{ id: 'h1', name: 'Ada', lastName: 'Jones' }, { id: 'h2', name: 'Bea' }],
  subs: [{ id: 'hs', name: 'Cal', lastName: 'Smith' }],
};
const away: Team = {
  id: 'away', name: 'Away', league: '11U', season: '2026',
  players: [{ id: 'a1', name: 'Dee', lastName: 'West' }],
};
const pitches = (values: (number | null)[]) => values.map(points => ({ points }));
const game = (options: Partial<Match> = {}): Match => ({
  id: 'stats-game', league: '11U', season: '2026', date: '2026-11-11',
  homeTeamId: 'home', awayTeamId: 'away', isComplete: true, is_practice: false, status: 'FINAL',
  innings: [{
    number: 1,
    home: { teamId: 'home', playerScores: [
      { playerId: 'h1', pitches: pitches([4, 0, null, 2]) },
      { playerId: 'hs', pitches: pitches([3, 1]) },
    ] },
    away: { teamId: 'away', playerScores: [
      { playerId: 'a1', pitches: pitches([1, 2]) },
    ] },
  }],
  ...options,
});

describe('Extracted per-game statistics parity', () => {
  it('preserves the public storage API and the original scores, hits, names and null-pitch rules', () => {
    expect(serviceCalculate).toBe(pureCalculate);
    const result = pureCalculate(game(), home, away);
    expect(result.find(p => p.playerId === 'h1')).toMatchObject({
      name: 'Ada J.', totalPoints: 6, hits4: 1, hits2: 1, pitchesSeen: 3,
    });
    expect(result.find(p => p.playerId === 'hs')).toMatchObject({
      name: 'Cal S.', totalPoints: 4, hits3: 1, hits1: 1, pitchesSeen: 2,
    });
    expect(result.find(p => p.playerId === 'a1')?.totalPoints).toBe(3);
  });

  it('keeps ghost pitches 11-15 out of each human player’s statistics', () => {
    const ghostGame = game({ innings: [{
      number: 1,
      home: { teamId: 'home', playerScores: [
        { playerId: 'h1', pitches: pitches([...Array(10).fill(1), ...Array(5).fill(4)]) },
        { playerId: 'h2', pitches: pitches([...Array(10).fill(2), ...Array(5).fill(4)]) },
      ] },
      away: { teamId: 'away', playerScores: [] },
    }] });
    const result = pureCalculate(ghostGame, home, away);
    expect(result.find(p => p.playerId === 'h1')?.totalPoints).toBe(10);
    expect(result.find(p => p.playerId === 'h2')?.totalPoints).toBe(20);
    expect(result.some(p => p.playerId.startsWith('ghost-'))).toBe(false);
  });

  it('retains tie-breaker pitch scoring for rostered and substitute players', () => {
    const result = pureCalculate(game({
      tieBreaker: [{
        roundNumber: 1, pitchLimit: 3, homePlayerId: 'hs', awayPlayerId: 'a1',
        homeScores: [4, null, 2], awayScores: [1, 3, 0],
      }],
    }), home, away);
    expect(result.find(p => p.playerId === 'hs')).toMatchObject({
      totalPoints: 10, pitchesSeen: 4, hits4: 1,
    });
    expect(result.find(p => p.playerId === 'a1')).toMatchObject({
      totalPoints: 7, pitchesSeen: 5,
    });
  });

  it('leaves input matches unchanged', () => {
    const match = game();
    const before = JSON.stringify(match);
    pureCalculate(match, home, away);
    expect(JSON.stringify(match)).toBe(before);
  });
});
