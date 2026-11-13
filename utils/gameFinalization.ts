import type { Match, Team, TieBreakerRound } from '../types';
import { getMatchScores } from './scoreTotals';

/** The final write must be confirmed by the server before leaving scoring. */
export const prepareFinalizedMatch = (match: Match): Match => ({
  ...match,
  isComplete: true,
  status: 'FINAL',
});

export const getFinalizationDecision = (
  match: Match,
  source: 'exit' | 'finish',
  allowTie = false
): 'finalize' | 'confirm-tie' | 'start-extras' => {
  const { home, away } = getMatchScores(match);
  if (home !== away || allowTie) return 'finalize';
  if (source === 'exit' && (match.tieBreaker?.length || 0) > 0) return 'finalize';
  return source === 'exit' ? 'confirm-tie' : 'start-extras';
};

export const getFinalizationMessage = (
  match: Match,
  teams: { home?: Team; away?: Team },
  source: 'exit' | 'finish'
): string => {
  const { home, away } = getMatchScores(match);
  const score = `${teams.home?.name || 'Home Team'} ${home} - ${teams.away?.name || 'Away Team'} ${away}`;
  if (match.isPractice || match.is_practice) {
    return `Practice Match Completed! Final Score: ${score}. Stored on schedule.`;
  }
  return source === 'exit'
    ? `Match Finalized! Final Score: ${score}. Official stats and standings recorded.`
    : `Match Finalized! Final Score: ${score}. Standings and stats updated.`;
};

/** 5 pitches, then 3, then 1 for each subsequent extra round. */
export const createNextTieBreakerRound = (
  existing: TieBreakerRound[] | undefined,
  homePlayerId: string,
  awayPlayerId: string
): TieBreakerRound => {
  const last = existing?.[existing.length - 1];
  const pitchLimit = !last ? 5 : last.pitchLimit === 5 ? 3 : 1;
  return {
    roundNumber: last ? last.roundNumber + 1 : 1,
    pitchLimit,
    homePlayerId,
    awayPlayerId,
    homeScores: Array(pitchLimit).fill(null),
    awayScores: Array(pitchLimit).fill(null),
  };
};

/** Copy just the tie-breaker rounds that change, never mutate earlier results. */
export const appendTieBreakerRound = (match: Match, round: TieBreakerRound): Match => ({
  ...match,
  tieBreaker: [...(match.tieBreaker || []), round],
  isComplete: false,
  status: 'IN_PROGRESS',
});
