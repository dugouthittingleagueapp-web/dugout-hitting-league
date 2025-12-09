
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
        try { return crypto.randomUUID(); } catch (e) {}
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
  if (!res.ok) throw new Error('Failed to create league');
  return await res.json();
};

export const deleteLeague = async (id: string) => {
  await fetch(`/api/leagues?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
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

export const updateMatchLineup = async (matchId: string, teamId: string, newPlayer: Player, currentInningIdx: number): Promise<Match> => {
    const match = await getMatch(matchId);
    if (!match) throw new Error("Match not found");
    const isHome = match.homeTeamId === teamId;
    const newInnings = [...match.innings];

    for (let i = currentInningIdx; i < 6; i++) {
        const side = isHome ? newInnings[i].home : newInnings[i].away;
        const other = isHome ? newInnings[i].away : newInnings[i].home;
        
        const existingIds = side.playerScores.map(p => p.playerId);
        if (existingIds.includes(newPlayer.id)) continue;

        side.playerScores.push({
            playerId: newPlayer.id,
            pitches: Array(10).fill(null).map(() => ({ points: null }))
        });

        const newCount = side.playerScores.length;
        const otherCount = other.playerScores.length;

        const updatePitches = (s: any, c: number) => {
            s.playerScores.forEach((ps: any) => {
                const currentLen = ps.pitches.length;
                if (currentLen < c) {
                    const diff = c - currentLen;
                    ps.pitches.push(...Array(diff).fill(null).map(() => ({ points: null })));
                } else if (currentLen > c) {
                    ps.pitches = ps.pitches.slice(0, c);
                }
            });
        };

        if (newCount === 3) {
            updatePitches(side, 10);
            if (otherCount === 2) updatePitches(other, 15);
            else if (otherCount === 3) updatePitches(other, 10);
        }
    }
    const updated = { ...match, innings: newInnings };
    return await updateMatch(updated);
};

export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const stats = new Map<string, PlayerStats>();
    const initStat = (id: string, name: string): PlayerStats => ({
        playerId: id, name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
    });
    const allMatchPlayerIds = new Set<string>();
    match.innings.forEach(i => {
        i.home.playerScores.forEach(p => allMatchPlayerIds.add(p.playerId));
        i.away.playerScores.forEach(p => allMatchPlayerIds.add(p.playerId));
    });
    homeTeam.players.forEach(p => stats.set(p.id, initStat(p.id, formatName(p))));
    awayTeam.players.forEach(p => stats.set(p.id, initStat(p.id, formatName(p))));
    if(homeTeam.subs) homeTeam.subs.forEach(p => { if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p))); });
    if(awayTeam.subs) awayTeam.subs.forEach(p => { if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p))); });

    match.innings.forEach(inning => {
        [inning.home, inning.away].forEach(teamData => {
            const isGhostMode = teamData.playerScores.length === 2 && teamData.playerScores[0].pitches.length >= 15;
            teamData.playerScores.forEach((ps) => {
                let pStats = stats.get(ps.playerId) || initStat(ps.playerId, 'Sub');
                if (!stats.has(ps.playerId)) stats.set(ps.playerId, pStats);
                const playerPitches = isGhostMode ? ps.pitches.slice(0, 10) : ps.pitches;
                playerPitches.forEach(p => {
                    if (p.points !== null) {
                        pStats.totalPoints += p.points;
                        pStats.pitchesSeen += 1;
                        if (p.points === 4) pStats.hits4++;
                        if (p.points === 3) pStats.hits3++;
                        if (p.points === 2) pStats.hits2++;
                        if (p.points === 1) pStats.hits1++;
                    }
                });
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
                if(isMainPlayer || isSub) {
                     if(!aggStats.has(stat.playerId)) { aggStats.set(stat.playerId, { ...stat }); }
                     else {
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
    return Array.from(aggStats.values());
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

// Add moveTeams function for bulk migration
export const moveTeams = async (teamIds: string[], targetLeague: string) => {
  const res = await fetch('/api/teams', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'move_teams', teamIds, targetLeague })
  });
  if (!res.ok) throw new Error('Failed to move teams');
  return await res.json();
};
