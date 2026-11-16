import type { Match } from '../types';
import { setPitchScore, setTieBreakerPitchScore } from './scorePatches.js';

export type PitchCommand = {
  kind: 'pitch'; inning: number; side: 'home' | 'away'; playerId: string;
  pitchIndex: number; expected: number | null; points: number | null;
} | {
  kind: 'extraPitch'; round: number; side: 'home' | 'away'; playerId: string;
  pitchIndex: number; expected: number | null; points: number | null;
};

export const validPoints = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4);

export class ScoringProtocolError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Stable comparison is independent of JSONB key ordering and read-time revisions. */
export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};

export const scoringState = (match: Match) => ({
  id: match.id, homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId,
  innings: match.innings, tieBreaker: match.tieBreaker || [],
});
export const sameScores = (a: Match, b: Match): boolean => stableJson(scoringState(a)) === stableJson(scoringState(b));

export const validatePitchCommand = (input: unknown): PitchCommand => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ScoringProtocolError('INVALID_COMMAND', 'This pitch could not be checked. Keep the game open and ask for help.');
  const c = input as PitchCommand;
  const allowed = new Set(['kind', 'side', 'playerId', 'pitchIndex', 'expected', 'points', c.kind === 'pitch' ? 'inning' : 'round']);
  if (!['pitch', 'extraPitch'].includes(c.kind) || !['home', 'away'].includes(c.side) ||
      typeof c.playerId !== 'string' || !c.playerId.trim() || c.playerId.length > 128 ||
      !Number.isSafeInteger(c.pitchIndex) || c.pitchIndex < 0 || c.pitchIndex > 14 ||
      !validPoints(c.expected) || !validPoints(c.points) || Object.keys(c).some(k => !allowed.has(k)) ||
      (c.kind === 'pitch' ? !Number.isSafeInteger(c.inning) || c.inning < 1 || c.inning > 6
        : !Number.isSafeInteger(c.round) || c.round < 1 || c.round > 100))
    throw new ScoringProtocolError('INVALID_COMMAND', 'This pitch is not valid. Keep the game open and ask for help.');
  return c;
};

/** Compare-and-set one cell. A stale command cannot change another batter or pitch. */
export const applyPitchCommand = (match: Match, input: unknown): Match => {
  const c = validatePitchCommand(input);
  let value: number | null | undefined;
  let batter = -1;
  if (c.kind === 'pitch') {
    const scores = match.innings?.[c.inning - 1]?.[c.side]?.playerScores;
    batter = scores?.findIndex(p => p.playerId === c.playerId) ?? -1;
    value = scores?.[batter]?.pitches?.[c.pitchIndex]?.points;
  } else {
    const round = match.tieBreaker?.[c.round - 1];
    if (round?.roundNumber === c.round && (c.side === 'home' ? round.homePlayerId : round.awayPlayerId) === c.playerId)
      value = (c.side === 'home' ? round.homeScores : round.awayScores)?.[c.pitchIndex];
  }
  if (value === undefined || value !== c.expected)
    throw new ScoringProtocolError('PITCH_CONFLICT', 'This pitch has different information. Your saved copy is safe. Ask the person running the league to check it.');
  return c.kind === 'pitch' ? setPitchScore(match, c.inning - 1, c.side, batter, c.pitchIndex, c.points)
    : setTieBreakerPitchScore(match, c.round - 1, c.side, c.pitchIndex, c.points);
};
