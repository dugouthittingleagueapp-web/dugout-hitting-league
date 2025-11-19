
export type AgeGroup = string;

export interface League {
  id: string;
  created_at?: string;
}

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
  league: AgeGroup;
  season: string;
}

export interface PitchScore {
  points: number | null;
}

export interface PlayerInningScore {
  playerId: string;
  pitches: PitchScore[];
}

export interface TeamInningScore {
  teamId: string;
  playerScores: PlayerInningScore[];
}

export interface Inning {
  number: number;
  home: TeamInningScore;
  away: TeamInningScore;
}

export interface TieBreakerRound {
  roundNumber: number;
  pitchLimit: number;
  homePlayerId: string;
  awayPlayerId: string;
  homeScores: number[];
  awayScores: number[];
}

export interface Match {
  id: string;
  league: AgeGroup;
  season: string;
  homeTeamId: string;
  awayTeamId: string;
  date: string;
  isComplete: boolean;
  innings: Inning[];
  tieBreaker?: TieBreakerRound[];
}

export interface PlayerStats {
  playerId: string;
  name: string;
  totalPoints: number;
  hits4: number;
  hits3: number;
  hits2: number;
  hits1: number;
  pitchesSeen: number;
}

export interface AppState {
  view: 'league_select' | 'dashboard' | 'team_management' | 'match_setup' | 'scoring' | 'admin';
  currentLeague: AgeGroup | null;
  currentMatchId: string | null;
  season: string;
}

export interface MatchSummaryData {
  totalMatches: number;
  teams: { name: string; league: string }[];
  recentMatches: { date: string; league: string; finished: boolean }[];
}