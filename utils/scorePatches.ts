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
