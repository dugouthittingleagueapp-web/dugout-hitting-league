
import { AgeGroup, Match, Team, Inning, PlayerInningScore, League, PlayerStats, Player } from '../types';

const mapTeamFromDB = (dbTeam: any): Team => ({
  ...dbTeam,
  players: typeof dbTeam.players === 'string' ? JSON.parse(dbTeam.players) : dbTeam.players,
  subs: dbTeam.subs ? (typeof dbTeam.subs === 'string' ? JSON.parse(dbTeam.subs) : dbTeam.subs) : []
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

const formatName = (p: { name: string, lastName?: string }) => 
  `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;

export const generateUUID = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {}
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

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

export const deleteLeague = async (id: string) => {
  const res = await fetch(`/api/leagues?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete league');
};

export const getTeams = async (league: AgeGroup | null, season: string): Promise<Team[]> => {
  let url = `/api/teams?season=${season}`;
  if (league) url += `&league=${league}`;
  
  const res = await fetch(url);
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

export const createTeam = async (name: string, league: AgeGroup, players: {name: string, lastName?: string}[], season: string, subs: {name: string, lastName?: string}[] = []): Promise<Team> => {
  const newTeam = {
    id: generateUUID(),
    name,
    league,
    season,
    players: players.map(p => ({ id: generateUUID(), name: p.name, lastName: p.lastName })),
    subs: subs.map(s => ({ id: generateUUID(), name: s.name, lastName: s.lastName }))
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

export const moveTeams = async (teamIds: string[], targetLeague: string): Promise<void> => {
  const res = await fetch('/api/teams', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'move_teams', teamIds, targetLeague })
  });
  if (!res.ok) throw new Error('Failed to move teams');
};

export const deleteTeam = async (teamId: string) => {
  await fetch(`/api/teams?id=${teamId}`, { method: 'DELETE' });
};

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
    
    if (!res.ok) throw new Error('Failed to create match');
    const data = await res.json();
    return mapMatchFromDB(data);
};

const createEmptyInning = (number: number, homeIds: string[], awayIds: string[]): Inning => {
    let homePitches = 10;
    let awayPitches = 10;

    const homeCount = homeIds.length;
    const awayCount = awayIds.length;

    if (homeCount === 2 && awayCount === 3) homePitches = 15;
    else if (awayCount === 2 && homeCount === 3) awayPitches = 15;

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

export const restoreTeamRoster = async (
    matchId: string, 
    teamId: string, 
    currentInningIdx: number, 
    playerToInsert: Player
): Promise<Match> => {
    const match = await getMatch(matchId);
    if (!match) throw new Error("Match not found");
    
    const allTeams = await getAllTeams();
    const team = allTeams.find(t => t.id === teamId);
    if (!team) throw new Error("Team not found");

    const isMaster = team.players.some(p => p.id === playerToInsert.id);
    const isExistingSub = team.subs?.some(s => s.id === playerToInsert.id);
    if (!isMaster && !isExistingSub) {
        team.subs = [...(team.subs || []), playerToInsert];
        await updateTeam(team);
    }

    const newInnings = [...match.innings];
    const isHome = match.homeTeamId === teamId;

    for(let i = currentInningIdx; i < 6; i++) {
        const teamInningScore = isHome ? newInnings[i].home : newInnings[i].away;
        const currentInningIds = teamInningScore.playerScores.map(p => p.playerId);
        
        if (!currentInningIds.includes(playerToInsert.id)) {
            const newPlayerScores = teamInningScore.playerScores.map(ps => ({
                ...ps,
                pitches: ps.pitches.length > 10 ? ps.pitches.slice(0, 10) : ps.pitches
            }));

            newPlayerScores.push({
                playerId: playerToInsert.id,
                pitches: Array(10).fill(null).map(() => ({ points: null }))
            });

            if (isHome) newInnings[i].home.playerScores = newPlayerScores;
            else newInnings[i].away.playerScores = newPlayerScores;
        }
    }
    
    const updated = { ...match, innings: newInnings };
    return await updateMatch(updated);
};

export const updateMatchLineup = async (
    matchId: string,
    teamId: string,
    inningIdx: number,
    newLineupIds: string[]
): Promise<Match> => {
    const match = await getMatch(matchId);
    if (!match) throw new Error("Match not found");

    const isHome = match.homeTeamId === teamId;
    const oppTeamId = isHome ? match.awayTeamId : match.homeTeamId;
    const newInnings = [...match.innings];

    // Determine opposite team count to check for ghost mode
    const oppTeamCount = newInnings[inningIdx][isHome ? 'away' : 'home'].playerScores.length;
    const isDownsized = newLineupIds.length === 2 && oppTeamCount === 3;
    const pitchCount = isDownsized ? 15 : 10;

    for (let i = inningIdx; i < 6; i++) {
        const currentTeamData = isHome ? newInnings[i].home : newInnings[i].away;
        const oldScores = new Map<string, PlayerInningScore>();
        currentTeamData.playerScores.forEach(ps => oldScores.set(ps.playerId, ps));

        const updatedPlayerScores: PlayerInningScore[] = newLineupIds.map(pid => {
            const existing = oldScores.get(pid);
            if (existing) {
                // Resize if switching to/from ghost mode
                let updatedPitches = [...existing.pitches];
                if (updatedPitches.length < pitchCount) {
                    const extra = Array(pitchCount - updatedPitches.length).fill(null).map(() => ({ points: null }));
                    updatedPitches = [...updatedPitches, ...extra];
                } else if (updatedPitches.length > pitchCount) {
                    updatedPitches = updatedPitches.slice(0, pitchCount);
                }
                return { ...existing, pitches: updatedPitches };
            }
            // New player in lineup
            return {
                playerId: pid,
                pitches: Array(pitchCount).fill(null).map(() => ({ points: null }))
            };
        });

        if (isHome) newInnings[i].home.playerScores = updatedPlayerScores;
        else newInnings[i].away.playerScores = updatedPlayerScores;
    }

    return await updateMatch({ ...match, innings: newInnings });
};

export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const stats = new Map<string, PlayerStats>();
    
    const initStat = (id: string, name: string): PlayerStats => ({
        playerId: id, name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0, gp: 1
    });
    
    const allMatchPlayerIds = new Set<string>();
    match.innings.forEach(i => {
        i.home.playerScores.forEach(p => allMatchPlayerIds.add(p.playerId));
        i.away.playerScores.forEach(p => allMatchPlayerIds.add(p.playerId));
    });

    homeTeam.players.forEach(p => { if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p))); });
    awayTeam.players.forEach(p => { if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p))); });
    
    if(homeTeam.subs) {
        homeTeam.subs.forEach(p => {
            if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p)));
        });
    }
    if(awayTeam.subs) {
        awayTeam.subs.forEach(p => {
            if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p)));
        });
    }

    match.innings.forEach(inning => {
        [inning.home, inning.away].forEach(teamData => {
            const isGhostMode = teamData.playerScores.length === 2 && teamData.playerScores[0].pitches.length >= 15;
            const actualTeamId = teamData.teamId === 'home' ? match.homeTeamId : match.awayTeamId;
            const ghostId = `ghost-${actualTeamId}`;

            teamData.playerScores.forEach((ps, idx) => {
                let pStats = stats.get(ps.playerId);
                if (!pStats) {
                     pStats = initStat(ps.playerId, ps.playerId.startsWith('ghost') ? 'Ghost' : 'Sub');
                     stats.set(ps.playerId, pStats);
                }

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
    
    if(match.tieBreaker) {
        match.tieBreaker.forEach(tb => {
            const addTb = (pid: string, scores: (number|null)[]) => {
                let s = stats.get(pid);
                if(!s) { 
                     const allP = [...homeTeam.players, ...(homeTeam.subs||[]), ...awayTeam.players, ...(awayTeam.subs||[])];
                     const found = allP.find(p=>p.id===pid);
                     s = initStat(pid, found ? formatName(found) : 'Unknown'); 
                     stats.set(pid, s); 
                }
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
    
    const allTeams = await getAllTeams();

    const aggStats = new Map<string, PlayerStats>();
    
    teamMatches.forEach(m => {
        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        if(home && away) {
            const mStats = calculateMatchStats(m, home, away);
            mStats.forEach(stat => {
                const isMainPlayer = team.players.some(p => p.id === stat.playerId);
                const isSub = team.subs && team.subs.some(p => p.id === stat.playerId);
                const isGhost = stat.playerId === `ghost-${team.id}`;

                if(isMainPlayer || isSub || isGhost) {
                     if(!aggStats.has(stat.playerId)) {
                         aggStats.set(stat.playerId, { ...stat });
                     } else {
                         const ex = aggStats.get(stat.playerId)!;
                         ex.gp += stat.gp;
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
