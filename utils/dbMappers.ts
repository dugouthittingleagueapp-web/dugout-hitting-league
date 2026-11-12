import type { Match, Team } from '../types';

// Convert database rows to the existing app models without changing legacy
// 2025 handling, practice/forfeit flags, or stored scoring arrays.
export const mapTeamFromDB = (dbTeam: any): Team => ({
  ...dbTeam,
  season: dbTeam.season || '2025',
  players: typeof dbTeam.players === 'string' ? JSON.parse(dbTeam.players) : dbTeam.players,
  subs: dbTeam.subs ? (typeof dbTeam.subs === 'string' ? JSON.parse(dbTeam.subs) : dbTeam.subs) : []
});

export const mapMatchFromDB = (dbMatch: any): Match => {
  const inferredSeason = dbMatch.season || (dbMatch.date ? String(new Date(dbMatch.date).getFullYear()) : '2025');
  return {
    id: dbMatch.id,
    revision: Number(dbMatch.revision ?? 0),
    league: dbMatch.league,
    homeTeamId: dbMatch.home_team_id || dbMatch.homeTeamId,
    awayTeamId: dbMatch.away_team_id || dbMatch.awayTeamId,
    date: dbMatch.date,
    isComplete: dbMatch.is_complete !== undefined ? dbMatch.is_complete : (dbMatch.isComplete ?? false),
    status: dbMatch.status || undefined,
    innings: typeof dbMatch.innings === 'string' ? JSON.parse(dbMatch.innings) : dbMatch.innings,
    season: inferredSeason,
    tieBreaker: dbMatch.tie_breaker ? (typeof dbMatch.tie_breaker === 'string' ? JSON.parse(dbMatch.tie_breaker) : dbMatch.tie_breaker) : (dbMatch.tieBreaker || undefined),
    location: dbMatch.location || undefined,
    startTime: dbMatch.start_time || dbMatch.startTime || undefined,
    endTime: dbMatch.end_time || dbMatch.endTime || undefined,
    isPractice: dbMatch.is_practice !== undefined ? dbMatch.is_practice : (dbMatch.isPractice ?? false),
    is_practice: dbMatch.is_practice !== undefined ? dbMatch.is_practice : (dbMatch.isPractice ?? false),
    isForfeit: dbMatch.is_forfeit !== undefined ? dbMatch.is_forfeit : (dbMatch.isForfeit ?? false),
    is_forfeit: dbMatch.is_forfeit !== undefined ? dbMatch.is_forfeit : (dbMatch.isForfeit ?? false),
    forfeitingTeamId: dbMatch.forfeiting_team_id || dbMatch.forfeitingTeamId || null,
    forfeiting_team_id: dbMatch.forfeiting_team_id || dbMatch.forfeitingTeamId || null,
    winningTeamId: dbMatch.winning_team_id || dbMatch.winningTeamId || null,
    winning_team_id: dbMatch.winning_team_id || dbMatch.winningTeamId || null,
    forfeitReason: dbMatch.forfeit_reason || dbMatch.forfeitReason || undefined,
    forfeit_reason: dbMatch.forfeit_reason || dbMatch.forfeitReason || undefined,
  };
};

