import type { Match, Team } from '../types';
import { leaguesMatch } from './leagueNames';
import { calculateTeamGameTotal } from './scoreTotals';
import { isForfeitMatch, getForfeitingTeamId } from '../services/matchHelpers';

export interface LeagueStanding {
  id: string;
  name: string;
  gp: number;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
}

/** Calculate official standings without touching React state or network data. */
export const calculateLeagueStandings = (
  matches: Match[],
  leagueTeams: Team[],
  currentLeague: string | null
): LeagueStanding[] => {
    if (!currentLeague) return [];
    
    // Initialize stats for all teams in the current league
    const stats = new Map<string, { id: string, name: string, gp: number, w: number, l: number, t: number, pf: number, pa: number }>();
    leagueTeams.forEach(t => {
      stats.set(t.id, { id: t.id, name: t.name, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    });

    matches.forEach(m => {
      // Strict Stats Isolation: Practice matches never affect official league standings
      if (m.isPractice || m.is_practice || !m.isComplete || (m.league && !leaguesMatch(m.league, currentLeague))) return;
      
      const hScore = calculateTeamGameTotal('home', m);
      const aScore = calculateTeamGameTotal('away', m);

      const isForfeit = isForfeitMatch(m);
      const forfeitingId = getForfeitingTeamId(m);

      if (isForfeit && forfeitingId) {
          // Automatic Forfeit Win/Loss Outcome & Asymmetrical Stats:
          // Non-forfeiting team gets an automatic win. Points scored count for compliant team.
          // Forfeiting team gets an automatic loss. Forfeiting team points are completely excluded (pf = 0).
          const isHomeForfeiting = forfeitingId === m.homeTeamId;
          const homeRec = stats.get(m.homeTeamId);
          const awayRec = stats.get(m.awayTeamId);

          if (homeRec) {
              homeRec.gp++;
              if (isHomeForfeiting) {
                  homeRec.l++;
                  homeRec.pf += 0; // forfeiting team hitting points completely excluded
                  homeRec.pa += aScore;
              } else {
                  homeRec.w++;
                  homeRec.pf += hScore; // compliant team hitting points intact
                  homeRec.pa += 0; // opponent forfeiting points excluded
              }
          }

          if (awayRec) {
              awayRec.gp++;
              if (isHomeForfeiting) {
                  awayRec.w++;
                  awayRec.pf += aScore; // compliant team hitting points intact
                  awayRec.pa += 0; // opponent forfeiting points excluded
              } else {
                  awayRec.l++;
                  awayRec.pf += 0; // forfeiting team hitting points completely excluded
                  awayRec.pa += hScore;
              }
          }
          return;
      }

      const update = (id: string, s: number, os: number) => {
          if (!stats.has(id)) return;
          const rec = stats.get(id)!;
          rec.gp++;
          rec.pf += s;
          rec.pa += os;
          if (s > os) rec.w++;
          else if (s < os) rec.l++;
          else rec.t++;
      };
      
      update(m.homeTeamId, hScore, aScore);
      update(m.awayTeamId, aScore, hScore);
    });

    return Array.from(stats.values()).sort((a, b) => {
        if (a.w !== b.w) return b.w - a.w;
        if (a.t !== b.t) return b.t - a.t;
        if (a.pf !== b.pf) return b.pf - a.pf;
        return a.pa - b.pa;
    });

};
