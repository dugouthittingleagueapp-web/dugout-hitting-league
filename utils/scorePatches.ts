import type { Match, PlayerInningScore } from '../types';

/**
 * Update one pitch without deep cloning the entire match's history.
 * React receives new references along only the affected inning/team/batter
 * path; all untouched games, innings, and players preserve identity.
 */
export const setPitchScore = (
  match: Match,
  inningIdx: number,
  side: 'home' | 'away',
  batterIdx: number,
  pitchIdx: number,
  points: number | null
): Match => {
  const inning = match.innings[inningIdx];
  const score = inning?.[side]?.playerScores?.[batterIdx];
  if (!score || !score.pitches?.[pitchIdx]) return match;
  if (score.pitches[pitchIdx].points === points) return match;

  const updatedScore: PlayerInningScore = {
    ...score,
    pitches: score.pitches.map((pitch, idx) => idx === pitchIdx ? { ...pitch, points } : pitch)
  };
  const updatedSide = {
    ...inning[side],
    playerScores: inning[side].playerScores.map((player, idx) => idx === batterIdx ? updatedScore : player)
  };
  const updatedInning = { ...inning, [side]: updatedSide };
  return {
    ...match,
    innings: match.innings.map((value, idx) => idx === inningIdx ? updatedInning : value),
    status: match.isComplete ? match.status : 'IN_PROGRESS'
  };
};

/**
 * Tie-breaker buttons 0–4 use the same targeted immutable approach.
 * Preserve untouched tie-breaker rounds and complete regulation innings.
 */
export const setTieBreakerPitchScore = (
  match: Match,
  roundIdx: number,
  side: 'home' | 'away',
  pitchIdx: number,
  points: number | null
): Match => {
  const round = match.tieBreaker?.[roundIdx];
  const scores = side === 'home' ? round?.homeScores : round?.awayScores;
  if (!round || !scores || pitchIdx < 0 || pitchIdx >= scores.length) return match;
  if (scores[pitchIdx] === points) return match;
  const updatedScores = scores.map((value, idx) => idx === pitchIdx ? points : value);
  const updatedRound = side === 'home'
    ? { ...round, homeScores: updatedScores }
    : { ...round, awayScores: updatedScores };
  return {
    ...match,
    tieBreaker: match.tieBreaker!.map((value, idx) => idx === roundIdx ? updatedRound : value),
    status: match.isComplete ? match.status : 'IN_PROGRESS'
  };
};
