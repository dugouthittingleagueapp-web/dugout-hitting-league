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
  season: dbMatch.season || '2025'
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

// Updated to handle variable pitch counts (15 for 2 players, 10 for others)
const createEmptyInning = (number: number, homeTeamId: string, awayTeamId: string, homeLineupIds: string[], awayLineupIds: string[]): Inning => {
  const createPlayerScores = (playerIds: string[]): PlayerInningScore[] => {
    // Determine pitches per player. Standard is 30 total. 
    // If 2 players, 15 each. If 3 players, 10 each. Default to 10 otherwise.
    const pitchCount = playerIds.length === 2 ? 15 : 10;
    
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

// Restore full roster for a team from a specific inning onwards
export const restoreTeamRoster = async (matchId: string, teamId: string, startInningIdx: number): Promise<Match> => {
  // 1. Fetch fresh match data
  const match = await getMatch(matchId);
  if (!match) throw new Error("Match not found");
  
  // 2. Fetch full team data to get the complete roster
  const allTeams = await getAllTeams();
  const team = allTeams.find(t => t.id === teamId);
  if (!team) throw new Error("Team not found");

  const isHome = match.homeTeamId === teamId;
  const updatedMatch = { ...match };

  // 3. Regenerate innings from startInningIdx to end
  for (let i = startInningIdx; i < updatedMatch.innings.length; i++) {
    const inning = updatedMatch.innings[i];
    const side = isHome ? inning.home : inning.away;
    
    // Reset to full 3-player roster, 10 pitches each
    side.playerScores = team.players.map(p => ({
      playerId: p.id,
      pitches: Array(10).fill(null).map(() => ({ points: null }))
    }));
  }

  // 4. Save updates
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

// Helper to process stats for a single player entry
// Handles redirecting pitches 11-15 (indices 10-14) to Ghost Player
const processPlayerStats = (statsMap: Map<string, PlayerStats>, playerId: string, pitches: { points: number | null }[]) => {
    pitches.forEach((pitch, pitchIndex) => {
        if (pitch.points !== null) {
            let targetId = playerId;
            
            // Redirect logic: If index >= 10 (11th pitch), assign to Ghost Player
            if (pitchIndex >= 10) {
                targetId = GHOST_PLAYER_ID;
                // Ensure Ghost Player entry exists
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

// Stats Calculation
export const calculateMatchStats = (match: Match, homeTeam: Team, awayTeam: Team): PlayerStats[] => {
    const statsMap = new Map<string, PlayerStats>();

    // Initialize for both teams
    [...homeTeam.players, ...awayTeam.players].forEach(p => {
        statsMap.set(p.id, {
            playerId: p.id,
            name: p.name,
            totalPoints: 0,
            hits4: 0,
            hits3: 0,
            hits2: 0,
            hits1: 0,
            pitchesSeen: 0
        });
    });

    // Process Innings
    match.innings.forEach(inning => {
        const processSide = (side: 'home'|'away') => {
            const teamData = side === 'home' ? inning.home : inning.away;
            teamData.playerScores.forEach(ps => {
                // Make sure we have a base entry for this player if they were a sub
                if (!statsMap.has(ps.playerId)) {
                     // Try to find name in match context if possible, otherwise Unknown
                     // In a real scenario we might fetch team again, but for now we init basic
                     statsMap.set(ps.playerId, {
                        playerId: ps.playerId,
                        name: 'Substitute / Unknown', 
                        totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
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
  // Initialize stats map
  const statsMap = new Map<string, PlayerStats>();
  
  team.players.forEach(p => {
    statsMap.set(p.id, {
      playerId: p.id,
      name: p.name,
      totalPoints: 0,
      hits4: 0,
      hits3: 0,
      hits2: 0,
      hits1: 0,
      pitchesSeen: 0
    });
  });

  // Iterate over completed matches
  matches.filter(m => m.isComplete).forEach(match => {
    // Find team's data in innings
    match.innings.forEach(inning => {
      let teamScores: PlayerInningScore[] = [];
      if (inning.home.teamId === team.id) teamScores = inning.home.playerScores;
      else if (inning.away.teamId === team.id) teamScores = inning.away.playerScores;

      teamScores.forEach(ps => {
        // Handle Subs that might not be in original team roster iteration
        if (!statsMap.has(ps.playerId)) {
            // We try to find them in the current team object (maybe updated)
            const pName = team.players.find(p => p.id === ps.playerId)?.name || 'Unknown Sub';
            statsMap.set(ps.playerId, {
                playerId: ps.playerId,
                name: pName,
                totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
            });
        }
        processPlayerStats(statsMap, ps.playerId, ps.pitches);
      });
    });
  });

  return Array.from(statsMap.values());
};

// Admin / Settings
export const verifyPassword = async (password: string): Promise<{ success: boolean; role: 'admin' | 'umpire' | null }> => {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', password })
    });
    if (res.ok) {
      const data = await res.json();
      // API returns { success: true, role: 'admin' | 'umpire' }
      return { success: true, role: data.role };
    }
    return { success: false, role: null };
  } catch (e) {
    console.error(e);
    return { success: false, role: null };
  }
};

// Specifically updates Admin password
export const updateAdminPassword = async (password: string): Promise<void> => {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_password', password })
  });
  if (!res.ok) throw new Error("Failed to update admin password");
};

// Specifically updates Umpire password
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
