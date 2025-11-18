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
  innings: typeof dbMatch.innings === 'string' ? JSON.parse(dbMatch.innings) : dbMatch.innings
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
  if (!res.ok) throw new Error('Failed to create league');
  return await res.json();
};

// Team Methods
export const getTeams = async (league: AgeGroup): Promise<Team[]> => {
  const res = await fetch(`/api/teams?league=${league}`);
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

export const createTeam = async (name: string, league: AgeGroup, playerNames: string[]): Promise<Team> => {
  const newTeam = {
    id: crypto.randomUUID(),
    name,
    league,
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

export const deleteTeam = async (teamId: string) => {
  await fetch(`/api/teams?id=${teamId}`, { method: 'DELETE' });
};

// Match Methods
export const getMatches = async (league: AgeGroup): Promise<Match[]> => {
  const res = await fetch(`/api/matches?league=${league}`);
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

const createEmptyInning = (number: number, homeTeamId: string, awayTeamId: string, homeLineupIds: string[], awayLineupIds: string[]): Inning => {
  const createPlayerScores = (playerIds: string[]): PlayerInningScore[] => {
    return playerIds.map(pId => ({
      playerId: pId,
      pitches: Array(10).fill(null).map(() => ({ points: null }))
    }));
  };
  return {
    number,
    home: { teamId: homeTeamId, playerScores: createPlayerScores(homeLineupIds) },
    away: { teamId: awayTeamId, playerScores: createPlayerScores(awayLineupIds) }
  };
};

export const createMatch = async (league: AgeGroup, homeTeamId: string, awayTeamId: string, homeLineupIds: string[], awayLineupIds: string[]): Promise<Match> => {
  const innings: Inning[] = Array.from({ length: 6 }, (_, i) => 
    createEmptyInning(i + 1, homeTeamId, awayTeamId, homeLineupIds, awayLineupIds)
  );
  const newMatch = {
    id: crypto.randomUUID(),
    league,
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

export const exportData = async () => {
  const teams = await getAllTeams();
  const matches = await getAllMatches();
  return JSON.stringify({ teams, matches }, null, 2);
};

// Stats Calculation
export const getTeamStats = async (team: Team, league: AgeGroup): Promise<PlayerStats[]> => {
  const matches = await getMatches(league);
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
        const stats = statsMap.get(ps.playerId);
        if (stats) {
          ps.pitches.forEach(pitch => {
            if (pitch.points !== null) {
              stats.pitchesSeen++;
              stats.totalPoints += pitch.points;
              if (pitch.points === 4) stats.hits4++;
              if (pitch.points === 3) stats.hits3++;
              if (pitch.points === 2) stats.hits2++;
              if (pitch.points === 1) stats.hits1++;
            }
          });
        }
      });
    });
  });

  return Array.from(statsMap.values());
};
