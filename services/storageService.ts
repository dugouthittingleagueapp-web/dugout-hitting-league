import { AgeGroup, Match, Team, Inning, PlayerInningScore, League, PlayerStats, Player } from '../types';

// Helper to format name as First L.
const formatName = (p: { name: string, lastName?: string }) => 
  `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;

// Robust UUID Generator that works in insecure contexts
export const generateUUID = (): string => {
    // Try native crypto first if available and secure
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {
            // Fallback if crypto throws (e.g. insecure context)
        }
    }
    // Fallback timestamp + random string generator
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// League Methods
export const getLeagues = async (): Promise<League[]> => {
  try {
      const res = await fetch('/api/leagues');
      if (!res.ok) return [];
      return await res.json();
  } catch (e) { return []; }
};

export const createLeague = async (id: string): Promise<League> => {
  const res = await fetch('/api/leagues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create league');
  }
  return await res.json();
};

export const deleteLeague = async (id: string): Promise<void> => {
    await fetch(`/api/leagues?id=${id}`, { method: 'DELETE' });
};

// Team Methods
export const getTeams = async (league: string | null, season: string): Promise<Team[]> => {
    let url = `/api/teams?season=${season}`;
    if (league) url += `&league=${league}`;
    
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        // Parse JSON fields
        return data.map((t: any) => ({
            ...t,
            players: typeof t.players === 'string' ? JSON.parse(t.players) : t.players,
            subs: t.subs ? (typeof t.subs === 'string' ? JSON.parse(t.subs) : t.subs) : []
        }));
    } catch (e) { return []; }
};

export const getAllTeams = async (): Promise<Team[]> => {
    try {
        const res = await fetch('/api/teams');
        if (!res.ok) return [];
        const data = await res.json();
        return data.map((t: any) => ({
            ...t,
            players: typeof t.players === 'string' ? JSON.parse(t.players) : t.players,
            subs: t.subs ? (typeof t.subs === 'string' ? JSON.parse(t.subs) : t.subs) : []
        }));
    } catch(e) { return []; }
};

export const createTeam = async (name: string, league: string, players: Player[], season: string, subs: Player[] = []): Promise<Team> => {
    const team: Team = {
        id: generateUUID(),
        name,
        league,
        players,
        subs,
        season
    };
    
    const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(team)
    });
    
    if(!res.ok) throw new Error("Failed to create team");
    const data = await res.json();
    return {
        ...data,
        players: typeof data.players === 'string' ? JSON.parse(data.players) : data.players,
        subs: data.subs ? (typeof data.subs === 'string' ? JSON.parse(data.subs) : data.subs) : []
    };
};

export const updateTeam = async (team: Team): Promise<Team> => {
    const res = await fetch('/api/teams', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(team)
    });
    if(!res.ok) throw new Error("Failed to update team");
    const data = await res.json();
    return {
        ...data,
        players: typeof data.players === 'string' ? JSON.parse(data.players) : data.players,
        subs: data.subs ? (typeof data.subs === 'string' ? JSON.parse(data.subs) : data.subs) : []
    };
};

export const deleteTeam = async (id: string): Promise<void> => {
    await fetch(`/api/teams?id=${id}`, { method: 'DELETE' });
};

export const moveTeams = async (teamIds: string[], targetLeague: string): Promise<void> => {
    const res = await fetch('/api/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move_teams', teamIds, targetLeague })
    });
    if(!res.ok) throw new Error("Failed to move teams");
};

// Match Methods
const mapMatchFromDB = (dbMatch: any): Match => ({
  id: dbMatch.id,
  league: dbMatch.league,
  homeTeamId: dbMatch.home_team_id,
  awayTeamId: dbMatch.away_team_id,
  date: dbMatch.date,
  isComplete: dbMatch.is_complete,
  innings: typeof dbMatch.innings === 'string' ? JSON.parse(dbMatch.innings) : dbMatch.innings,
  season: dbMatch.season || '2025',
  tieBreaker: dbMatch.tie_breaker ? (typeof dbMatch.tie_breaker === 'string' ? JSON.parse(dbMatch.tie_breaker) : dbMatch.tie_breaker) : undefined
});

export const getMatches = async (league: string, season: string): Promise<Match[]> => {
    try {
        const res = await fetch(`/api/matches?league=${league}&season=${season}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map(mapMatchFromDB);
    } catch(e) { return []; }
};

export const getAllMatches = async (): Promise<Match[]> => {
    try {
        const res = await fetch('/api/matches');
        if(!res.ok) return [];
        const data = await res.json();
        return data.map(mapMatchFromDB);
    } catch(e) { return []; }
};

export const getMatch = async (id: string): Promise<Match | null> => {
    try {
        const res = await fetch(`/api/matches?id=${id}`);
        if(!res.ok) return null;
        const data = await res.json();
        return mapMatchFromDB(data);
    } catch(e) { return null; }
};

export const createMatch = async (
  league: string, 
  homeTeamId: string, 
  awayTeamId: string, 
  homeLineupIds: string[], 
  awayLineupIds: string[], 
  season: string
): Promise<Match> => {
    // 1. Generate 6 Innings
    const innings: Inning[] = [];
    for (let i = 1; i <= 6; i++) {
        innings.push({
            number: i,
            home: {
                teamId: homeTeamId,
                playerScores: homeLineupIds.map(pid => ({
                    playerId: pid,
                    pitches: Array(10).fill({ points: null })
                }))
            },
            away: {
                teamId: awayTeamId,
                playerScores: awayLineupIds.map(pid => ({
                    playerId: pid,
                    pitches: Array(10).fill({ points: null })
                }))
            }
        });
    }

    // 2-Player Ghost Logic Check
    // If only 2 players, they get 15 pitches. We structure the DB as 2 players with 15 slots.
    // The UI handles the visual "Ghost Row".
    if (homeLineupIds.length === 2) {
        innings.forEach(ing => {
            ing.home.playerScores.forEach(ps => {
                ps.pitches = Array(15).fill({ points: null });
            });
        });
    }
    if (awayLineupIds.length === 2) {
        innings.forEach(ing => {
            ing.away.playerScores.forEach(ps => {
                ps.pitches = Array(15).fill({ points: null });
            });
        });
    }

    const match: any = {
        id: generateUUID(),
        league,
        homeTeamId,
        awayTeamId,
        date: new Date().toISOString(),
        isComplete: false,
        innings,
        season
    };

    const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(match)
    });
    
    if(!res.ok) throw new Error("Failed to create match");
    return mapMatchFromDB(await res.json());
};

export const updateMatch = async (match: Match): Promise<Match> => {
    const res = await fetch('/api/matches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(match)
    });
    if(!res.ok) throw new Error("Failed to update match");
    return mapMatchFromDB(await res.json());
};

export const deleteMatch = async (id: string): Promise<void> => {
    await fetch(`/api/matches?id=${id}`, { method: 'DELETE' });
};

// Roster Restoration Logic (Late Player Arrival)
export const restoreTeamRoster = async (matchId: string, teamId: string, currentInningIdx: number): Promise<Match> => {
    const match = await getMatch(matchId);
    if (!match) throw new Error("Match not found");

    // Fetch team to get full roster
    const allTeams = await getAllTeams();
    const team = allTeams.find(t => t.id === teamId);
    if (!team) throw new Error("Team not found");
    
    // We assume the team now has 3 players (or more) and we want to reset scoring to standard 3-player format
    // for all REMAINING innings (currentInningIdx onwards).
    
    // Get the first 3 players from the team roster as the new standard lineup
    const standardLineup = team.players.slice(0, 3);
    
    if (standardLineup.length < 3) throw new Error("Team still has less than 3 players");

    const newInnings = [...match.innings];
    
    for (let i = currentInningIdx; i < 6; i++) {
        const inning = newInnings[i];
        const isHome = inning.home.teamId === teamId;
        const targetTeamData = isHome ? inning.home : inning.away;
        
        // Reset this inning's scores for this team
        targetTeamData.playerScores = standardLineup.map(p => ({
            playerId: p.id,
            pitches: Array(10).fill({ points: null })
        }));
    }

    const updatedMatch = { ...match, innings: newInnings };
    return await updateMatch(updatedMatch);
};

// Settings & Auth
export const getCurrentSeason = async (): Promise<string> => {
    try {
        const res = await fetch('/api/settings');
        if(!res.ok) return '2025';
        const data = await res.json();
        return data.currentSeason || '2025';
    } catch(e) { return '2025'; }
};

export const updateCurrentSeason = async (season: string): Promise<void> => {
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_season', season })
    });
};

export const verifyPassword = async (password: string): Promise<{ success: boolean; role?: 'admin' | 'umpire' }> => {
    const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', password })
    });
    if(!res.ok) return { success: false };
    return await res.json();
};

export const updateAdminPassword = async (password: string) => {
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_password', password })
    });
};

export const updateUmpirePassword = async (password: string) => {
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_umpire_password', password })
    });
};

export const exportData = async (): Promise<string> => {
    const [leagues, teams, matches] = await Promise.all([
        getLeagues(),
        getAllTeams(),
        getAllMatches()
    ]);
    return JSON.stringify({ leagues, teams, matches }, null, 2);
};

// Statistics Calculations
export const calculateTeamGameTotal = (match: Match, home: Team, away: Team, side: 'home' | 'away') => {
    const baseScore = match.innings.reduce((sum, inning) => {
        const teamData = side === 'home' ? inning.home : inning.away;
        return sum + teamData.playerScores.reduce((pSum, player) => 
            pSum + player.pitches.reduce((s, p) => s + (p.points || 0), 0), 0);
    }, 0);

    let tieScore = 0;
    if (match.tieBreaker) {
        match.tieBreaker.forEach(round => {
            const scores = side === 'home' ? round.homeScores : round.awayScores;
            tieScore += scores.reduce((a, b) => (a || 0) + (b || 0), 0);
        });
    }
    return baseScore + tieScore;
};

export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const stats = new Map<string, PlayerStats>();

    // Helper to process scores
    const processScores = (playerScores: PlayerInningScore[], team: Team) => {
        // Ghost Mode Logic Check for this inning/team
        const isGhostMode = playerScores.length === 2 && playerScores[0].pitches.length >= 15;

        playerScores.forEach((ps, idx) => {
            const playerId = ps.playerId;
            const pitches = ps.pitches;
            
            // Determine Player Name
            let name = "Unknown";
            const rosterPlayer = [...team.players, ...(team.subs || [])].find(p => p.id === playerId);
            if (rosterPlayer) name = formatName(rosterPlayer);

            // Init Stat Entry
            if (!stats.has(playerId)) {
                stats.set(playerId, {
                    playerId,
                    name,
                    totalPoints: 0,
                    hits4: 0,
                    hits3: 0,
                    hits2: 0,
                    hits1: 0,
                    pitchesSeen: 0
                });
            }
            const stat = stats.get(playerId)!;

            // Count Pitches
            // In Ghost Mode: Player gets 1-10. Ghost gets 11-15.
            if (isGhostMode) {
                // Real Player Part (First 10)
                pitches.slice(0, 10).forEach(p => {
                    if (p.points !== null) {
                        stat.pitchesSeen++;
                        stat.totalPoints += p.points;
                        if (p.points === 4) stat.hits4++;
                        if (p.points === 3) stat.hits3++;
                        if (p.points === 2) stat.hits2++;
                        if (p.points === 1) stat.hits1++;
                    }
                });

                // Ghost Part (11-15) - Attribute to a "Team Ghost" ID
                const ghostId = `ghost-${team.id}`;
                if (!stats.has(ghostId)) {
                    stats.set(ghostId, {
                        playerId: ghostId,
                        name: `${team.name} (Ghost)`,
                        totalPoints: 0,
                        hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
                    });
                }
                const ghostStat = stats.get(ghostId)!;
                pitches.slice(10, 15).forEach(p => {
                    if (p.points !== null) {
                        ghostStat.pitchesSeen++;
                        ghostStat.totalPoints += p.points;
                         if (p.points === 4) ghostStat.hits4++;
                        if (p.points === 3) ghostStat.hits3++;
                        if (p.points === 2) ghostStat.hits2++;
                        if (p.points === 1) ghostStat.hits1++;
                    }
                });

            } else {
                // Standard Mode
                pitches.forEach(p => {
                    if (p.points !== null) {
                        stat.pitchesSeen++;
                        stat.totalPoints += p.points;
                        if (p.points === 4) stat.hits4++;
                        if (p.points === 3) stat.hits3++;
                        if (p.points === 2) stat.hits2++;
                        if (p.points === 1) stat.hits1++;
                    }
                });
            }
        });
    };

    match.innings.forEach(ing => {
        processScores(ing.home.playerScores, homeTeam);
        processScores(ing.away.playerScores, awayTeam);
    });
    
    // Add Tie Breaker Stats
    if(match.tieBreaker) {
        match.tieBreaker.forEach(round => {
            // Home
            const homeId = round.homePlayerId;
            if(stats.has(homeId)) {
                const s = stats.get(homeId)!;
                round.homeScores.forEach(pt => {
                    if(pt !== null) {
                        s.pitchesSeen++;
                        s.totalPoints += pt;
                        if(pt===4) s.hits4++;
                        if(pt===3) s.hits3++;
                        if(pt===2) s.hits2++;
                        if(pt===1) s.hits1++;
                    }
                });
            }
            // Away
            const awayId = round.awayPlayerId;
            if(stats.has(awayId)) {
                const s = stats.get(awayId)!;
                round.awayScores.forEach(pt => {
                     if(pt !== null) {
                        s.pitchesSeen++;
                        s.totalPoints += pt;
                        if(pt===4) s.hits4++;
                        if(pt===3) s.hits3++;
                        if(pt===2) s.hits2++;
                        if(pt===1) s.hits1++;
                    }
                });
            }
        });
    }

    return Array.from(stats.values());
};

export const getTeamStats = async (team: Team, league: string, season: string): Promise<PlayerStats[]> => {
    const matches = await getMatches(league, season);
    const teamMatches = matches.filter(m => (m.homeTeamId === team.id || m.awayTeamId === team.id) && m.isComplete);
    
    // We need the opponent team data for calculateMatchStats to work correctly (names, etc)
    // Optimization: We could fetch all teams once, but here we'll just fetch all.
    const allTeams = await getAllTeams();
    
    const aggregatedStats = new Map<string, PlayerStats>();

    teamMatches.forEach(m => {
        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        if(!home || !away) return;

        const matchStats = calculateMatchStats(m, home, away);
        
        matchStats.forEach(stat => {
            // Filter only players from THIS team
            // Check via ID if they are in the team roster/subs
            const isMember = [...team.players, ...(team.subs || [])].some(p => p.id === stat.playerId) || stat.playerId === `ghost-${team.id}`;
            
            if(isMember) {
                if(!aggregatedStats.has(stat.playerId)) {
                    aggregatedStats.set(stat.playerId, { ...stat });
                } else {
                    const ex = aggregatedStats.get(stat.playerId)!;
                    ex.totalPoints += stat.totalPoints;
                    ex.hits4 += stat.hits4;
                    ex.hits3 += stat.hits3;
                    ex.hits2 += stat.hits2;
                    ex.hits1 += stat.hits1;
                    ex.pitchesSeen += stat.pitchesSeen;
                }
            }
        });
    });

    return Array.from(aggregatedStats.values());
};
