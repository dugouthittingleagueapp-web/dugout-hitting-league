import { describe, it, expect } from 'vitest';
import { validateScoreState, assertSafeSnapshotTransition, validateScoringFlags } from '../../server/scoringValidation';
import { applyPitchCommand } from '../../utils/scoringProtocol';
import { scoringFixture } from './scoringFixtures';

describe('Server scoring payload validation', () => {
  it.each([[3, 3], [2, 3], [3, 2], [2, 2]])('preserves supported %iv%i allocations', (h, a) => {
    const { game, home, away } = scoringFixture(h, a);
    expect(() => validateScoreState(game, home, away)).not.toThrow();
    game.innings[0].home.playerScores[0].playerId = 'hsub';
    expect(() => validateScoreState(game, home, away)).not.toThrow();
  });
  it.each([99, -1, 0.5, '4', undefined, false, {}, []])('rejects invalid pitch %j', value => {
    const { game, home, away } = scoringFixture();
    game.innings[0].home.playerScores[0].pitches[0].points = value as any;
    expect(() => validateScoreState(game, home, away)).toThrow();
  });
  it.each(['empty', 'missing', 'duplicate', 'foreign', 'truncated', 'wrong-team'])('rejects %s game structures', mode => {
    const { game, home, away } = scoringFixture();
    if (mode === 'empty') game.innings = [];
    if (mode === 'missing') (game.innings[0] as any).home = null;
    if (mode === 'duplicate') game.innings[0].home.playerScores[1].playerId = 'h1';
    if (mode === 'foreign') game.innings[0].home.playerScores[0].playerId = 'a1';
    if (mode === 'truncated') game.innings[0].home.playerScores[0].pitches.pop();
    if (mode === 'wrong-team') game.innings[0].home.teamId = 'garbage';
    expect(() => validateScoreState(game, home, away)).toThrow();
  });
  it('protects recorded zeroes as well as positive results from snapshot deletion', () => {
    const { game } = scoringFixture(); game.innings[0].home.playerScores[0].pitches[0].points = 0;
    const after = JSON.parse(JSON.stringify(game)); after.innings[0].home.playerScores[0].pitches[0].points = null;
    expect(() => assertSafeSnapshotTransition(game, after, undefined, 'admin')).toThrow(/replace recorded pitches/);
  });
  it('protects extras when a full snapshot tries to omit or clear them', () => {
    const { game } = scoringFixture();
    game.tieBreaker = [{ roundNumber: 1, pitchLimit: 5, homePlayerId: 'h1', awayPlayerId: 'a1', homeScores: [0, 4, null, null, null], awayScores: [null, null, null, null, null] }];
    expect(() => assertSafeSnapshotTransition(game, { ...game, tieBreaker: undefined }, undefined, 'admin')).toThrow();
    expect(() => assertSafeSnapshotTransition(game, { ...game, tieBreaker: [] }, undefined, 'admin')).toThrow();
  });
  it('allows intentional pitch edits/undo only through a compare-and-set command', () => {
    const { game } = scoringFixture(); game.innings[0].home.playerScores[0].pitches[0].points = 4;
    const command = { kind: 'pitch' as const, inning: 1, side: 'home' as const, playerId: 'h1', pitchIndex: 0, expected: 4, points: null };
    const after = applyPitchCommand(game, command);
    expect(after.innings[0].home.playerScores[0].pitches[0].points).toBeNull();
    expect(() => applyPitchCommand(game, { ...command, expected: 3 })).toThrow(/different information/);
    expect(() => assertSafeSnapshotTransition(game, after, undefined, 'admin')).toThrow();
  });
  it('permits an explicit practice reset but never an official reset', () => {
    const { game } = scoringFixture(); game.innings[0].home.playerScores[0].pitches[0].points = 4;
    const reset = scoringFixture().game;
    expect(() => assertSafeSnapshotTransition(game, reset, { kind: 'resetPractice' }, 'admin')).toThrow(/practice/);
    expect(() => assertSafeSnapshotTransition({ ...game, is_practice: true }, { ...reset, is_practice: true }, { kind: 'resetPractice' }, 'umpire')).not.toThrow();
  });
  it('allows admin attribution without changing pitch values', () => {
    const { game } = scoringFixture(); game.innings[0].home.playerScores[0].pitches[0].points = 4;
    const after = JSON.parse(JSON.stringify(game));
    for (const i of after.innings) i.home.playerScores[0].playerId = 'hsub';
    const intent = { kind: 'reassign' as const, mapping: { h1: 'hsub' } };
    expect(() => assertSafeSnapshotTransition(game, after, intent, 'admin')).not.toThrow();
    expect(() => assertSafeSnapshotTransition(game, after, intent, 'umpire')).toThrow();
    after.innings[0].home.playerScores[0].pitches[0].points = 3;
    expect(() => assertSafeSnapshotTransition(game, after, intent, 'admin')).toThrow();
  });
  it('keeps final games final during administrative corrections', () => {
    const { game } = scoringFixture(); game.isComplete = true; game.status = 'FINAL';
    expect(() => assertSafeSnapshotTransition(game, { ...game, isComplete: false, status: 'IN_PROGRESS' }, undefined, 'admin')).toThrow(/finished/);
  });
  it.each([{ isPractice: 'true' }, { isPractice: false, is_practice: true }, { isForfeit: 1 }, { isComplete: 'false' }])('rejects ambiguous classification %j', body => {
    expect(() => validateScoringFlags(body)).toThrow();
  });
});
