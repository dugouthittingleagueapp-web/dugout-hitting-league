import { hasRecordedScores } from '../server/matchWritePolicy.js';

interface ScheduleGame {
  isComplete?: boolean;
  is_complete?: boolean;
  status?: string | null;
  scoringLocked?: boolean;
  scoring_locked?: boolean;
  innings?: unknown;
  tieBreaker?: unknown;
  tie_breaker?: unknown;
}

const decode = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return { invalidScoreData: true }; }
};

/** Blank legacy schedules may lack a status; recorded or unrecognized data always stays locked. */
export const scheduleLockedReason = (game: ScheduleGame): string | null => {
  if (game.isComplete === true || game.is_complete === true || game.status === 'FINAL')
    return 'This game is finished. Its recorded results are protected.';
  if (game.scoringLocked || game.scoring_locked) return 'An umpire has this game open. Close scoring before changing its schedule.';
  if (game.status === 'IN_PROGRESS') return 'Scoring has started. Use scoring to make corrections.';
  if (game.status && game.status !== 'SCHEDULED') return 'This game needs an admin review before its schedule can change.';
  if (hasRecordedScores(decode(game.innings), decode(game.tieBreaker ?? game.tie_breaker)))
    return 'This game has scores or saved scoring data. Its schedule is locked to protect those results.';
  return null;
};
