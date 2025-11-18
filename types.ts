export type AgeGroup = '9u' | '10u' | '11u';

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
  league: AgeGroup;
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

export interface Match {
  id: string;
  league: AgeGroup;
  homeTeamId: string;
  awayTeamId: string;
  date: string;
  isComplete: boolean;
  innings: Inning[];
}

export interface AppState {
  view: 'league_select' | 'dashboard' | 'team_management' | 'match_setup' | 'scoring' | 'admin';
  currentLeague: AgeGroup | null;
  currentMatchId: string | null;
}

export interface MatchSummaryData {
  totalMatches: number;
  teams: { name: string; league: string }[];
  recentMatches: { date: string; league: string; finished: boolean }[];
}