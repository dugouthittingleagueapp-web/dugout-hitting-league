import type { Match, Team, PlayerStats } from '../types';
import { calculateMatchStats } from './matchStatistics';

/**
 * Pure team-season aggregation. Preserve the existing exclusions and name
 * handling exactly: no networking, caching, or mutation of match data here.
 */
export const aggregateTeamPlayerStats = (team: Team, matches: Match[], allTeams: Team[]): PlayerStats[] => {
    const teamMatches = matches.filter(m => (m.homeTeamId === team.id || m.awayTeamId === team.id) && m.isComplete && !m.isPractice && !m.is_practice);

    const aggStats = new Map<string, PlayerStats>();
    
    teamMatches.forEach(m => {
        // ASYMMETRICAL STATS EXCLUSION:
        // Completely exclude the individual and team statistics of the forfeiting team from being counted toward season totals.
        // The compliant opponent's stats remain fully intact!
        const isForfeit = !!(m.isForfeit || m.is_forfeit);
        const forfeitingId = m.forfeitingTeamId || m.forfeiting_team_id;
        if (isForfeit && forfeitingId === team.id) {
            return;
        }

        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        if(home && away) {
            const mStats = calculateMatchStats(m, home, away);
            mStats.forEach(stat => {
                // Only aggregate for THIS team's players (including subs and ghost)
                const isMainPlayer = team.players.some(p => p.id === stat.playerId);
                const isSub = team.subs && team.subs.some(p => p.id === stat.playerId);
                const isGhost = stat.playerId === `ghost-${team.id}`;

                if(isMainPlayer || isSub || isGhost) {
                     if(!aggStats.has(stat.playerId)) {
                         aggStats.set(stat.playerId, { ...stat });
                     } else {
                         const ex = aggStats.get(stat.playerId)!;
                         ex.totalPoints += stat.totalPoints;
                         ex.hits4 += stat.hits4;
                         ex.hits3 += stat.hits3;
                         ex.hits2 += stat.hits2;
                         ex.hits1 += stat.hits1;
                         ex.pitchesSeen += stat.pitchesSeen;
                     }
                }
            });
        }
    });

    return Array.from(aggStats.values()).filter(s => !s.playerId.startsWith('ghost-'));
};
