import type { Match, Team } from '../types';
import { isForfeitMatch, getForfeitingTeamId } from '../services/matchHelpers';

export interface WeeklyLeader {
  name: string;
  team: string;
  score: number;
}

export interface WeeklyLeaderboard {
  topTotals: WeeklyLeader[];
  topInnings: WeeklyLeader[];
}

/** Calculate one week's best player totals and single-inning scores. */
export const calculateWeeklyLeaders = (
  targetMatches: Match[],
  teams: Team[]
): WeeklyLeaderboard => {
      const relevantMatches = targetMatches.filter(m => m.isComplete && !m.isPractice && !m.is_practice);

      // Track unique players by ID to ensure they only appear once with their best score
      const uniqueTotals = new Map<string, { name: string, team: string, score: number }>();
      const uniqueInnings = new Map<string, { name: string, team: string, score: number }>();

      relevantMatches.forEach(m => {
          const home = teams.find(t => t.id === m.homeTeamId);
          const away = teams.find(t => t.id === m.awayTeamId);
          if (!home || !away) return;

          const isForfeit = isForfeitMatch(m);
          const forfeitingId = getForfeitingTeamId(m);

          // 1. Calculate Match Totals Manually (Strict 10-pitch limit for Ghost Mode)
          const matchPlayerTotals = new Map<string, number>();

          // Process Innings
          (m.innings || []).forEach(ing => {
              [ing.home, ing.away].forEach((side, sideIdx) => {
                   if (!side?.playerScores) return;
                   // Completely exclude forfeiting team stats
                   if (isForfeit && forfeitingId) {
                       const currentSideTeamId = sideIdx === 0 ? m.homeTeamId : m.awayTeamId;
                       if (currentSideTeamId === forfeitingId) return;
                   }

                   const isGhostMode = side.playerScores.length === 2 && (side.playerScores[0]?.pitches?.length || 0) >= 15;
                   side.playerScores.forEach(ps => {
                       if (!ps || ps.playerId.startsWith('ghost-')) return;
                       
                       let pitchesToCount = ps.pitches || [];
                       // Strictly slice first 10 for individual stats in Ghost Mode
                       if (isGhostMode && pitchesToCount.length > 10) {
                           pitchesToCount = pitchesToCount.slice(0, 10);
                       }
                       
                       const pts = pitchesToCount.reduce((sum, p) => sum + (p?.points || 0), 0);
                       matchPlayerTotals.set(ps.playerId, (matchPlayerTotals.get(ps.playerId) || 0) + pts);
                   });
              });
          });

          // Process Tie Breakers (No ghost mode in tie breakers usually, but standard addition)
          if (m.tieBreaker && Array.isArray(m.tieBreaker)) {
              m.tieBreaker.forEach(tb => {
                  const addTbScore = (pid: string, scores: (number|null)[]) => {
                      if (!Array.isArray(scores)) return;
                      const pts = scores.reduce<number>((sum, s) => (sum || 0) + (s || 0), 0);
                      matchPlayerTotals.set(pid, (matchPlayerTotals.get(pid) || 0) + pts);
                  };
                  if (tb.homePlayerId && (!isForfeit || forfeitingId !== m.homeTeamId)) addTbScore(tb.homePlayerId, tb.homeScores);
                  if (tb.awayPlayerId && (!isForfeit || forfeitingId !== m.awayTeamId)) addTbScore(tb.awayPlayerId, tb.awayScores);
              });
          }

          // Update Leaderboard with this Match's Totals
          matchPlayerTotals.forEach((totalScore, playerId) => {
               // Find player info
               let player = [...(home.players || []), ...(home.subs || [])].find(p => p.id === playerId);
               let teamName = home.name;
               if (!player) {
                   player = [...(away.players || []), ...(away.subs || [])].find(p => p.id === playerId);
                   teamName = away.name;
               }

               if (player) {
                   const fullName = `${player.name}${player.lastName ? ' ' + player.lastName[0] + '.' : ''}`;
                   // Check if this is the best score for this player so far
                   const existing = uniqueTotals.get(playerId);
                   if (!existing || totalScore > existing.score) {
                       uniqueTotals.set(playerId, { name: fullName, team: teamName, score: totalScore });
                   }
               }
          });

          // 2. Best Inning (Existing Logic - ensure consistency)
          (m.innings || []).forEach(ing => {
              [ing.home, ing.away].forEach((side, sideIdx) => {
                  if (!side?.playerScores) return;
                  if (isForfeit && forfeitingId) {
                      const currentSideTeamId = sideIdx === 0 ? m.homeTeamId : m.awayTeamId;
                      if (currentSideTeamId === forfeitingId) return;
                  }
                  const team = sideIdx === 0 ? home : away;
                  const isGhostMode = side.playerScores.length === 2 && (side.playerScores[0]?.pitches?.length || 0) >= 15;

                  side.playerScores.forEach(ps => {
                      if (!ps || ps.playerId.startsWith('ghost-')) return;

                      const p = [...(team.players || []), ...(team.subs || [])].find(x => x.id === ps.playerId);
                      if (p) {
                          let pitchesToCount = ps.pitches || [];
                          if (isGhostMode && pitchesToCount.length > 10) {
                              pitchesToCount = pitchesToCount.slice(0, 10);
                          }
                          const score = pitchesToCount.reduce((sum, v) => sum + (v?.points || 0), 0);
                          
                          const existing = uniqueInnings.get(p.id);
                          if (!existing || score > existing.score) {
                              const fullName = `${p.name}${p.lastName ? ' ' + p.lastName[0] + '.' : ''}`;
                              uniqueInnings.set(p.id, { name: fullName, team: team.name, score });
                          }
                      }
                  });
              });
          });
      });

      return {
          topTotals: Array.from(uniqueTotals.values()).sort((a, b) => b.score - a.score).slice(0, 5),
          topInnings: Array.from(uniqueInnings.values()).sort((a, b) => b.score - a.score).slice(0, 5)
      };

};
