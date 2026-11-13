import type { Match, Team, PlayerStats } from '../types';

// Preserve the legacy first-name + last-initial display format.
const formatName = (p: { name: string, lastName?: string }) =>
  `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;

// Stats Calculation Helper
export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const stats = new Map<string, PlayerStats>();
    
    const initStat = (id: string, name: string): PlayerStats => ({
        playerId: id, name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
    });
    
    // Pre-fill players AND subs from the match data
    // We must iterate the match innings to catch players who might be subs
    const allMatchPlayerIds = new Set<string>();
    (match.innings || []).forEach(i => {
        (i?.home?.playerScores || []).forEach(p => allMatchPlayerIds.add(p.playerId));
        (i?.away?.playerScores || []).forEach(p => allMatchPlayerIds.add(p.playerId));
    });

    // Add team players with FORMATTED names
    (homeTeam?.players || []).forEach(p => stats.set(p.id, initStat(p.id, formatName(p))));
    (awayTeam?.players || []).forEach(p => stats.set(p.id, initStat(p.id, formatName(p))));
    
    // Add any subs that might be in the match but not main roster
    // Check home subs
    if(homeTeam?.subs) {
        homeTeam.subs.forEach(p => {
            if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p)));
        });
    }
    // Check away subs
    if(awayTeam?.subs) {
        awayTeam.subs.forEach(p => {
            if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p)));
        });
    }

    (match.innings || []).forEach(inning => {
        if (!inning) return;
        [inning.home, inning.away].forEach(teamData => {
            if (!teamData?.playerScores) return;
            const isGhostMode = teamData.playerScores.length === 2 && (teamData.playerScores[0]?.pitches?.length || 0) >= 15;
            const actualTeamId = teamData.teamId === 'home' ? match.homeTeamId : match.awayTeamId;
            const ghostId = `ghost-${actualTeamId}`; // Unique ID for this team's ghost

            teamData.playerScores.forEach((ps) => {
                if (!ps) return;
                let pStats = stats.get(ps.playerId);
                if (!pStats) {
                     // Handle unknown sub (shouldn't happen if subs array is sync'd, but safety fallback)
                     pStats = initStat(ps.playerId, 'Sub');
                     stats.set(ps.playerId, pStats);
                }

                // In Ghost mode, only first 10 pitches count for player. 11-15 go to ghost.
                const pitches = ps.pitches || [];
                const playerPitches = isGhostMode ? pitches.slice(0, 10) : pitches;
                const ghostPitches = isGhostMode ? pitches.slice(10, 15) : [];

                const processPitch = (p: any, statObj: PlayerStats) => {
                    if (p && p.points !== null && p.points !== undefined) {
                        const val = Number(p.points);
                        if (!isNaN(val)) {
                            statObj.totalPoints += val;
                            statObj.pitchesSeen += 1;
                            if (val === 4) statObj.hits4++;
                            else if (val === 3) statObj.hits3++;
                            else if (val === 2) statObj.hits2++;
                            else if (val === 1) statObj.hits1++;
                        }
                    }
                };

                playerPitches.forEach(p => processPitch(p, pStats!));
                
                if (ghostPitches.length > 0) {
                    let ghostStats = stats.get(ghostId);
                    if (!ghostStats) {
                        ghostStats = initStat(ghostId, 'Player 3 (Ghost)');
                        stats.set(ghostId, ghostStats);
                    }
                    ghostPitches.forEach(p => processPitch(p, ghostStats!));
                }
            });
        });
    });
    
    // Process Tie Breaker
    if(match.tieBreaker && Array.isArray(match.tieBreaker)) {
        match.tieBreaker.forEach(tb => {
            if (!tb) return;
            const addTb = (pid: string, scores: (number|null)[]) => {
                if (!pid || !Array.isArray(scores)) return;
                let s = stats.get(pid);
                if(!s) { 
                     // Try to find name in teams/subs if not init
                     const allP = [...(homeTeam?.players || []), ...(homeTeam?.subs||[]), ...(awayTeam?.players || []), ...(awayTeam?.subs||[])];
                     const found = allP.find(p=>p.id===pid);
                     s = initStat(pid, found ? formatName(found) : 'Unknown'); 
                     stats.set(pid, s); 
                }
                scores.forEach(val => {
                    if(val !== null && val !== undefined) {
                        const num = Number(val);
                        if (!isNaN(num)) {
                            s!.totalPoints += num;
                            s!.pitchesSeen++;
                            if (num === 4) s!.hits4++;
                            else if (num === 3) s!.hits3++;
                            else if (num === 2) s!.hits2++;
                            else if (num === 1) s!.hits1++;
                        }
                    }
                });
            };
            addTb(tb.homePlayerId, tb.homeScores);
            addTb(tb.awayPlayerId, tb.awayScores);
        });
    }

    // Filter out ghost players before returning for UI display
    return Array.from(stats.values()).filter(s => !s.playerId.startsWith('ghost-'));
};

