import type { Match, Team, League } from '../types';
import { scheduleConflicts, conflictDescription } from '../utils/scheduleConflicts.js';
import { scheduleDateKey, scheduleDateTimeError, canonicalCage, scheduleTimeMinutes } from '../utils/scheduleValidation.js';
import { validateScoreState } from './scoringValidation.js';
import { hasRecordedScores } from './matchWritePolicy.js';
import { leaguesMatch } from '../utils/leagueNames.js';

export type ReadinessIssue = { code: string; state: 'attention' | 'blocked'; message: string; screen: 'schedule' | 'rosters' | 'game' };
export type ReadyGame = { id: string; date: string; startTime: string; endTime: string; location: string; league: string; home: string; away: string; status: string; state: 'ready' | 'attention' | 'blocked'; issues: ReadinessIssue[]; checks: string[] };
export type ReadinessResult = { season: string; date: string; dates: string[]; checkedAt: string; games: ReadyGame[] };
export const leagueToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const dateText = (value: unknown) => value instanceof Date ? value.toISOString() : String(value || '');

/** Pure/read-only assessment. Incomplete weekly selections do not prohibit game entry. */
export const assessGameDay = (season: string, date: string, matches: Match[], teams: Team[], leagues: League[], now = new Date()): ReadinessResult => {
  const official = matches.filter(m => m.season === season && !m.isPractice && !m.is_practice).map(m => ({...m,date:dateText(m.date)}));
  const conflicts = scheduleConflicts(official);
  const rosterMap = new Map(teams.map(t => [t.id,t]));
  const games = official.filter(m => scheduleDateKey(m.date) === date).map(m => {
    const home = rosterMap.get(m.homeTeamId), away = rosterMap.get(m.awayTeamId);
    const issues: ReadinessIssue[] = [];
    const checks: string[] = [];
    const add = (code: string, state: ReadinessIssue['state'], message: string, screen: ReadinessIssue['screen']) => issues.push({code,state,message,screen});
    if (!home || !away || home.id === away.id) add('TEAMS_MISSING','blocked','Choose two different existing teams for this game.','schedule');
    else if (!leagues.some(l => l.season === season && leaguesMatch(l.id,m.league)) || [home,away].some(t => t.season !== season || !leaguesMatch(t.league,m.league))) add('TEAM_DESTINATION','blocked','The teams must belong to this game’s league and season.','schedule');
    else checks.push('Teams belong to this league and season.');
    const calendarError = scheduleDateTimeError(m.date,m.startTime || '',m.endTime || '');
    if (calendarError || !canonicalCage(m.location)) add('BOOKING_INVALID','attention',calendarError || 'Choose Tunnels 5/6 or Tunnels 7/8.','schedule');
    else checks.push('Date, times and tunnels are valid.');
    for (const c of conflicts.filter(c => c.firstId === m.id || c.secondId === m.id)) add('SCHEDULE_CONFLICT','attention',conflictDescription(c,id => rosterMap.get(id)?.name || 'This team'),'schedule');
    if (!conflicts.some(c => c.firstId === m.id || c.secondId === m.id)) checks.push('No overlapping cage or team bookings.');
    let validRosters = !!home && !!away;
    for (const t of [home,away]) {
      if (!t) continue;
      if (!Array.isArray(t.players) || !Array.isArray(t.subs ?? [])) {
        validRosters=false; add('ROSTER_INVALID','blocked',`${t.name} has an unreadable roster. Review it before starting.`,'rosters'); continue;
      }
      const roster=[...t.players,...(t.subs || [])];
      if (!roster.length || roster.some(p => !p || typeof p.id !== 'string' || !p.id.trim() || typeof p.name !== 'string' || !p.name.trim()) || new Set(roster.map(p=>p?.id)).size !== roster.length) {
        validRosters=false; add('ROSTER_IDENTIFIERS','blocked',`${t.name} needs a roster with named players and different player IDs.`,'rosters');
      } else if (roster.length < 2) add('LINEUP_PLAYERS','attention',`${t.name} has one player listed. Confirm a substitute or the game arrangement before starting.`,'rosters');
    }
    if (validRosters) checks.push('Roster player references are usable, including substitutes.');
    const scored=hasRecordedScores(m.innings,m.tieBreaker);
    if (m.status === 'SCHEDULED' && (m.isComplete || scored)) add('SCHEDULED_RESULTS','attention','This game is marked Scheduled but already has results or completion information. Review it; no history was changed.','game');
    if ((m.status === 'FINAL') !== m.isComplete) add('STATUS_MISMATCH','attention','The game status and completion flag disagree. Review the existing results.','game');
    if (home && away && validRosters) {
      const allEmpty = Array.isArray(m.innings) && m.innings.length === 6 && m.innings.every((i,n)=>i?.number===n+1 && ['home','away'].every(side => Array.isArray(i[side as 'home'|'away']?.playerScores) && i[side as 'home'|'away'].playerScores.length === 0));
      if (allEmpty && !scored && !m.isComplete && m.status === 'SCHEDULED') add('LINEUP_UNCONFIRMED','attention','The umpire can confirm the weekly lineup when starting this game.','game');
      else {
        try { validateScoreState(m,home,away); checks.push('Saved lineup and scoring structure are compatible.'); }
        catch { add('SCORING_STRUCTURE','blocked','The saved lineup or scoring structure is invalid. Review the lineup before scoring; recorded pitches must be preserved.','game'); }
      }
    }
    return {id:m.id,date,startTime:m.startTime || '',endTime:m.endTime || '',location:canonicalCage(m.location) || m.location || 'Not assigned',league:m.league,home:home?.name || 'Missing home team',away:away?.name || 'Missing away team',status:m.status || (m.isComplete?'FINAL':'SCHEDULED'),state:issues.some(i=>i.state==='blocked')?'blocked' as const:issues.length?'attention' as const:'ready' as const,issues,checks};
  });
  games.sort((a,b)=>((scheduleTimeMinutes(a.startTime) ?? 1440)-(scheduleTimeMinutes(b.startTime) ?? 1440)) || a.location.localeCompare(b.location));
  return {season,date,dates:[...new Set(official.map(m=>scheduleDateKey(m.date)).filter((d):d is string=>!!d))].sort(),checkedAt:now.toISOString(),games};
};
