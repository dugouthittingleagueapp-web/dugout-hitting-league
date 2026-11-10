import type { Match } from '../types';

export type PitchSide = 'home' | 'away';

export interface PitchEdit {
  id: string;
  side: PitchSide;
  pitchIdx: number;
  playerId: string;
  points: number | null;
  expectedPoints: number | null;
  /** Regulation pitch is addressed by inning; tie-breaker by round. */
  inningIdx?: number;
  roundIdx?: number;
}

export const isPitchValue = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4);

export const validatePitchEdit = (edit: PitchEdit): string | null => {
  if (!edit || typeof edit.id !== 'string' || !edit.id.trim()) return 'Missing match ID.';
  if (edit.side !== 'home' && edit.side !== 'away') return 'Invalid team side.';
  if (!Number.isInteger(edit.pitchIdx) || edit.pitchIdx < 0 || edit.pitchIdx > 14) return 'Invalid pitch position.';
  if (typeof edit.playerId !== 'string' || !edit.playerId.trim()) return 'Missing player ID.';
  if (!isPitchValue(edit.points) || !isPitchValue(edit.expectedPoints)) return 'Score must be 0, 1, 2, 3, 4, or empty.';
  const isRegulation = Number.isInteger(edit.inningIdx) && edit.roundIdx === undefined && edit.inningIdx! >= 0 && edit.inningIdx! < 6;
  const isTie = Number.isInteger(edit.roundIdx) && edit.inningIdx === undefined && edit.roundIdx! >= 0 && edit.roundIdx! < 50;
  if (!isRegulation && !isTie) return 'Specify one valid inning or tie-breaker round.';
  return null;
};

export type PitchEditResult =
  | { ok: true; updated: Match; alreadyApplied: boolean }
  | { ok: false; reason: string; conflict: boolean };

/**
 * Apply one pitch to the latest DB match, not a stale browser snapshot.
 * Called under a PostgreSQL row lock. Also supports safe retry after the
 * server committed but the response was lost.
 */
export const applyPitchEdit = (match: Match, edit: PitchEdit, allowFinalEdit: boolean): PitchEditResult => {
  const validation = validatePitchEdit(edit);
  if (validation) return { ok: false, reason: validation, conflict: false };
  if (match.isComplete && !allowFinalEdit) {
    return { ok: false, reason: 'Game is final. Ask an administrator to correct its score.', conflict: true };
  }

  if (edit.inningIdx !== undefined) {
    const inning = match.innings?.[edit.inningIdx];
    const team = inning?.[edit.side];
    const player = team?.playerScores?.find(p => p.playerId === edit.playerId);
    const pitch = player?.pitches?.[edit.pitchIdx];
    if (!player || !pitch) return { ok: false, reason: 'Lineup changed or pitch no longer exists. Reload the game before scoring.', conflict: true };
    if (pitch.points === edit.points) return { ok: true, updated: match, alreadyApplied: true };
    if (pitch.points !== edit.expectedPoints) return { ok: false, reason: 'Another device changed this pitch. Reload the game before editing it.', conflict: true };
    return {
      ok: true,
      alreadyApplied: false,
      updated: {
        ...match,
        innings: match.innings.map((item, idx) => idx !== edit.inningIdx ? item : {
          ...item,
          [edit.side]: {
            ...item[edit.side],
            playerScores: item[edit.side].playerScores.map(p => p.playerId !== edit.playerId ? p : {
              ...p,
              pitches: p.pitches.map((v, pos) => pos === edit.pitchIdx ? { ...v, points: edit.points } : v)
            })
          }
        }),
        status: match.isComplete ? match.status : 'IN_PROGRESS'
      }
    };
  }

  const round = match.tieBreaker?.[edit.roundIdx!];
  const expectedPlayer = edit.side === 'home' ? round?.homePlayerId : round?.awayPlayerId;
  const scores = edit.side === 'home' ? round?.homeScores : round?.awayScores;
  if (!round || expectedPlayer !== edit.playerId || !scores || edit.pitchIdx >= scores.length) {
    return { ok: false, reason: 'Tie-breaker player or round changed. Reload the game before scoring.', conflict: true };
  }
  const value = scores[edit.pitchIdx];
  if (value === edit.points) return { ok: true, updated: match, alreadyApplied: true };
  if (value !== edit.expectedPoints) return { ok: false, reason: 'Another device changed this tie-breaker pitch. Reload before editing.', conflict: true };
  const field = edit.side === 'home' ? 'homeScores' : 'awayScores';
  return {
    ok: true,
    alreadyApplied: false,
    updated: {
      ...match,
      tieBreaker: match.tieBreaker!.map((item, idx) => idx !== edit.roundIdx ? item : {
        ...item, [field]: scores.map((v, pos) => pos === edit.pitchIdx ? edit.points : v)
      }),
      status: match.isComplete ? match.status : 'IN_PROGRESS'
    }
  };
};
