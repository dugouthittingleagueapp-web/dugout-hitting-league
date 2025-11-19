
import { AgeGroup, Match, Team, Inning, PlayerInningScore, League, PlayerStats } from '../types';

const mapTeamFromDB = (dbTeam: any): Team => ({
  ...dbTeam,
  players: typeof dbTeam.players === 'string' ? JSON.parse(dbTeam.players) : dbTeam.players
});

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

// League Methods
export const getLeagues = async (): Promise<League[]> => {
  const res = await fetch('/api/leagues');
  if (!res.ok) return [];
  return await res.json();
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

// Team Methods
export const getTeams = async (league: AgeGroup, season: string): Promise<Team[]> => {
  const res = await fetch(`/api/teams?league=${league}&season=${season}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.map(mapTeamFromDB);
};

export const getAllTeams = async (): Promise<Team[]> => {
  const res = await fetch(`/api/teams`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.map(mapTeamFromDB);
};

export const createTeam = async (name: string, league: AgeGroup, playerNames: string[], season: string): Promise<Team> => {
  const newTeam = {
    id: crypto.randomUUID(),
    name,
    league,
    season,
    players: playerNames.map(name => ({ id: crypto.randomUUID(), name })),
  };
  const res = await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newTeam)
  });
  if (!res.ok) throw new Error('Failed to save team');
  const data = await res.json();
  return mapTeamFromDB(data);
};

export const updateTeam = async (team: Team): Promise<Team> => {
  const res = await fetch('/api/teams', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(team)
  });
  if (!res.ok) throw new Error('Failed to update team');
  const data = await res.json();
  return mapTeamFromDB(data);
};

export const deleteTeam = async (teamId: string) => {
  await fetch(`/api/teams?id=${teamId}`, { method: 'DELETE' });
};

// Match Methods
export const getMatches = async (league: AgeGroup, season: string): Promise<Match[]> => {
  const res = await fetch(`/api/matches?league=${league}&season=${season}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.map(mapMatchFromDB);
};

export const getAllMatches = async (): Promise<Match[]> => {
  const res = await fetch('/api/matches');
  if (!res.ok) return [];
  const data = await res.json();
  return data.map(mapMatchFromDB);
};

export const getMatch = async (id: string): Promise<Match | undefined> => {
  const res = await fetch(`/api/matches?id=${id}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return mapMatchFromDB(data);
};

export const createMatch = async (league: AgeGroup, homeTeamId: string, awayTeamId: string, homePlayerIds: string[], awayPlayerIds: string[], season: string): Promise<Match> => {
    const innings: Inning[] = [];
    for (let i = 1; i <= 6; i++) {
        innings.push(createEmptyInning(i, homePlayerIds, awayPlayerIds));
    }

    const match = {
        id: crypto.randomUUID(),
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
    
    if (!res.ok) throw new Error('Failed to create match');
    const data = await res.json();
    return mapMatchFromDB(data);
};

const createEmptyInning = (number: number, homeIds: string[], awayIds: string[]): Inning => {
    // LOGIC: 2v2 Strict vs 3v2 Ghost
    // If a team has 2 players and opponent has 3, the 2-player team gets 15 pitches (Ghost mode).
    // If both have 2, it is Strict 2v2 (10 pitches).
    // If both have 3, it is standard (10 pitches).

    const homePitches = (homeIds.length === 2 && awayIds.length === 3) ? 15 : 10;
    const awayPitches = (awayIds.length === 2 && homeIds.length === 3) ? 15 : 10;

    const createPlayerScore = (pid: string, count: number) => ({
        playerId: pid,
        pitches: Array(count).fill(null).map(() => ({ points: null }))
    });

    return {
        number,
        home: { teamId: 'home', playerScores: homeIds.map(id => createPlayerScore(id, homePitches)) },
        away: { teamId: 'away', playerScores: awayIds.map(id => createPlayerScore(id, awayPitches)) }
    };
};

export const updateMatch = async (match: Match): Promise<Match> => {
    const res = await fetch('/api/matches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(match)
    });
    if (!res.ok) throw new Error('Failed to update match');
    const data = await res.json();
    return mapMatchFromDB(data);
};

export const deleteMatch = async (matchId: string) => {
    await fetch(`/api/matches?id=${matchId}`, { method: 'DELETE' });
};

export const restoreTeamRoster = async (matchId: string, teamId: string, currentInningIdx: number): Promise<Match> => {
    const match = await getMatch(matchId);
    if (!match) throw new Error("Match not found");
    
    // Fetch actual team to get full player list
    const allTeams = await getAllTeams();
    const team = allTeams.find(t => t.id === teamId);
    if (!team) throw new Error("Team not found");

    const newInnings = [...match.innings];
    
    // Reset future innings.
    const startResetIdx = currentInningIdx + 1;

    for(let i = startResetIdx; i < 6; i++) {
        const oldHomeIds = newInnings[i].home.playerScores.map(p => p.playerId);
        const oldAwayIds = newInnings[i].away.playerScores.map(p => p.playerId);
        
        const isHome = match.homeTeamId === teamId;
        
        const newHomeIds = isHome ? team.players.map(p=>p.id) : oldHomeIds;
        const newAwayIds = !isHome ? team.players.map(p=>p.id) : oldAwayIds;
        
        newInnings[i] = createEmptyInning(i+1, newHomeIds, newAwayIds);
    }
    
    const updated = { ...match, innings: newInnings };
    return await updateMatch(updated);
};

// Stats Calculation Helper
export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const stats = new Map<string, PlayerStats>();
    
    const initStat = (id: string, name: string): PlayerStats => ({
        playerId: id, name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
    });
    
    // Pre-fill players
    homeTeam.players.forEach(p => stats.set(p.id, initStat(p.id, p.name)));
    awayTeam.players.forEach(p => stats.set(p.id, initStat(p.id, p.name)));
    
    // Ghost Player for 2v2 stats aggregation (optional, but good for data consistency)
    stats.set('ghost-player-3', initStat('ghost-player-3', 'Player 3 (Team Stats)'));

    match.innings.forEach(inning => {
        [inning.home, inning.away].forEach(teamData => {
            const isGhostMode = teamData.playerScores.length === 2 && teamData.playerScores[0].pitches.length >= 15;

            teamData.playerScores.forEach((ps, idx) => {
                let pStats = stats.get(ps.playerId);
                if (!pStats) {
                     // Handle sub
                     pStats = initStat(ps.playerId, 'Sub');
                     stats.set(ps.playerId, pStats);
                }

                // In Ghost mode, only first 10 pitches count for player. 11-15 go to ghost.
                const playerPitches = isGhostMode ? ps.pitches.slice(0, 10) : ps.pitches;
                const ghostPitches = isGhostMode ? ps.pitches.slice(10, 15) : [];

                const processPitch = (p: any, statObj: PlayerStats) => {
                    if (p.points !== null) {
                        statObj.totalPoints += p.points;
                        statObj.pitchesSeen += 1;
                        if (p.points === 4) statObj.hits4++;
                        if (p.points === 3) statObj.hits3++;
                        if (p.points === 2) statObj.hits2++;
                        if (p.points === 1) statObj.hits1++;
                    }
                };

                playerPitches.forEach(p => processPitch(p, pStats!));
                
                if (ghostPitches.length > 0) {
                    let ghostStats = stats.get('ghost-player-3')!;
                    ghostPitches.forEach(p => processPitch(p, ghostStats));
                }
            });
        });
    });
    
    // Process Tie Breaker
    if(match.tieBreaker) {
        match.tieBreaker.forEach(tb => {
            const addTb = (pid: string, scores: (number|null)[]) => {
                let s = stats.get(pid);
                if(!s) { s = initStat(pid, 'Unknown'); stats.set(pid, s); }
                scores.forEach(val => {
                    if(val !== null) {
                        s!.totalPoints += val;
                        s!.pitchesSeen++;
                        if (val === 4) s!.hits4++;
                        if (val === 3) s!.hits3++;
                        if (val === 2) s!.hits2++;
                        if (val === 1) s!.hits1++;
                    }
                });
            };
            addTb(tb.homePlayerId, tb.homeScores);
            addTb(tb.awayPlayerId, tb.awayScores);
        });
    }

    return Array.from(stats.values());
};

export const getTeamStats = async (team: Team, league: AgeGroup, season: string): Promise<PlayerStats[]> => {
    const matches = await getMatches(league, season);
    const teamMatches = matches.filter(m => (m.homeTeamId === team.id || m.awayTeamId === team.id) && m.isComplete);
    
    // Need all teams to cross-reference names if not in 'team' object (e.g. opponents)
    // But for getTeamStats we mainly care about 'team'.
    // Actually, calculateMatchStats needs both teams.
    const allTeams = await getAllTeams();

    const aggStats = new Map<string, PlayerStats>();
    
    teamMatches.forEach(m => {
        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        if(home && away) {
            const mStats = calculateMatchStats(m, home, away);
            mStats.forEach(stat => {
                // Only aggregate for THIS team's players
                if(team.players.find(p => p.id === stat.playerId) || stat.playerId === 'ghost-player-3') {
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

    return Array.from(aggStats.values()).filter(s => s.playerId !== 'ghost-player-3');
};

// Settings & Admin
export const verifyPassword = async (password: string): Promise<{success: boolean, role?: 'admin'|'umpire'}> => {
    const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', password })
    });
    return await res.json();
};

export const updateAdminPassword = async (password: string) => {
     await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_password', password }) });
};

export const updateUmpirePassword = async (password: string) => {
     await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_umpire_password', password }) });
};

export const getCurrentSeason = async (): Promise<string> => {
    const res = await fetch('/api/settings');
    if(!res.ok) return '2025';
    const data = await res.json();
    return data.currentSeason || '2025';
};

export const updateCurrentSeason = async (season: string) => {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_season', season }) });
};

export const exportData = async (): Promise<string> => {
    const [teams, matches, leagues] = await Promise.all([getAllTeams(), getAllMatches(), getLeagues()]);
    return JSON.stringify({ teams, matches, leagues }, null, 2);
};
