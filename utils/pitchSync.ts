import type { Match } from '../types';

export type PitchChange =
  | { kind: 'regulation'; matchId: string; inningIdx: number; side: 'home' | 'away';
      batterIdx: number; pitchIdx: number; playerId: string; expectedPoints: number | null; points: number | null }
  | { kind: 'tieBreaker'; matchId: string; roundIdx: number; side: 'home' | 'away';
      pitchIdx: number; playerId: string; expectedPoints: number | null; points: number | null };

const isIndex = (v: unknown, max: number) => Number.isInteger(v) && typeof v === 'number' && v >= 0 && v <= max;
const isPoints = (v: unknown): v is number | null => v === null || (isIndex(v, 4));
export const parsePitchChange = (raw: unknown): PitchChange | null => {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.matchId !== 'string' || !c.matchId.trim() || c.matchId.length > 160 ||
      typeof c.playerId !== 'string' || !c.playerId.trim() || c.playerId.length > 160 ||
      (c.side !== 'home' && c.side !== 'away') ||
      !isPoints(c.points) || !isPoints(c.expectedPoints)) return null;
  if (c.kind === 'regulation' && isIndex(c.inningIdx, 5) &&
      isIndex(c.batterIdx, 2) && isIndex(c.pitchIdx, 14)) {
    return c as unknown as PitchChange;
  }
  if (c.kind === 'tieBreaker' && isIndex(c.roundIdx, 30) && isIndex(c.pitchIdx, 4)) {
    return c as unknown as PitchChange;
  }
  return null;
};

/** Replay local unsent scores without changing unrelated pitches or innings. */
export const applyPitchChange = (match: Match, c: PitchChange): Match => {
  if (match.id !== c.matchId) return match;
  if (c.kind === 'regulation') {
    const inning = match.innings[c.inningIdx];
    const side = inning?.[c.side];
    const player = side?.playerScores[c.batterIdx];
    if (!player || player.playerId !== c.playerId || !player.pitches[c.pitchIdx]) return match;
    return {
      ...match,
      innings: match.innings.map((value, i) => i === c.inningIdx ? {
        ...value, [c.side]: {
          ...side, playerScores: side.playerScores.map((p, j) => j === c.batterIdx ? {
            ...p, pitches: p.pitches.map((pitch, k) => k === c.pitchIdx ? { ...pitch, points: c.points } : pitch)
          } : p)
        }
      } : value)
    };
  }
  const round = match.tieBreaker?.[c.roundIdx];
  if (!round || (c.side === 'home' ? round.homePlayerId : round.awayPlayerId) !== c.playerId) return match;
  const key = c.side === 'home' ? 'homeScores' : 'awayScores';
  if (!Array.isArray(round[key]) || c.pitchIdx >= round[key].length) return match;
  return {
    ...match, tieBreaker: match.tieBreaker!.map((v, i) => i === c.roundIdx ? {
      ...v, [key]: v[key].map((p, k) => k === c.pitchIdx ? c.points : p)
    } : v)
  };
};
