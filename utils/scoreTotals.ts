import type { Inning, Match } from '../types';

// One set of score-total rules is shared by scoring, standings, and
// the dashboard. Practice games and tie-breaker rounds use these totals too.
export const calculateTeamInningTotal = (side: 'home' | 'away', inning?: Inning): number => {
    if (!inning) return 0;
    const teamData = side === 'home' ? inning.home : inning.away;
    if (!teamData?.playerScores) return 0;
    return teamData.playerScores.reduce((sum, player) => sum + (player.pitches || []).reduce((pSum, pitch) => pSum + (pitch.points || 0), 0), 0);
};

export const calculateTeamGameTotal = (side: 'home' | 'away', matchData?: Match | null): number => {
    if (!matchData?.innings) return 0;
    const baseScore = matchData.innings.reduce((sum, inning) => sum + calculateTeamInningTotal(side, inning), 0);
    let tieScore = 0;
    if (matchData.tieBreaker && Array.isArray(matchData.tieBreaker)) {
        matchData.tieBreaker.forEach(round => {
            const scores = side === 'home' ? round.homeScores : round.awayScores;
            if (Array.isArray(scores)) {
                tieScore += scores.reduce<number>((a, b) => (a || 0) + (b || 0), 0);
            }
        });
    }
    return baseScore + tieScore;
};

/** Score summary shared by dashboard cards and the official scoring screen. */
export const getMatchScores = (match: Match): { home: number; away: number } => ({
  home: calculateTeamGameTotal('home', match),
  away: calculateTeamGameTotal('away', match),
});
