
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

export const deleteMatch = async (matchId: string) => {
  await fetch(`/api/matches?id=${matchId}`, { method: 'DELETE' });
};

// Inning Creation Logic
const createEmptyInning = (number: number, homeTeamId: string, awayTeamId: string, homeLineupIds: string[], awayLineupIds: string[]): Inning => {
  
  // STRICT 2v2 MODE: If BOTH teams have exactly 2 players, 10 pitches each. NO Ghost mode.
  const isStrict2v2 = homeLineupIds.length === 2 && awayLineupIds.length === 2;

  const createPlayerScores = (playerIds: string[]): PlayerInningScore[] => {
    let pitchCount = 10; // Default

    if (!isStrict2v2 && playerIds.length === 2) {
        // Asymmetric 2-player team (One team has 3, one has 2 -> Ghost mode needed for the 2-player team)
        pitchCount = 15;
    }
    // If isStrict2v2, pitchCount remains 10.
    
    return playerIds.map(pId => ({
      playerId: pId,
      pitches: Array(pitchCount).fill(null).map(() => ({ points: null }))
    }));
  };
  
  return {
    number,
    home: { teamId: homeTeamId, playerScores: createPlayerScores(homeLineupIds) },
    away: { teamId: awayTeamId, playerScores: createPlayerScores(awayLineupIds) }
  };
};

export const createMatch = async (league: AgeGroup, homeTeamId: string, awayTeamId: string, homeLineupIds: string[], awayLineupIds: string[], season: string): Promise<Match> => {
  const innings: Inning[] = Array.from({ length: 6 }, (_, i) => 
    createEmptyInning(i + 1, homeTeamId, awayTeamId, homeLineupIds, awayLineupIds)
  );
  const newMatch = {
    id: crypto.randomUUID(),
    league,
    season,
    homeTeamId,
    awayTeamId,
    date: new Date().toISOString(),
    isComplete: false,
    innings
  };
  const res = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newMatch)
  });
  if (!res.ok) throw new Error('Failed to create match');
  const data = await res.json();
  return mapMatchFromDB(data);
};

export const updateMatch = async (updatedMatch: Match) => {
  await fetch('/api/matches', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedMatch)
  });
};

export const restoreTeamRoster = async (matchId: string, teamId: string, startInningIdx: number): Promise<Match> => {
  const match = await getMatch(matchId);
  if (!match) throw new Error("Match not found");
  
  const allTeams = await getAllTeams();
  const team = allTeams.find(t => t.id === teamId);
  if (!team) throw new Error("Team not found");

  const isHome = match.homeTeamId === teamId;
  const updatedMatch = { ...match };

  for (let i = startInningIdx; i < updatedMatch.innings.length; i++) {
    const inning = updatedMatch.innings[i];
    const side = isHome ? inning.home : inning.away;
    
    side.playerScores = team.players.map(p => ({
      playerId: p.id,
      pitches: Array(10).fill(null).map(() => ({ points: null })) // Reset to 10 pitches
    }));
  }

  await updateMatch(updatedMatch);
  return updatedMatch;
};

export const exportData = async () => {
  const teams = await getAllTeams();
  const matches = await getAllMatches();
  return JSON.stringify({ teams, matches }, null, 2);
};

// GHOST PLAYER CONSTANTS
const GHOST_PLAYER_ID = 'ghost-player-3';
const GHOST_PLAYER_NAME = 'Player 3 (Team Stats)';

// Helper to process stats
const processPlayerStats = (statsMap: Map<string, PlayerStats>, playerId: string, pitches: { points: number | null }[]) => {
    pitches.forEach((pitch, pitchIndex) => {
        if (pitch.points !== null) {
            let targetId = playerId;
            
            // Ghost Logic: If array length is >10, pitch index >= 10 goes to Ghost
            if (pitches.length > 10 && pitchIndex >= 10) {
                targetId = GHOST_PLAYER_ID;
                if (!statsMap.has(GHOST_PLAYER_ID)) {
                    statsMap.set(GHOST_PLAYER_ID, {
                        playerId: GHOST_PLAYER_ID,
                        name: GHOST_PLAYER_NAME,
                        totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
                    });
                }
            }

            const stats = statsMap.get(targetId);
            if (stats) {
                stats.pitchesSeen++;
                stats.totalPoints += pitch.points;
                if (pitch.points === 4) stats.hits4++;
                if (pitch.points === 3) stats.hits3++;
                if (pitch.points === 2) stats.hits2++;
                if (pitch.points === 1) stats.hits1++;
            }
        }
    });
};

export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const statsMap = new Map<string, PlayerStats>();

    [...homeTeam.players, ...awayTeam.players].forEach(p => {
        statsMap.set(p.id, {
            playerId: p.id, name: p.name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
        });
    });

    match.innings.forEach(inning => {
        const processSide = (side: 'home'|'away') => {
            const teamData = side === 'home' ? inning.home : inning.away;
            teamData.playerScores.forEach(ps => {
                if (!statsMap.has(ps.playerId)) {
                     statsMap.set(ps.playerId, {
                        playerId: ps.playerId, name: 'Substitute / Unknown', totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
                    });
                }
                processPlayerStats(statsMap, ps.playerId, ps.pitches);
            });
        };
        processSide('home');
        processSide('away');
    });

    return Array.from(statsMap.values());
};

export const getTeamStats = async (team: Team, league: AgeGroup, season: string): Promise<PlayerStats[]> => {
  const matches = await getMatches(league, season);
  const statsMap = new Map<string, PlayerStats>();
  
  team.players.forEach(p => {
    statsMap.set(p.id, {
      playerId: p.id, name: p.name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
    });
  });

  matches.filter(m => m.isComplete).forEach(match => {
    match.innings.forEach(inning => {
      let teamScores: PlayerInningScore[] = [];
      if (inning.home.teamId === team.id) teamScores = inning.home.playerScores;
      else if (inning.away.teamId === team.id) teamScores = inning.away.playerScores;

      teamScores.forEach(ps => {
        if (!statsMap.has(ps.playerId)) {
            const pName = team.players.find(p => p.id === ps.playerId)?.name || 'Unknown Sub';
            statsMap.set(ps.playerId, {
                playerId: ps.playerId, name: pName, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
            });
        }
        processPlayerStats(statsMap, ps.playerId, ps.pitches);
      });
    });
  });

  return Array.from(statsMap.values());
};

// Auth & Settings
export const verifyPassword = async (password: string): Promise<{ success: boolean; role: 'admin' | 'umpire' | null }> => {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', password })
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, role: data.role };
    }
    return { success: false, role: null };
  } catch (e) {
    console.error(e);
    return { success: false, role: null };
  }
};

export const updateAdminPassword = async (password: string): Promise<void> => {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_password', password })
  });
  if (!res.ok) throw new Error("Failed to update admin password");
};

export const updateUmpirePassword = async (password: string): Promise<void> => {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_umpire_password', password })
  });
  if (!res.ok) throw new Error("Failed to update umpire password");
};

export const getCurrentSeason = async (): Promise<string> => {
  try {
      const res = await fetch('/api/settings');
      if (res.ok) {
          const data = await res.json();
          return data.currentSeason || '2025';
      }
  } catch (e) {
      console.error(e);
  }
  return '2025';
};

export const updateCurrentSeason = async (season: string): Promise<void> => {
    const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_season', season })
    });
    if (!res.ok) throw new Error("Failed to update season");
};
