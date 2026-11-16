import type { Match, Team, TieBreakerRound } from '../types';
import { getMatchScores } from './scoreTotals.js';

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

/** Completion is checked across the whole game, not just the last cell. */
export const areRegulationPitchesRecorded = (match: Match): boolean =>
  match.innings.length > 0 && match.innings.every(i => (['home', 'away'] as const).every(side =>
    i[side].playerScores.length > 0 && i[side].playerScores.every(p => p.pitches.length > 0 &&
      p.pitches.every(v => typeof v.points === 'number' && Number.isInteger(v.points) && v.points >= 0 && v.points <= 4))));

/** Explain a blocked action instead of leaving an apparently active button. */
export const getExtraRoundBlockReason = (match: Match): string | null => {
  if (match.isComplete || match.status === 'FINAL') return 'This game is finished. Return to scoring to view its result.';
  if (match.isForfeit || match.is_forfeit) return 'This game is marked as a forfeit. Return to scoring to review the lineup and result.';
  if (!areRegulationPitchesRecorded(match)) return 'Record the remaining regulation pitches before starting extras. Use Back to scoring to finish them.';
  const regulation = getMatchScores({ ...match, tieBreaker: [] });
  if (regulation.home !== regulation.away) return 'The score must be tied before starting extras.';
  for (const round of match.tieBreaker || []) {
    if (round.homeScores.length !== round.pitchLimit || round.awayScores.length !== round.pitchLimit ||
        [...round.homeScores, ...round.awayScores].some(n => typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 4))
      return 'Record every pitch in the current extra round before starting another.';
    if (round.homeScores.reduce<number>((sum, n) => sum + (n ?? 0), 0) !== round.awayScores.reduce<number>((sum, n) => sum + (n ?? 0), 0))
      return 'The extra round must end in a tie before starting another.';
  }
  return null;
};

/** A tied display is insufficient: every prior pitch must be recorded. */
export const canAdvanceExtraRound = (match: Match): boolean => getExtraRoundBlockReason(match) === null;

/** Copy just the tie-breaker rounds that change, never mutate earlier results. */
export const appendTieBreakerRound = (match: Match, round: TieBreakerRound): Match => {
  if (!canAdvanceExtraRound(match)) throw new Error(getExtraRoundBlockReason(match)!);
  return { ...match, tieBreaker: [...(match.tieBreaker || []), round], isComplete: false, status: 'IN_PROGRESS' };
};
