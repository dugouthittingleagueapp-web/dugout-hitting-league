import type { Match } from '../types';

/**
 * Copy only the affected inning, player and pitch. Other innings and players
 * are immutable and can be shared, avoiding a full JSON clone on every tap.
 */
export const withPitchScore = (
  match: Match,
  inningIndex: number,
  side: 'home' | 'away',
  playerIndex: number,
  pitchIndex: number,
  points: number
): Match => {
  const inning = match.innings[inningIndex];
  const team = inning?.[side];
  const player = team?.playerScores[playerIndex];
  if (!player?.pitches[pitchIndex]) return match;

  const pitches = player.pitches.slice();
  pitches[pitchIndex] = { ...pitches[pitchIndex], points };
  const playerScores = team.playerScores.slice();
  playerScores[playerIndex] = { ...player, pitches };

  const innings = match.innings.slice();
  innings[inningIndex] = {
    ...inning,
    [side]: { ...team, playerScores }
  };

  return {
    ...match,
    innings,
    status: match.isComplete ? match.status : 'IN_PROGRESS'
  };
};
