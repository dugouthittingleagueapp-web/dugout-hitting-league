
export type AgeGroup = string;

export interface League {
  id: string;
  season?: string;
  created_at?: string;
}

export interface Player {
  id: string;
  name: string; // Used as First Name / Display Name
  lastName?: string; // Admin/Umpire clarity only
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
  subs?: Player[];
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
  homeScores: (number | null)[]; // Changed to allow null initialization
  awayScores: (number | null)[]; // Changed to allow null initialization
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
  location?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
}

export interface ScheduledGameRecord {
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  group: string;
  homeTeamName: string;
  awayTeamName: string;
  notes?: string;
  scheduledIsoDate: string;
  season: string;
}

export interface ScheduleImportSummary {
  totalRows: number;
  createdMatches: number;
  skippedDuplicates: number;
  createdTeams: string[];
  createdLeagues: string[];
  errors: string[];
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
  dashboardTab?: 'matches' | 'standings' | 'season_stats';
}

export interface MatchSummaryData {
  totalMatches: number;
  teams: { name: string; league: string }[];
  recentMatches: { date: string; league: string; finished: boolean }[];
}

export interface PlayerSeasonStatRow {
  season: string;
  leagueId: string;
  teamName: string;
  gamesPlayed: number;
  totalPoints: number;
  hits4: number;
  hits3: number;
  hits2: number;
  hits1: number;
  pitchesSeen: number;
  pointsPerPitch: number; // totalPoints / pitchesSeen
  hitPercentage: number;   // (hits4 + hits3 + hits2 + hits1) / pitchesSeen * 100
}

export interface PlayerCareerSummary {
  playerName: string;
  seasons: PlayerSeasonStatRow[];
  careerTotals: {
    seasonsCount: number;
    gamesPlayed: number;
    totalPoints: number;
    hits4: number;
    hits3: number;
    hits2: number;
    hits1: number;
    pitchesSeen: number;
    pointsPerPitch: number;
    hitPercentage: number;
  };
  seasonAverages: {
    gamesPlayed: number;
    totalPoints: number;
    hits4: number;
    hits3: number;
    hits2: number;
    hits1: number;
    pitchesSeen: number;
  };
}