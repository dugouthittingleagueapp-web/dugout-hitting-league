import { Match } from '../types.js';

/**
 * Centralized Match Helpers for Dugout Hitting League
 * Guarantees consistent validation and classification of official vs practice matches.
 */

/**
 * Returns true if the match is strictly marked as a practice match.
 * Normalizes both `isPractice` (frontend/camelCase) and `is_practice` (database/snake_case).
 */
export function isPracticeMatch(match: { isPractice?: boolean; is_practice?: boolean } | null | undefined): boolean {
  if (!match) return false;
  return match.isPractice === true || match.is_practice === true;
}

/**
 * Returns true if the match is strictly an official league match.
 * Any match where is_practice is false, null, undefined, 0, or missing is treated as official.
 */
export function isOfficialMatch(match: { isPractice?: boolean; is_practice?: boolean } | null | undefined): boolean {
  if (!match) return false;
  return match.isPractice !== true && match.is_practice !== true;
}

/**
 * Returns true if the match has been completed/finalized.
 */
export function isCompletedMatch(match: { isComplete?: boolean; status?: string } | null | undefined): boolean {
  if (!match) return false;
  return match.isComplete === true || match.status === 'FINAL';
}

/**
 * Determines whether a user with the given role is authorized to delete the match.
 * RULE: Official matches can NEVER be deleted by anyone, including administrators.
 * Only completed practice matches can be deleted by administrators and umpires.
 */
export function canDeletePracticeMatch(
  userRole: string | null | undefined,
  match: { isPractice?: boolean; is_practice?: boolean; isComplete?: boolean; status?: string } | null | undefined
): boolean {
  if (!userRole || userRole === 'fan') return false;
  if (!isPracticeMatch(match)) return false;
  // Official matches are strictly non-deletable
  if (isOfficialMatch(match)) return false;
  // Only completed practice matches can be deleted
  return isCompletedMatch(match) && (userRole === 'admin' || userRole === 'umpire');
}

/**
 * Returns true if the match has been flagged as an official forfeit.
 */
export function isForfeitMatch(match: { isForfeit?: boolean; is_forfeit?: boolean } | null | undefined): boolean {
  if (!match) return false;
  return match.isForfeit === true || match.is_forfeit === true;
}

/**
 * Returns the forfeiting team ID if match is a forfeit.
 */
export function getForfeitingTeamId(match: { forfeitingTeamId?: string | null; forfeiting_team_id?: string | null } | null | undefined): string | null {
  if (!match) return null;
  return match.forfeitingTeamId || match.forfeiting_team_id || null;
}

/**
 * A lineup ID must belong to this team's permanent roster or registered substitutes.
 * Never silently classify a missing/stale ID as a substitute.
 */
export function getUnknownLineupIds(
  team: { players?: { id: string }[]; subs?: { id: string }[] } | null | undefined,
  lineupIds: string[]
): string[] {
  const validIds = new Set([...(team?.players || []), ...(team?.subs || [])].map(p => p.id));
  return lineupIds.filter(id => !validIds.has(id));
}

export interface ForfeitEvaluation {
  isForfeit: boolean;
  forfeitingTeamId: string | null;
  winningTeamId: string | null;
  reason?: string;
  forfeitReason?: string;
  homeMainCount: number;
  awayMainCount: number;
  unknownHomeIds: string[];
  unknownAwayIds: string[];
}

/**
 * Validates roster thresholds according to official league rules:
 * If a team fields only 1 main roster player (plus subs) while the opposing team fields 2 or more main members,
 * automatically flag as a forfeit, assigning an automatic loss to the forfeiting team and win to the compliant opponent.
 */
export function detectForfeit(
  homeTeam: { id: string; name?: string; players?: { id: string }[]; subs?: { id: string }[] } | null | undefined,
  awayTeam: { id: string; name?: string; players?: { id: string }[]; subs?: { id: string }[] } | null | undefined,
  homeLineupIds: string[] = [],
  awayLineupIds: string[] = []
): ForfeitEvaluation {
  if (!homeTeam || !awayTeam) {
    return { isForfeit: false, forfeitingTeamId: null, winningTeamId: null, homeMainCount: 0, awayMainCount: 0, unknownHomeIds: [], unknownAwayIds: [] };
  }

  const unknownHomeIds = getUnknownLineupIds(homeTeam, homeLineupIds);
  const unknownAwayIds = getUnknownLineupIds(awayTeam, awayLineupIds);
  // Incomplete/corrupt lineups must be repaired, not scored as official forfeits.
  if (unknownHomeIds.length > 0 || unknownAwayIds.length > 0) {
    return {
      isForfeit: false, forfeitingTeamId: null, winningTeamId: null,
      homeMainCount: 0, awayMainCount: 0, unknownHomeIds, unknownAwayIds
    };
  }

  const homeMainPlayers = homeTeam.players || [];
  const awayMainPlayers = awayTeam.players || [];

  const homeMainCount = homeLineupIds.filter(pid => homeMainPlayers.some(p => p.id === pid)).length;
  const awayMainCount = awayLineupIds.filter(pid => awayMainPlayers.some(p => p.id === pid)).length;

  const homeTeamName = homeTeam.name || 'Home Team';
  const awayTeamName = awayTeam.name || 'Away Team';

  // Rule 1: Home fields <=1 main member while Away fields >=2 main members -> Home Forfeits
  if (homeMainCount <= 1 && awayMainCount >= 2) {
    const text = `${homeTeamName} fielded only ${homeMainCount} main roster member (${homeLineupIds.length - homeMainCount} subs) while ${awayTeamName} fielded ${awayMainCount} main roster members. Automatic forfeit loss assigned to ${homeTeamName}.`;
    return {
      isForfeit: true,
      forfeitingTeamId: homeTeam.id,
      winningTeamId: awayTeam.id,
      reason: text,
      forfeitReason: text,
      homeMainCount,
      awayMainCount,
      unknownHomeIds,
      unknownAwayIds
    };
  }

  // Rule 2: Away fields <=1 main member while Home fields >=2 main members -> Away Forfeits
  if (awayMainCount <= 1 && homeMainCount >= 2) {
    const text = `${awayTeamName} fielded only ${awayMainCount} main roster member (${awayLineupIds.length - awayMainCount} subs) while ${homeTeamName} fielded ${homeMainCount} main roster members. Automatic forfeit loss assigned to ${awayTeamName}.`;
    return {
      isForfeit: true,
      forfeitingTeamId: awayTeam.id,
      winningTeamId: homeTeam.id,
      reason: text,
      forfeitReason: text,
      homeMainCount,
      awayMainCount,
      unknownHomeIds,
      unknownAwayIds
    };
  }

  return {
    isForfeit: false,
    forfeitingTeamId: null,
    winningTeamId: null,
    homeMainCount,
    awayMainCount,
    unknownHomeIds,
    unknownAwayIds
  };
}

/**
 * Normalizes database match records into typed Match instances.
 */
export function normalizeMatch(row: any): Match {
  const isPractice = row.is_practice === true || row.isPractice === true;
  const isComplete = row.is_complete === true || row.isComplete === true || row.status === 'FINAL';
  const status = row.status || (isComplete ? 'FINAL' : 'SCHEDULED');
  const isForfeit = row.is_forfeit === true || row.isForfeit === true;
  const forfeitingTeamId = row.forfeiting_team_id || row.forfeitingTeamId || null;
  const winningTeamId = row.winning_team_id || row.winningTeamId || null;
  const forfeitReason = row.forfeit_reason || row.forfeitReason || undefined;
  
  let innings = row.innings;
  if (typeof innings === 'string') {
    try {
      innings = JSON.parse(innings);
    } catch (e) {
      innings = [];
    }
  }

  let tieBreaker = row.tieBreaker || row.tie_breaker;
  if (typeof tieBreaker === 'string') {
    try {
      tieBreaker = JSON.parse(tieBreaker);
    } catch (e) {
      tieBreaker = undefined;
    }
  }

  let id = String(row.id || '');
  if (isPractice && !id.startsWith('practice-')) {
    id = `practice-${id}`;
  }

  return {
    id,
    league: row.league || '',
    homeTeamId: row.homeTeamId || row.home_team_id || '',
    awayTeamId: row.awayTeamId || row.away_team_id || '',
    date: row.date || new Date().toISOString(),
    isComplete,
    status,
    innings: Array.isArray(innings) ? innings : [],
    season: row.season || '2026',
    tieBreaker,
    location: row.location || undefined,
    startTime: row.startTime || row.start_time || undefined,
    endTime: row.endTime || row.end_time || undefined,
    notes: row.notes || undefined,
    isPractice,
    is_practice: isPractice,
    isForfeit,
    is_forfeit: isForfeit,
    forfeitingTeamId,
    forfeiting_team_id: forfeitingTeamId,
    winningTeamId,
    winning_team_id: winningTeamId,
    forfeitReason,
    forfeit_reason: forfeitReason,
  };
}
