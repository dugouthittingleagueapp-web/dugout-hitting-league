
import { AgeGroup, Match, Team, Inning, League, PlayerStats, PlayerSeasonStatRow, PlayerCareerSummary, ScheduleImportSummary } from '../types';
import { ARCHIVE_2025_LEAGUES, ARCHIVE_2025_TEAMS, ARCHIVE_2025_MATCHES } from './archive2025Data';
import { parseScheduleCsv, isDuplicateMatch } from '../utils/scheduleImporter';
import { sortMatchesChronologically } from '../utils/matchSort';
import { detectForfeit, isForfeitMatch, getForfeitingTeamId } from './matchHelpers';
import { coalesceInFlightGet } from '../utils/requestCoalescer';
import { validatePitchEdit, type PitchEdit } from '../utils/pitchSync';

export { sortMatchesChronologically };

export const normalizeLeague = (league?: string | null): string => {
  return (league || '').trim().toLowerCase();
};

export const leaguesMatch = (leagueA?: string | null, leagueB?: string | null): boolean => {
  if (!leagueA || !leagueB) return false;
  return normalizeLeague(leagueA) === normalizeLeague(leagueB);
};

const mapTeamFromDB = (dbTeam: any): Team => ({
  ...dbTeam,
  season: dbTeam.season || '2025',
  players: typeof dbTeam.players === 'string' ? JSON.parse(dbTeam.players) : dbTeam.players,
  subs: dbTeam.subs ? (typeof dbTeam.subs === 'string' ? JSON.parse(dbTeam.subs) : dbTeam.subs) : []
});

const mapMatchFromDB = (dbMatch: any): Match => {
  const inferredSeason = dbMatch.season || (dbMatch.date ? String(new Date(dbMatch.date).getFullYear()) : '2025');
  return {
    id: dbMatch.id,
    league: dbMatch.league,
    homeTeamId: dbMatch.home_team_id || dbMatch.homeTeamId,
    awayTeamId: dbMatch.away_team_id || dbMatch.awayTeamId,
    date: dbMatch.date,
    isComplete: dbMatch.is_complete !== undefined ? dbMatch.is_complete : (dbMatch.isComplete ?? false),
    status: dbMatch.status || undefined,
    innings: typeof dbMatch.innings === 'string' ? JSON.parse(dbMatch.innings) : dbMatch.innings,
    season: inferredSeason,
    tieBreaker: dbMatch.tie_breaker ? (typeof dbMatch.tie_breaker === 'string' ? JSON.parse(dbMatch.tie_breaker) : dbMatch.tie_breaker) : (dbMatch.tieBreaker || undefined),
    location: dbMatch.location || undefined,
    startTime: dbMatch.start_time || dbMatch.startTime || undefined,
    endTime: dbMatch.end_time || dbMatch.endTime || undefined,
    isPractice: dbMatch.is_practice !== undefined ? dbMatch.is_practice : (dbMatch.isPractice ?? false),
    is_practice: dbMatch.is_practice !== undefined ? dbMatch.is_practice : (dbMatch.isPractice ?? false),
    isForfeit: dbMatch.is_forfeit !== undefined ? dbMatch.is_forfeit : (dbMatch.isForfeit ?? false),
    is_forfeit: dbMatch.is_forfeit !== undefined ? dbMatch.is_forfeit : (dbMatch.isForfeit ?? false),
    forfeitingTeamId: dbMatch.forfeiting_team_id || dbMatch.forfeitingTeamId || null,
    forfeiting_team_id: dbMatch.forfeiting_team_id || dbMatch.forfeitingTeamId || null,
    winningTeamId: dbMatch.winning_team_id || dbMatch.winningTeamId || null,
    winning_team_id: dbMatch.winning_team_id || dbMatch.winningTeamId || null,
    forfeitReason: dbMatch.forfeit_reason || dbMatch.forfeitReason || undefined,
    forfeit_reason: dbMatch.forfeit_reason || dbMatch.forfeitReason || undefined,
  };
};

// Helper to format name as First L.
const formatName = (p: { name: string, lastName?: string }) => 
  `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;

// Robust UUID Generator that works in insecure contexts
export const generateUUID = (): string => {
    // Try native crypto first if available and secure
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        } catch (e) {
            // Fallback if crypto throws (e.g. insecure context)
        }
    }
    // Standard RFC4122 v4 UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// Safe fetch wrapper ensuring absolute URLs, session credentials, and Bearer authorization tokens
const apiFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const fullUrl = url.startsWith('http') || typeof window !== 'undefined'
    ? url
    : `http://localhost:3000${url}`;

  const headers = new Headers(init?.headers || {});
  if (typeof window !== 'undefined') {
    try {
      const token = sessionStorage.getItem('dugout_auth_token') || localStorage.getItem('dugout_auth_token');
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch (e) {}
  }

  const enhancedInit: RequestInit = {
    ...init,
    headers,
    credentials: init?.credentials || 'same-origin',
  };

  // Include credentials in the key to prevent sharing authenticated responses
  // across different users when a login switches during an in-flight request.
  if ((!init?.method || init.method.toUpperCase() === 'GET') && !init?.body && !init?.signal) {
    const key = `${fullUrl}|auth:${headers.get('Authorization') || ''}|credentials:${enhancedInit.credentials}`;
    return coalesceInFlightGet(key, () => fetch(fullUrl, enhancedInit));
  }
  return fetch(fullUrl, enhancedInit);
};

// League Methods
export const getLeagues = async (season?: string): Promise<League[]> => {
  if (typeof window === 'undefined' && season === '2025') {
    return ARCHIVE_2025_LEAGUES;
  }
  let url = '/api/leagues';
  if (season) url += `?season=${encodeURIComponent(season)}`;
  try {
    const res = await apiFetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && (data.length > 0 || season !== '2025')) {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`dugout_leagues_${season || 'all'}`, JSON.stringify(data));
          } catch (e) {}
        }
        return data;
      }
    }
  } catch (err) {
    console.warn('Network fetch failed for getLeagues, using offline cache', err);
  }

  // Offline fallback
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`dugout_leagues_${season || 'all'}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && (parsed.length > 0 || season !== '2025')) {
          return parsed;
        }
      }
    } catch (e) {}
  }

  if (season === '2025') {
    return ARCHIVE_2025_LEAGUES;
  }
  return [];
};

export const createLeague = async (id: string, season?: string): Promise<League> => {
  const res = await apiFetch('/api/leagues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, season })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create league');
  }
  return await res.json();
};

export const deleteLeague = async (id: string, season?: string) => {
  let url = `/api/leagues?id=${encodeURIComponent(id)}`;
  if (season) url += `&season=${encodeURIComponent(season)}`;
  const res = await apiFetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete league');
};

// Team Methods
// Offline Sync Queue Keys
const PENDING_MATCHES_KEY = 'dugout_pending_sync_matches';
const PENDING_TEAMS_KEY = 'dugout_pending_sync_teams';

const PENDING_PITCHES_KEY = 'dugout_pending_pitch_edits';

type QueuedPitchEdit = PitchEdit & { operationId: string };

const readPendingPitches = (): QueuedPitchEdit[] => {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(PENDING_PITCHES_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Offline pitch recovery data is invalid. Ask an admin for help before scoring more.');
  return parsed as QueuedPitchEdit[];
};

const writePendingPitches = (operations: QueuedPitchEdit[]): void => {
  if (typeof window === 'undefined') return;
  if (operations.length === 0) localStorage.removeItem(PENDING_PITCHES_KEY);
  else localStorage.setItem(PENDING_PITCHES_KEY, JSON.stringify(operations));
};

const removePendingPitch = (operationId: string): void => {
  writePendingPitches(readPendingPitches().filter(item => item.operationId !== operationId));
};

const emitPitchSyncConflict = (message: string): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dugout:pitch-sync-conflict', { detail: { message } }));
  }
};


export const enqueuePendingMatchSync = (match: Match) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(PENDING_MATCHES_KEY);
    const map: Record<string, Match> = raw ? JSON.parse(raw) : {};
    map[match.id] = match;
    localStorage.setItem(PENDING_MATCHES_KEY, JSON.stringify(map));
  } catch (e) {}
};

export const dequeuePendingMatchSync = (matchId: string) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(PENDING_MATCHES_KEY);
    if (!raw) return;
    const map: Record<string, Match> = JSON.parse(raw);
    delete map[matchId];
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(PENDING_MATCHES_KEY);
    } else {
      localStorage.setItem(PENDING_MATCHES_KEY, JSON.stringify(map));
    }
  } catch (e) {}
};

export const enqueuePendingTeamSync = (team: Team) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(PENDING_TEAMS_KEY);
    const map: Record<string, Team> = raw ? JSON.parse(raw) : {};
    map[team.id] = team;
    localStorage.setItem(PENDING_TEAMS_KEY, JSON.stringify(map));
  } catch (e) {}
};

let inFlightOfflineSync: Promise<void> | null = null;

/**
 * Avoid overlapping reconnect sync passes that could resend the same queued
 * roster or game to Neon. All listeners share this one in-flight operation.
 */
export const syncOfflineData = (): Promise<void> => {
  if (!inFlightOfflineSync) {
    const running = performOfflineSync();
    const settled = running.finally(() => {
      if (inFlightOfflineSync === settled) inFlightOfflineSync = null;
    });
    inFlightOfflineSync = settled;
  }
  return inFlightOfflineSync;
};

const performOfflineSync = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  // 1. Sync pending teams
  try {
    const rawTeams = localStorage.getItem(PENDING_TEAMS_KEY);
    if (rawTeams) {
      const teamMap: Record<string, Team> = JSON.parse(rawTeams);
      const teamIds = Object.keys(teamMap);
      for (const teamId of teamIds) {
        const team = teamMap[teamId];
        try {
          const res = await apiFetch('/api/teams', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(team)
          });
          if (res.ok) {
            delete teamMap[teamId];
          }
        } catch (err) {}
      }
      if (Object.keys(teamMap).length === 0) {
        localStorage.removeItem(PENDING_TEAMS_KEY);
      } else {
        localStorage.setItem(PENDING_TEAMS_KEY, JSON.stringify(teamMap));
      }
    }
  } catch (e) {}

  // 2. Sync pending matches
  try {
    const rawMatches = localStorage.getItem(PENDING_MATCHES_KEY);
    if (rawMatches) {
      const matchMap: Record<string, Match> = JSON.parse(rawMatches);
      const matchIds = Object.keys(matchMap);
      for (const matchId of matchIds) {
        const match = matchMap[matchId];
        try {
          const res = await apiFetch('/api/matches', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(match)
          });
          if (res.ok) {
            delete matchMap[matchId];
          }
        } catch (err) {}
      }
      if (Object.keys(matchMap).length === 0) {
        localStorage.removeItem(PENDING_MATCHES_KEY);
      } else {
        localStorage.setItem(PENDING_MATCHES_KEY, JSON.stringify(matchMap));
      }
    }
  } catch (e) {}

  // 3. Replay individual pitch edits in their recorded order. These are
  // protected by server-side player-ID and expected-value comparisons.
  // Conflicts remain queued and never silently overwrite another umpire.
  try {
    const pending = readPendingPitches();
    for (const edit of pending) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
      const active = readPendingPitches().some(item => item.operationId === edit.operationId);
      if (!active) continue;
      try {
        await queueMatchWrite(edit.id, () => sendPitchEdit(edit));
      } catch (err) {
        console.warn('Pitch replay needs attention:', err);
        emitPitchSyncConflict(err instanceof Error ? err.message : 'Pitch could not be synchronized.');
        break;
      }
    }
  } catch (err) {
    console.error('Could not inspect offline pitch recovery queue:', err);
    emitPitchSyncConflict('Offline pitch backup is unreadable. Please contact the administrator before continuing.');
  }
};

// Automatic listener to sync queued items once internet reconnects
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncOfflineData();
  });
}

// Team Methods
export const getTeams = async (league: AgeGroup | null, season: string): Promise<Team[]> => {
  if (typeof window === 'undefined' && season === '2025') {
    return ARCHIVE_2025_TEAMS.filter(t => !league || leaguesMatch(t.league, league));
  }
  let url = `/api/teams?season=${encodeURIComponent(season)}`;
  if (league) url += `&league=${encodeURIComponent(league)}`;
  
  try {
    const res = await apiFetch(url);
    if (res.ok) {
      const data = await res.json();
      const mapped = data.map(mapTeamFromDB);
      if (mapped.length > 0 || season !== '2025') {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`dugout_teams_${season}_${league || 'all'}`, JSON.stringify(mapped));
          } catch (e) {}
        }
        return mapped;
      }
    }
  } catch (err) {
    console.warn('Network fetch failed for getTeams, falling back to cache', err);
  }

  // Offline fallback
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`dugout_teams_${season}_${league || 'all'}`);
      if (cached) {
        const parsed: Team[] = JSON.parse(cached);
        if (parsed.length > 0 || season !== '2025') return parsed;
      }
      const allCached = localStorage.getItem('dugout_all_teams_cache');
      if (allCached) {
        const parsed: Team[] = JSON.parse(allCached);
        const filtered = parsed.filter(t => (!league || leaguesMatch(t.league, league)) && (!season || (t.season || '2025') === season));
        if (filtered.length > 0 || season !== '2025') return filtered;
      }
    } catch (e) {}
  }

  // Guaranteed fallback for 2025 historical archive
  if (season === '2025') {
    const fallback = ARCHIVE_2025_TEAMS.filter(t => !league || leaguesMatch(t.league, league));
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`dugout_teams_2025_${league || 'all'}`, JSON.stringify(fallback));
      } catch (e) {}
    }
    return fallback;
  }

  return [];
};

export const getAllTeams = async (): Promise<Team[]> => {
  let teams: Team[] = [];
  try {
    const res = await apiFetch(`/api/teams`);
    if (res.ok) {
      const data = await res.json();
      teams = data.map(mapTeamFromDB);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('dugout_all_teams_cache', JSON.stringify(teams));
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('Network fetch failed for getAllTeams, falling back to cache', err);
  }

  // Offline fallback
  if (teams.length === 0 && typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('dugout_all_teams_cache');
      if (cached) {
        teams = JSON.parse(cached);
      }
    } catch (e) {}
  }

  // Always ensure 2025 archive teams exist in full team directory
  const teamIdSet = new Set(teams.map(t => t.id));
  ARCHIVE_2025_TEAMS.forEach(at => {
    if (!teamIdSet.has(at.id)) {
      teams.push(at);
      teamIdSet.add(at.id);
    }
  });

  return teams;
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

  // Cache locally
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`dugout_team_${newTeam.id}`, JSON.stringify(newTeam));
      const cached = localStorage.getItem('dugout_all_teams_cache');
      if (cached) {
        const list: Team[] = JSON.parse(cached);
        list.push(newTeam);
        localStorage.setItem('dugout_all_teams_cache', JSON.stringify(list));
      }
    } catch (e) {}
  }

  const res = await apiFetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newTeam)
  });
  if (!res.ok) throw new Error('Failed to save team');
  const data = await res.json();
  return mapTeamFromDB(data);
};

export const saveTeam = async (team: Team): Promise<Team> => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`dugout_team_${team.id}`, JSON.stringify(team));
      const cached = localStorage.getItem('dugout_all_teams_cache');
      if (cached) {
        const list: Team[] = JSON.parse(cached);
        const idx = list.findIndex(t => t.id === team.id);
        if (idx !== -1) list[idx] = team;
        else list.push(team);
        localStorage.setItem('dugout_all_teams_cache', JSON.stringify(list));
      }
    } catch (e) {}
  }

  try {
    const res = await apiFetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(team)
    });
    if (res.ok) {
      const data = await res.json();
      return mapTeamFromDB(data);
    }
  } catch (err) {}
  return team;
};

export const updateTeam = async (team: Team, options?: { requireServerSave?: boolean }): Promise<Team> => {
  // Do not show an unpersisted substitute as saved. The server must confirm
  // official roster edits before the lineup can refer to the new player ID.
  try {
    const res = await apiFetch('/api/teams', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(team)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // All HTTP rejections (including 400/403/500) are real failures, not offline.
      throw new Error(body.error || `Roster update rejected (HTTP ${res.status})`);
    }
    const saved = mapTeamFromDB(await res.json());
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`dugout_team_${saved.id}`, JSON.stringify(saved));
        const cached = localStorage.getItem('dugout_all_teams_cache');
        if (cached) {
          const list: Team[] = JSON.parse(cached);
          const idx = list.findIndex(t => t.id === saved.id);
          if (idx !== -1) list[idx] = saved;
          else list.push(saved);
          localStorage.setItem('dugout_all_teams_cache', JSON.stringify(list));
        }
      } catch (e) {}
    }
    return saved;
  } catch (err) {
    // Official umpire workflows must never proceed with a substitute that
    // exists only in browser cache. Other callers retain offline queueing.
    if (options?.requireServerSave) throw err;
    if (err instanceof Error && /rejected \(HTTP|Unauthorized|Forbidden|permissions|only add substitutes/i.test(err.message)) throw err;
    enqueuePendingTeamSync(team);
    return team;
  }
};

export const moveTeams = async (teamIds: string[], targetLeague: string): Promise<void> => {
  const res = await apiFetch('/api/teams', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'move_teams', teamIds, targetLeague })
  });
  if (!res.ok) throw new Error('Failed to move teams');
};

export const deleteTeam = async (teamId: string) => {
  await apiFetch(`/api/teams?id=${teamId}`, { method: 'DELETE' });
};

// Dashboard polls only small revision records. Errors are never treated as
// empty schedules; this prevents network outages from erasing the match list.
export interface MatchRevision {
  id: string;
  revision: string;
}

export const getMatchRevisions = async (league: AgeGroup, season: string): Promise<MatchRevision[]> => {
  const url = `/api/matches?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}&revisions=true`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`Could not check the latest match updates (HTTP ${res.status})`);
  const rows: unknown = await res.json();
  if (!Array.isArray(rows) || !rows.every(row => row && typeof row.id === 'string' && typeof row.revision === 'string')) {
    throw new Error('Invalid match update response; keeping the current scores.');
  }
  return rows as MatchRevision[];
};

// Unlike getMatch, this live-refresh read must not fall back to a potentially
// outdated local match. An error leaves the existing dashboard unchanged.
export const getMatchFromServer = async (id: string): Promise<Match> => {
  const res = await apiFetch(`/api/matches?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Match details could not be refreshed (HTTP ${res.status})`);
  return mapMatchFromDB(await res.json());
};

// Match Methods
export const getMatches = async (league: AgeGroup, season: string, options?: { excludePractice?: boolean }): Promise<Match[]> => {
  const excludePractice = options?.excludePractice ?? false;
  if (typeof window === 'undefined' && season === '2025') {
    let matches2025 = ARCHIVE_2025_MATCHES.filter(m => leaguesMatch(m.league, league));
    if (excludePractice) matches2025 = matches2025.filter(m => !m.isPractice && !m.is_practice);
    return sortMatchesChronologically(matches2025);
  }
  try {
    const url = `/api/matches?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}${excludePractice ? '&excludePractice=true' : ''}`;
    const res = await apiFetch(url);
    if (res.ok) {
      const data = await res.json();
      const rawMapped: Match[] = data.map(mapMatchFromDB);
      let mapped: Match[] = sortMatchesChronologically<Match>(rawMapped);
      if (excludePractice) {
        mapped = mapped.filter(m => !m.isPractice && !m.is_practice);
      }
      if (mapped.length > 0 || season !== '2025') {
        if (typeof window !== 'undefined' && !excludePractice) {
          try {
            localStorage.setItem(`dugout_matches_${season}_${league}`, JSON.stringify(mapped));
          } catch (e) {}
        }
        return mapped;
      }
    }
  } catch (err) {
    console.warn('Network fetch failed for getMatches, using offline cache', err);
  }

  // Offline fallback
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`dugout_matches_${season}_${league}`);
      if (cached) {
        let parsed: Match[] = JSON.parse(cached);
        if (excludePractice) parsed = parsed.filter(m => !m.isPractice && !m.is_practice);
        if (parsed.length > 0 || season !== '2025') return sortMatchesChronologically(parsed);
      }
    } catch (e) {}
  }

  // Guaranteed fallback for 2025 historical archive
  if (season === '2025') {
    let fallback = sortMatchesChronologically(ARCHIVE_2025_MATCHES.filter(m => leaguesMatch(m.league, league)));
    if (excludePractice) fallback = fallback.filter(m => !m.isPractice && !m.is_practice);
    if (typeof window !== 'undefined' && !excludePractice) {
      try {
        localStorage.setItem(`dugout_matches_2025_${league}`, JSON.stringify(fallback));
      } catch (e) {}
    }
    return fallback;
  }

  return [];
};

export const getOfficialMatches = async (league: AgeGroup, season: string): Promise<Match[]> => {
  return getMatches(league, season, { excludePractice: true });
};

export const getAllMatches = async (): Promise<Match[]> => {
  let matches: Match[] = [];
  try {
    const res = await apiFetch('/api/matches');
    if (res.ok) {
      const data = await res.json();
      matches = data.map(mapMatchFromDB);
    }
  } catch (err) {
    console.warn('Network fetch failed for getAllMatches', err);
  }

  // Merge 2025 archive matches if missing
  const matchIdSet = new Set(matches.map(m => m.id));
  ARCHIVE_2025_MATCHES.forEach(am => {
    if (!matchIdSet.has(am.id)) {
      matches.push(am);
      matchIdSet.add(am.id);
    }
  });

  return sortMatchesChronologically(matches);
};

export const getMatch = async (id: string): Promise<Match | undefined> => {
  try {
    const res = await apiFetch(`/api/matches?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      const mapped = mapMatchFromDB(data);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`dugout_match_${id}`, JSON.stringify(mapped));
        } catch (e) {}
      }
      return mapped;
    }
  } catch (err) {
    console.warn('Network fetch failed for match, attempting offline cache recovery', err);
  }

  // Offline / Disconnect fallback from localStorage
  if (typeof window !== 'undefined') {
    try {
      const local = localStorage.getItem(`dugout_match_${id}`);
      if (local) {
        return JSON.parse(local);
      }
    } catch (e) {}
  }

  // Archive 2025 match fallback
  const archiveMatch = ARCHIVE_2025_MATCHES.find(m => m.id === id);
  if (archiveMatch) return archiveMatch;

  return undefined;
};

export const createMatch = async (
    league: AgeGroup, 
    homeTeamId: string, 
    awayTeamId: string, 
    homePlayerIds: string[], 
    awayPlayerIds: string[], 
    season: string,
    forfeitOptions?: {
        isForfeit?: boolean;
        is_forfeit?: boolean;
        forfeitingTeamId?: string | null;
        forfeiting_team_id?: string | null;
        winningTeamId?: string | null;
        winning_team_id?: string | null;
        forfeitReason?: string;
        forfeit_reason?: string;
    }
): Promise<Match> => {
    const innings: Inning[] = [];
    for (let i = 1; i <= 6; i++) {
        innings.push(createEmptyInning(i, homePlayerIds, awayPlayerIds));
    }

    const match: Match = {
        id: generateUUID(),
        league,
        homeTeamId,
        awayTeamId,
        date: new Date().toISOString(),
        isComplete: false,
        status: 'SCHEDULED',
        innings,
        season,
        isPractice: false,
        is_practice: false,
        isForfeit: forfeitOptions?.isForfeit ?? forfeitOptions?.is_forfeit ?? false,
        is_forfeit: forfeitOptions?.is_forfeit ?? forfeitOptions?.isForfeit ?? false,
        forfeitingTeamId: forfeitOptions?.forfeitingTeamId ?? forfeitOptions?.forfeiting_team_id ?? null,
        forfeiting_team_id: forfeitOptions?.forfeiting_team_id ?? forfeitOptions?.forfeitingTeamId ?? null,
        winningTeamId: forfeitOptions?.winningTeamId ?? forfeitOptions?.winning_team_id ?? null,
        winning_team_id: forfeitOptions?.winning_team_id ?? forfeitOptions?.winningTeamId ?? null,
        forfeitReason: forfeitOptions?.forfeitReason ?? forfeitOptions?.forfeit_reason,
        forfeit_reason: forfeitOptions?.forfeit_reason ?? forfeitOptions?.forfeitReason,
    };

    // Immediate local persistence before network request
    if (typeof window !== 'undefined') {
        try {
            localStorage.setItem(`dugout_match_${match.id}`, JSON.stringify(match));
        } catch (e) {}
    }
    
    const res = await apiFetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(match)
    });
    
    if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create match (HTTP ${res.status})`);
  }
    const data = await res.json();
    return mapMatchFromDB(data);
};

export const createScheduledMatch = async (params: {
  league: AgeGroup;
  homeTeamId: string;
  awayTeamId: string;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  season: string;
  date: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  isForfeit?: boolean;
  is_forfeit?: boolean;
  forfeitingTeamId?: string | null;
  forfeiting_team_id?: string | null;
  winningTeamId?: string | null;
  winning_team_id?: string | null;
  forfeitReason?: string;
  forfeit_reason?: string;
}): Promise<Match> => {
  const innings: Inning[] = [];
  for (let i = 1; i <= 6; i++) {
    innings.push(createEmptyInning(i, params.homePlayerIds, params.awayPlayerIds));
  }

  const match: Match = {
    id: generateUUID(),
    league: params.league,
    homeTeamId: params.homeTeamId,
    awayTeamId: params.awayTeamId,
    date: params.date,
    isComplete: false,
    status: 'SCHEDULED',
    innings,
    season: params.season,
    location: params.location,
    startTime: params.startTime,
    endTime: params.endTime,
    notes: params.notes,
    isPractice: false,
    is_practice: false,
    isForfeit: params.isForfeit ?? params.is_forfeit ?? false,
    is_forfeit: params.is_forfeit ?? params.isForfeit ?? false,
    forfeitingTeamId: params.forfeitingTeamId ?? params.forfeiting_team_id ?? null,
    forfeiting_team_id: params.forfeiting_team_id ?? params.forfeitingTeamId ?? null,
    winningTeamId: params.winningTeamId ?? params.winning_team_id ?? null,
    winning_team_id: params.winning_team_id ?? params.winningTeamId ?? null,
    forfeitReason: params.forfeitReason ?? params.forfeit_reason,
    forfeit_reason: params.forfeit_reason ?? params.forfeitReason,
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`dugout_match_${match.id}`, JSON.stringify(match));
    } catch (e) {}
  }

  const res = await apiFetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(match),
  });

  if (!res.ok) throw new Error('Failed to create scheduled match');
  const data = await res.json();
  return mapMatchFromDB(data);
};

export const createPracticeMatch = async (params: {
  league: AgeGroup;
  homeTeamId: string;
  awayTeamId: string;
  homePlayerIds?: string[];
  homeLineupIds?: string[];
  awayPlayerIds?: string[];
  awayLineupIds?: string[];
  season: string;
  notes?: string;
  inningsCount?: number;
  pitchesPerBatter?: number;
  location?: string;
  startTime?: string;
  status?: 'SCHEDULED' | 'IN_PROGRESS';
}): Promise<Match> => {
  const homeIds = params.homePlayerIds || params.homeLineupIds || [];
  const awayIds = params.awayPlayerIds || params.awayLineupIds || [];
  const count = params.inningsCount || 6;

  const innings: Inning[] = [];
  for (let i = 1; i <= count; i++) {
    innings.push(createEmptyInning(i, homeIds, awayIds));
  }

  const now = new Date();
  const formatTime = (d: Date) => {
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strMinutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${strMinutes} ${ampm}`;
  };

  const match: Match = {
    id: `practice-${generateUUID()}`,
    league: params.league,
    homeTeamId: params.homeTeamId,
    awayTeamId: params.awayTeamId,
    date: now.toISOString(),
    isComplete: false,
    status: params.status || 'SCHEDULED',
    isPractice: true,
    is_practice: true,
    innings,
    season: params.season,
    location: params.location || 'The Dugout (Practice)',
    startTime: params.startTime || formatTime(now),
    notes: params.notes || 'TEST / PRACTICE MATCH - Stats excluded from official standings'
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`dugout_match_${match.id}`, JSON.stringify(match));
    } catch (e) {}
  }

  try {
    const res = await apiFetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(match),
    });

    if (res.ok) {
      const data = await res.json();
      return mapMatchFromDB(data);
    }
  } catch (e) {
    // In unit test or offline environment, return local match object
  }
  return match;
};

export const createEmptyInning = (number: number, homeIds: string[] = [], awayIds: string[] = []): Inning => {
    // LOGIC:
    // 3v3: 10 pitches each (30 vs 30)
    // 2v2: 10 pitches each (20 vs 20) - Standard scoring per user request
    // 3v2 / 2v3: The short team gets 15 pitches (Ghost Mode) to balance the 30-pitch team.

    let homePitches = 10;
    let awayPitches = 10;

    const safeHomeIds = Array.isArray(homeIds) ? homeIds : [];
    const safeAwayIds = Array.isArray(awayIds) ? awayIds : [];

    const homeCount = safeHomeIds.length;
    const awayCount = safeAwayIds.length;

    if (homeCount === 2 && awayCount === 3) {
        homePitches = 15; // Ghost Mode for Home
    } else if (awayCount === 2 && homeCount === 3) {
        awayPitches = 15; // Ghost Mode for Away
    }

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

export const calculateTeamInningTotal = (side: 'home' | 'away', inning?: Inning): number => {
    if (!inning) return 0;
    const teamData = side === 'home' ? inning.home : inning.away;
    if (!teamData?.playerScores) return 0;
    return teamData.playerScores.reduce((sum, player) => sum + (player.pitches || []).reduce((pSum, pitch) => pSum + (pitch.points || 0), 0), 0);
};

export const calculateTeamGameTotal = (side: 'home' | 'away', matchData?: Match | null): number => {
    if (!matchData?.innings) return 0;
    const baseScore = matchData.innings.reduce((sum, inning) => sum + calculateTeamInningTotal(side, inning), 0);
    let tieScore = 0;
    if (matchData.tieBreaker && Array.isArray(matchData.tieBreaker)) {
        matchData.tieBreaker.forEach(round => {
            const scores = side === 'home' ? round.homeScores : round.awayScores;
            if (Array.isArray(scores)) {
                tieScore += scores.reduce<number>((a, b) => (a || 0) + (b || 0), 0);
            }
        });
    }
    return baseScore + tieScore;
};

// Serialize writes from the same browser to prevent an older network response
// overwriting a newer pitch or lineup update in Neon.
const matchWriteQueues = new Map<string, Promise<void>>();

const queueMatchWrite = <T>(id: string, operation: () => Promise<T>): Promise<T> => {
    const previous = matchWriteQueues.get(id) || Promise.resolve();
    const write = previous.catch(() => {}).then(operation);
    const settled = write.then(() => {}, () => {});
    matchWriteQueues.set(id, settled);
    void settled.then(() => {
        if (matchWriteQueues.get(id) === settled) matchWriteQueues.delete(id);
    });
    return write;
};

export const updateMatch = (match: Match, options?: { requireServerSave?: boolean }): Promise<Match> =>
    queueMatchWrite(match.id, () => performMatchUpdate(match, options));

/**
 * Preserve the COMPLETE match locally before attempting a small atomic pitch
 * PATCH. Unlike the legacy full-record PUT, unrelated pitches from other
 * devices are never replaced by this operation.
 */
export const updatePitch = (match: Match, edit: PitchEdit): Promise<Match> => {
    const validation = validatePitchEdit(edit);
    if (validation) return Promise.reject(new Error(validation));
    if (match.id !== edit.id) return Promise.reject(new Error('Pitch belongs to a different game.'));
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`dugout_match_${match.id}`, JSON.stringify(match));
        localStorage.setItem('dugout_active_match_id', match.id);
        const pending = readPendingPitches();
        pending.push({ ...edit, operationId: generateUUID() });
        writePendingPitches(pending);
      } catch (error) {
        return Promise.reject(new Error('Could not save a local recovery copy of this pitch. Check device storage before continuing.'));
      }
    }
    const pending = typeof window !== 'undefined' ? readPendingPitches() : [];
    const operation = pending[pending.length - 1] || { ...edit, operationId: generateUUID() };
    return queueMatchWrite(match.id, async () => {
      try {
        await sendPitchEdit(operation);
      } catch (error) {
        // A disconnected device retains its score and pending edit. A server
        // refusal (including 409) needs explicit action, not a silent retry.
        if (error instanceof Error && error.message.startsWith('HTTP ')) throw error;
        console.warn('Pitch stored locally, awaiting connectivity:', error);
      }
      return match;
    });
};

const sendPitchEdit = async (edit: QueuedPitchEdit): Promise<void> => {
    const res = await apiFetch('/api/pitches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`HTTP ${res.status}: ${body.error || 'The score could not be saved.'}`);
    }
    removePendingPitch(edit.operationId);
};

const performMatchUpdate = async (match: Match, options?: { requireServerSave?: boolean }): Promise<Match> => {
    // Serialize once for both offline recovery and the server. A pitch update
    // previously stringified the entire match twice on the same save path.
    const serializedMatch = JSON.stringify(match);
    // Only optimistic-cache offline pitch updates; explicit confirmed saves must wait for Neon.
    if (!options?.requireServerSave && typeof window !== 'undefined') {
        try {
            localStorage.setItem(`dugout_match_${match.id}`, serializedMatch);
            if (!match.isComplete && match.status === 'IN_PROGRESS') {
                localStorage.setItem('dugout_active_match_id', match.id);
            } else if (match.isComplete) {
                localStorage.removeItem('dugout_active_match_id');
            }
        } catch (e) {}
    }

    try {
        const res = await apiFetch('/api/matches', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: serializedMatch
        });
        if (res.ok) {
            dequeuePendingMatchSync(match.id);
            const data = await res.json();
            const saved = mapMatchFromDB(data);
            if (options?.requireServerSave && typeof window !== 'undefined') {
                try {
                    localStorage.setItem(`dugout_match_${saved.id}`, JSON.stringify(saved));
                    if (saved.isComplete) localStorage.removeItem('dugout_active_match_id');
                    else if (saved.status === 'IN_PROGRESS') localStorage.setItem('dugout_active_match_id', saved.id);
                } catch (e) {}
            }
            return saved;
        } else {
            if (options?.requireServerSave) {
                const details = await res.json().catch(() => ({}));
                throw new Error(details.error || `Failed to save match (HTTP ${res.status})`);
            }
            enqueuePendingMatchSync(match);
        }
    } catch (err) {
        if (options?.requireServerSave) throw err;
        console.warn('Network sync failed (phone offline/disconnected), match saved in local storage and queued for background sync', err);
        enqueuePendingMatchSync(match);
    }
    return match;
};

export const deleteMatch = async (matchId: string) => {
    if (!matchId) return;
    const rawId = matchId.trim();
    const strippedId = rawId.startsWith('practice-') ? rawId.slice('practice-'.length).trim() : rawId;
    const prefixedId = `practice-${strippedId}`;

    // Frontend safety verification: check local cache to reject official games immediately
    if (typeof window !== 'undefined') {
        try {
            const cached = localStorage.getItem(`dugout_match_${rawId}`) || 
                           localStorage.getItem(`dugout_match_${strippedId}`) || 
                           localStorage.getItem(`dugout_match_${prefixedId}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.is_practice === false && parsed.isPractice === false) {
                    console.warn(`[storageService] Blocked attempt to delete official match ${rawId}`);
                    throw new Error('Forbidden: Official league matches cannot be deleted.');
                }
            }
        } catch (e: any) {
            if (e?.message?.includes('Forbidden')) throw e;
        }
    }

    const res = await apiFetch(`/api/matches?id=${encodeURIComponent(rawId)}`, { method: 'DELETE' });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMessage = errData.error || (res.status === 403 
            ? 'Forbidden: Official league matches cannot be deleted. Only practice sessions can be removed.' 
            : `Failed to delete match (HTTP ${res.status})`);
        console.warn(`[storageService] Deletion rejected: ${errMessage}`);
        throw new Error(errMessage);
    }

    if (typeof window !== 'undefined') {
        try {
            localStorage.removeItem(`dugout_match_${rawId}`);
            localStorage.removeItem(`dugout_match_${strippedId}`);
            localStorage.removeItem(`dugout_match_${prefixedId}`);

            const activeId = localStorage.getItem('dugout_active_match_id');
            if (activeId === rawId || activeId === strippedId || activeId === prefixedId) {
                localStorage.removeItem('dugout_active_match_id');
            }

            // Purge from all local match list caches
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('dugout_matches_')) {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        try {
                            const list: Match[] = JSON.parse(raw);
                            const filtered = list.filter(m => {
                                const mId = String(m.id || '').trim();
                                return mId !== rawId && mId !== strippedId && mId !== prefixedId;
                            });
                            localStorage.setItem(key, JSON.stringify(filtered));
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {}
    }

    dequeuePendingMatchSync(rawId);
    dequeuePendingMatchSync(strippedId);
    dequeuePendingMatchSync(prefixedId);
};

export const restoreTeamRoster = async (matchId: string, teamId: string, currentInningIdx: number): Promise<Match> => {
    const match = await getMatch(matchId);
    if (!match) throw new Error("Match not found");
    
    // Fetch actual team to get full player list
    const allTeams = await getAllTeams();
    const team = allTeams.find(t => t.id === teamId);
    if (!team) throw new Error("Team not found");

    const newInnings: Inning[] = JSON.parse(JSON.stringify(match.innings || []));
    
    // Reset future innings.
    const startResetIdx = currentInningIdx + 1;

    for(let i = startResetIdx; i < newInnings.length; i++) {
        if (!newInnings[i]) continue;
        const oldHomeIds = (newInnings[i].home?.playerScores || []).map(p => p.playerId);
        const oldAwayIds = (newInnings[i].away?.playerScores || []).map(p => p.playerId);
        
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
    
    // Pre-fill players AND subs from the match data
    // We must iterate the match innings to catch players who might be subs
    const allMatchPlayerIds = new Set<string>();
    (match.innings || []).forEach(i => {
        (i?.home?.playerScores || []).forEach(p => allMatchPlayerIds.add(p.playerId));
        (i?.away?.playerScores || []).forEach(p => allMatchPlayerIds.add(p.playerId));
    });

    // Add team players with FORMATTED names
    (homeTeam?.players || []).forEach(p => stats.set(p.id, initStat(p.id, formatName(p))));
    (awayTeam?.players || []).forEach(p => stats.set(p.id, initStat(p.id, formatName(p))));
    
    // Add any subs that might be in the match but not main roster
    // Check home subs
    if(homeTeam?.subs) {
        homeTeam.subs.forEach(p => {
            if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p)));
        });
    }
    // Check away subs
    if(awayTeam?.subs) {
        awayTeam.subs.forEach(p => {
            if(allMatchPlayerIds.has(p.id)) stats.set(p.id, initStat(p.id, formatName(p)));
        });
    }

    (match.innings || []).forEach(inning => {
        if (!inning) return;
        [inning.home, inning.away].forEach(teamData => {
            if (!teamData?.playerScores) return;
            const isGhostMode = teamData.playerScores.length === 2 && (teamData.playerScores[0]?.pitches?.length || 0) >= 15;
            const actualTeamId = teamData.teamId === 'home' ? match.homeTeamId : match.awayTeamId;
            const ghostId = `ghost-${actualTeamId}`; // Unique ID for this team's ghost

            teamData.playerScores.forEach((ps) => {
                if (!ps) return;
                let pStats = stats.get(ps.playerId);
                if (!pStats) {
                     // Handle unknown sub (shouldn't happen if subs array is sync'd, but safety fallback)
                     pStats = initStat(ps.playerId, 'Sub');
                     stats.set(ps.playerId, pStats);
                }

                // In Ghost mode, only first 10 pitches count for player. 11-15 go to ghost.
                const pitches = ps.pitches || [];
                const playerPitches = isGhostMode ? pitches.slice(0, 10) : pitches;
                const ghostPitches = isGhostMode ? pitches.slice(10, 15) : [];

                const processPitch = (p: any, statObj: PlayerStats) => {
                    if (p && p.points !== null && p.points !== undefined) {
                        const val = Number(p.points);
                        if (!isNaN(val)) {
                            statObj.totalPoints += val;
                            statObj.pitchesSeen += 1;
                            if (val === 4) statObj.hits4++;
                            else if (val === 3) statObj.hits3++;
                            else if (val === 2) statObj.hits2++;
                            else if (val === 1) statObj.hits1++;
                        }
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
    
    // Process Tie Breaker
    if(match.tieBreaker && Array.isArray(match.tieBreaker)) {
        match.tieBreaker.forEach(tb => {
            if (!tb) return;
            const addTb = (pid: string, scores: (number|null)[]) => {
                if (!pid || !Array.isArray(scores)) return;
                let s = stats.get(pid);
                if(!s) { 
                     // Try to find name in teams/subs if not init
                     const allP = [...(homeTeam?.players || []), ...(homeTeam?.subs||[]), ...(awayTeam?.players || []), ...(awayTeam?.subs||[])];
                     const found = allP.find(p=>p.id===pid);
                     s = initStat(pid, found ? formatName(found) : 'Unknown'); 
                     stats.set(pid, s); 
                }
                scores.forEach(val => {
                    if(val !== null && val !== undefined) {
                        const num = Number(val);
                        if (!isNaN(num)) {
                            s!.totalPoints += num;
                            s!.pitchesSeen++;
                            if (num === 4) s!.hits4++;
                            else if (num === 3) s!.hits3++;
                            else if (num === 2) s!.hits2++;
                            else if (num === 1) s!.hits1++;
                        }
                    }
                });
            };
            addTb(tb.homePlayerId, tb.homeScores);
            addTb(tb.awayPlayerId, tb.awayScores);
        });
    }

    // Filter out ghost players before returning for UI display
    return Array.from(stats.values()).filter(s => !s.playerId.startsWith('ghost-'));
};

export const getTeamStats = async (team: Team, league: AgeGroup, season: string): Promise<PlayerStats[]> => {
    // Strict isolation: Fetch official matches excluding practice, and filter out any practice matches
    const matches = await getMatches(league, season, { excludePractice: true });
    const teamMatches = matches.filter(m => (m.homeTeamId === team.id || m.awayTeamId === team.id) && m.isComplete && !m.isPractice && !m.is_practice);
    
    const allTeams = await getAllTeams();

    const aggStats = new Map<string, PlayerStats>();
    
    teamMatches.forEach(m => {
        // ASYMMETRICAL STATS EXCLUSION:
        // Completely exclude the individual and team statistics of the forfeiting team from being counted toward season totals.
        // The compliant opponent's stats remain fully intact!
        const isForfeit = !!(m.isForfeit || m.is_forfeit);
        const forfeitingId = m.forfeitingTeamId || m.forfeiting_team_id;
        if (isForfeit && forfeitingId === team.id) {
            return;
        }

        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        if(home && away) {
            const mStats = calculateMatchStats(m, home, away);
            mStats.forEach(stat => {
                // Only aggregate for THIS team's players (including subs and ghost)
                const isMainPlayer = team.players.some(p => p.id === stat.playerId);
                const isSub = team.subs && team.subs.some(p => p.id === stat.playerId);
                const isGhost = stat.playerId === `ghost-${team.id}`;

                if(isMainPlayer || isSub || isGhost) {
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

    return Array.from(aggStats.values()).filter(s => !s.playerId.startsWith('ghost-'));
};

// Settings & Admin
export const verifyPassword = async (password: string): Promise<{success: boolean, role?: 'admin'|'umpire', error?: string}> => {
    const trimmed = (password || '').trim();
    if (!trimmed) {
        return { success: false, error: 'Password cannot be empty' };
    }

    try {
        const res = await apiFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'verify', password: trimmed })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success && data.role) {
            if (typeof window !== 'undefined') {
                try {
                    if (data.token) {
                        sessionStorage.setItem('dugout_auth_token', data.token);
                        localStorage.setItem('dugout_auth_token', data.token);
                    }
                } catch (e) {}
            }
            return { success: true, role: data.role };
        }
        if (data.error && !res.ok && res.status !== 500) {
            return { success: false, error: data.error };
        }
    } catch (err) {
        console.warn('Network verifyPassword failed, falling back to cached authentication', err);
    }

    // Offline / Network Failure Fallback
    try {
        const cachedAdmin = (typeof window !== 'undefined' ? localStorage.getItem('dugout_cached_admin_pw') : null) || 'admin';
        const cachedUmpire = (typeof window !== 'undefined' ? localStorage.getItem('dugout_cached_umpire_pw') : null) || 'umpire';
        if (trimmed.toLowerCase() === cachedAdmin.toLowerCase()) {
            return { success: true, role: 'admin' };
        }
        if (trimmed.toLowerCase() === cachedUmpire.toLowerCase()) {
            return { success: true, role: 'umpire' };
        }
    } catch (e) {}

    return { success: false, error: 'Incorrect password' };
};

export const updateAdminPassword = async (password: string) => {
    const trimmed = password.trim();
    if (typeof window !== 'undefined') {
        try { localStorage.setItem('dugout_cached_admin_pw', trimmed); } catch (e) {}
    }
    const res = await apiFetch('/api/settings', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ action: 'update_password', password: trimmed }) 
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update admin password');
    }
};

export const updateUmpirePassword = async (password: string) => {
    const trimmed = password.trim();
    if (typeof window !== 'undefined') {
        try { localStorage.setItem('dugout_cached_umpire_pw', trimmed); } catch (e) {}
    }
    const res = await apiFetch('/api/settings', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ action: 'update_umpire_password', password: trimmed }) 
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update umpire password');
    }
};

export const logout = async (): Promise<void> => {
    if (typeof window !== 'undefined') {
        try {
            sessionStorage.removeItem('dugout_auth_token');
            localStorage.removeItem('dugout_auth_token');
            localStorage.removeItem('userRole');
        } catch (e) {}
    }
    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'logout' })
        });
    } catch (e) {}
};

export const checkAuthSession = async (): Promise<{ authenticated: boolean; role?: 'admin' | 'umpire' }> => {
    try {
        const res = await apiFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'check_auth' })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.authenticated && data.role) {
                return { authenticated: true, role: data.role };
            }
        }
    } catch (e) {}
    return { authenticated: false };
};

export const getCurrentSeason = async (): Promise<string> => {
    const defaultSeason = (typeof window !== 'undefined' ? localStorage.getItem('dugout_current_season') : null) || '2026';
    try {
        const res = await apiFetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            const season = data.currentSeason || defaultSeason;
            if (typeof window !== 'undefined') {
                try { localStorage.setItem('dugout_current_season', season); } catch (e) {}
                const list = Array.isArray(data.seasons) ? data.seasons : [];
                const merged = Array.from(new Set([...list, '2026', '2025', season]))
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                try { localStorage.setItem('dugout_available_seasons', JSON.stringify(merged)); } catch (e) {}
            }
            return season;
        }
    } catch (e) {
        console.warn('Network fetch failed for getCurrentSeason, using cached season', e);
    }
    if (typeof window !== 'undefined') {
        try {
            const cached = localStorage.getItem('dugout_current_season');
            if (cached) return cached;
        } catch (e) {}
    }
    return defaultSeason;
};

export const getAvailableSeasons = async (): Promise<string[]> => {
    const defaultSeason = (typeof window !== 'undefined' ? localStorage.getItem('dugout_current_season') : null) || '2026';
    try {
        const res = await apiFetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data.seasons) ? data.seasons : [];
            const merged = Array.from(new Set([...list, '2026', '2025', data.currentSeason || defaultSeason]))
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            if (typeof window !== 'undefined') {
                try { localStorage.setItem('dugout_available_seasons', JSON.stringify(merged)); } catch (e) {}
            }
            return merged;
        }
    } catch (e) {
        console.warn('Network fetch failed for getAvailableSeasons, using cache', e);
    }
    if (typeof window !== 'undefined') {
        try {
            const cached = localStorage.getItem('dugout_available_seasons');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const merged = Array.from(new Set([...parsed, '2026', '2025', defaultSeason]))
                        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                    localStorage.setItem('dugout_available_seasons', JSON.stringify(merged));
                    return merged;
                }
            }
        } catch (e) {}
    }
    const mergedFallback = Array.from(new Set([defaultSeason, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (typeof window !== 'undefined') {
        try { localStorage.setItem('dugout_available_seasons', JSON.stringify(mergedFallback)); } catch (e) {}
    }
    return mergedFallback;
};

export const updateCurrentSeason = async (season: string) => {
    await apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_season', season }) });
    if (typeof window !== 'undefined') {
        try { 
            localStorage.setItem('dugout_current_season', season);
            const cached = localStorage.getItem('dugout_available_seasons');
            const list = cached ? JSON.parse(cached) : [];
            const merged = Array.from(new Set([...list, season, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            localStorage.setItem('dugout_available_seasons', JSON.stringify(merged));
        } catch (e) {}
    }
};

export const exportData = async (): Promise<string> => {
    const [teams, matches, leagues] = await Promise.all([getAllTeams(), getAllMatches(), getLeagues()]);
    return JSON.stringify({ teams, matches, leagues }, null, 2);
};

export interface ParsedTeamInput {
  name: string;
  league: AgeGroup;
  players: { name: string; lastName?: string }[];
  subs?: { name: string; lastName?: string }[];
}

export const parseRosterInput = async (payload: { text?: string; imageBase64?: string; mimeType?: string; defaultLeague?: string }): Promise<ParsedTeamInput[]> => {
  const res = await apiFetch('/api/parse-roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to parse roster');
  }
  const data = await res.json();
  return data.teams || [];
};

export const createTeamsBatch = async (teamsToCreate: ParsedTeamInput[], season: string): Promise<Team[]> => {
  const created: Team[] = [];
  for (const item of teamsToCreate) {
    if (!item.name.trim()) continue;
    const team = await createTeam(
      item.name.trim(),
      item.league,
      item.players || [],
      season,
      item.subs || []
    );
    created.push(team);
  }
  return created;
};

// Player Career Statistics Across All Seasons
export const getPlayerCareerStats = async (playerIdentifier: string): Promise<PlayerCareerSummary | null> => {
  if (!playerIdentifier || !playerIdentifier.trim()) return null;
  const target = playerIdentifier.trim().toLowerCase();

  const [allTeams, allMatches] = await Promise.all([
    getAllTeams().catch(() => []),
    getAllMatches().catch(() => [])
  ]);

  const matchingPlayerIds = new Set<string>();
  let canonicalName = playerIdentifier.trim();

  allTeams.forEach(team => {
    const list = [...(team.players || []), ...(team.subs || [])];
    list.forEach(p => {
      const fName = formatName(p);
      const simpleName = `${p.name || ''} ${p.lastName || ''}`.trim();
      if (
        p.id.toLowerCase() === target ||
        fName.toLowerCase() === target ||
        simpleName.toLowerCase() === target ||
        (p.name && p.name.toLowerCase() === target)
      ) {
        matchingPlayerIds.add(p.id);
        if (fName && canonicalName === playerIdentifier.trim()) {
          canonicalName = fName;
        }
      }
    });
  });

  matchingPlayerIds.add(playerIdentifier);

  const seasonGroups = new Map<string, {
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
    matchIds: Set<string>;
  }>();

  allMatches.forEach(match => {
    if (!match.isComplete || match.isPractice || match.is_practice) return;

    let playedSide: 'home' | 'away' | null = null;
    let playedTeamId = '';

    (match.innings || []).forEach(inning => {
      if (!inning) return;
      (inning.home?.playerScores || []).forEach(ps => {
        if (ps && matchingPlayerIds.has(ps.playerId)) {
          playedSide = 'home';
          playedTeamId = match.homeTeamId;
        }
      });
      (inning.away?.playerScores || []).forEach(ps => {
        if (ps && matchingPlayerIds.has(ps.playerId)) {
          playedSide = 'away';
          playedTeamId = match.awayTeamId;
        }
      });
    });

    if (!playedSide && match.tieBreaker && Array.isArray(match.tieBreaker)) {
      match.tieBreaker.forEach(tb => {
        if (tb) {
          if (matchingPlayerIds.has(tb.homePlayerId)) {
            playedSide = 'home';
            playedTeamId = match.homeTeamId;
          } else if (matchingPlayerIds.has(tb.awayPlayerId)) {
            playedSide = 'away';
            playedTeamId = match.awayTeamId;
          }
        }
      });
    }

    if (!playedSide) return;

    // Asymmetrical Stats Exclusion:
    // If match was a forfeit, completely exclude stats for players on the forfeiting team from career leaderboards.
    // Opponent player stats remain fully intact!
    const isForfeit = !!(match.isForfeit || match.is_forfeit);
    const forfeitingId = match.forfeitingTeamId || match.forfeiting_team_id;
    if (isForfeit && playedTeamId === forfeitingId) {
      return;
    }

    const season = match.season || String(new Date(match.date || Date.now()).getFullYear());
    const leagueId = match.league || 'Standard';
    const teamObj = allTeams.find(t => t.id === playedTeamId);
    const teamName = teamObj ? teamObj.name : (playedSide === 'home' ? 'Home' : 'Away');

    const groupKey = `${season}||${leagueId}||${teamName}`;
    if (!seasonGroups.has(groupKey)) {
      seasonGroups.set(groupKey, {
        season,
        leagueId,
        teamName,
        gamesPlayed: 0,
        totalPoints: 0,
        hits4: 0,
        hits3: 0,
        hits2: 0,
        hits1: 0,
        pitchesSeen: 0,
        matchIds: new Set<string>()
      });
    }

    const group = seasonGroups.get(groupKey)!;
    if (!group.matchIds.has(match.id)) {
      group.matchIds.add(match.id);
      group.gamesPlayed += 1;
    }

    (match.innings || []).forEach(inning => {
      if (!inning) return;
      const sideData = playedSide === 'home' ? inning.home : inning.away;
      if (!sideData?.playerScores) return;

      const isGhostMode = sideData.playerScores.length === 2 && (sideData.playerScores[0]?.pitches?.length || 0) >= 15;

      sideData.playerScores.forEach(ps => {
        if (ps && matchingPlayerIds.has(ps.playerId)) {
          const pitches = ps.pitches || [];
          const playerPitches = isGhostMode ? pitches.slice(0, 10) : pitches;

          playerPitches.forEach(p => {
            if (p && p.points !== null && p.points !== undefined) {
              const val = Number(p.points);
              if (!isNaN(val)) {
                group.totalPoints += val;
                group.pitchesSeen += 1;
                if (val === 4) group.hits4 += 1;
                else if (val === 3) group.hits3 += 1;
                else if (val === 2) group.hits2 += 1;
                else if (val === 1) group.hits1 += 1;
              }
            }
          });
        }
      });
    });

    if (match.tieBreaker && Array.isArray(match.tieBreaker)) {
      match.tieBreaker.forEach(tb => {
        if (!tb) return;
        const checkTb = (pid: string, scores: (number | null)[]) => {
          if (matchingPlayerIds.has(pid) && Array.isArray(scores)) {
            scores.forEach(val => {
              if (val !== null && val !== undefined) {
                const num = Number(val);
                if (!isNaN(num)) {
                  group.totalPoints += num;
                  group.pitchesSeen += 1;
                  if (num === 4) group.hits4 += 1;
                  else if (num === 3) group.hits3 += 1;
                  else if (num === 2) group.hits2 += 1;
                  else if (num === 1) group.hits1 += 1;
                }
              }
            });
          }
        };
        if (playedSide === 'home') checkTb(tb.homePlayerId, tb.homeScores);
        else checkTb(tb.awayPlayerId, tb.awayScores);
      });
    }
  });

  const seasonRows: PlayerSeasonStatRow[] = Array.from(seasonGroups.values()).map(g => {
    const pointsPerPitch = g.pitchesSeen > 0 ? Number((g.totalPoints / g.pitchesSeen).toFixed(2)) : 0;
    const totalHits = g.hits4 + g.hits3 + g.hits2 + g.hits1;
    const hitPercentage = g.pitchesSeen > 0 ? Number(((totalHits / g.pitchesSeen) * 100).toFixed(1)) : 0;
    return {
      season: g.season,
      leagueId: g.leagueId,
      teamName: g.teamName,
      gamesPlayed: g.gamesPlayed,
      totalPoints: g.totalPoints,
      hits4: g.hits4,
      hits3: g.hits3,
      hits2: g.hits2,
      hits1: g.hits1,
      pitchesSeen: g.pitchesSeen,
      pointsPerPitch,
      hitPercentage
    };
  }).sort((a, b) => b.season.localeCompare(a.season, undefined, { numeric: true }));

  const uniqueSeasons = new Set(seasonRows.map(r => r.season));
  const totalGP = seasonRows.reduce((sum, r) => sum + r.gamesPlayed, 0);
  const totalPts = seasonRows.reduce((sum, r) => sum + r.totalPoints, 0);
  const total4s = seasonRows.reduce((sum, r) => sum + r.hits4, 0);
  const total3s = seasonRows.reduce((sum, r) => sum + r.hits3, 0);
  const total2s = seasonRows.reduce((sum, r) => sum + r.hits2, 0);
  const total1s = seasonRows.reduce((sum, r) => sum + r.hits1, 0);
  const totalPit = seasonRows.reduce((sum, r) => sum + r.pitchesSeen, 0);

  const careerPPP = totalPit > 0 ? Number((totalPts / totalPit).toFixed(2)) : 0;
  const careerHits = total4s + total3s + total2s + total1s;
  const careerHitPct = totalPit > 0 ? Number(((careerHits / totalPit) * 100).toFixed(1)) : 0;

  const seasonsCount = uniqueSeasons.size || (seasonRows.length > 0 ? 1 : 0);
  const avgDiv = seasonsCount > 0 ? seasonsCount : 1;

  return {
    playerName: canonicalName,
    seasons: seasonRows,
    careerTotals: {
      seasonsCount,
      gamesPlayed: totalGP,
      totalPoints: totalPts,
      hits4: total4s,
      hits3: total3s,
      hits2: total2s,
      hits1: total1s,
      pitchesSeen: totalPit,
      pointsPerPitch: careerPPP,
      hitPercentage: careerHitPct
    },
    seasonAverages: {
      gamesPlayed: Number((totalGP / avgDiv).toFixed(1)),
      totalPoints: Math.round(totalPts / avgDiv),
      hits4: Math.round(total4s / avgDiv),
      hits3: Math.round(total3s / avgDiv),
      hits2: Math.round(total2s / avgDiv),
      hits1: Math.round(total1s / avgDiv),
      pitchesSeen: Math.round(totalPit / avgDiv)
    }
  };
};

/**
 * High-level schedule import service:
 * Parses CSV, auto-creates leagues/teams, skips duplicate games, and provisions scheduled matches.
 */
export const importScheduleFromCsv = async (
  csvContent: string,
  options?: { targetLeague?: string; defaultLeague?: string; defaultSeason?: string }
): Promise<ScheduleImportSummary> => {
  const { games, errors } = parseScheduleCsv(csvContent, options);
  if (games.length === 0) {
    return {
      totalRows: 0,
      createdMatches: 0,
      skippedDuplicates: 0,
      createdTeams: [],
      createdLeagues: [],
      errors,
    };
  }

  const activeSeason = options?.defaultSeason || (await getCurrentSeason());
  const existingLeagues = await getLeagues(activeSeason);
  const existingTeams = await getAllTeams();
  const existingMatches = await getAllMatches();

  const createdLeaguesSet = new Set<string>();
  const createdTeamsSet = new Set<string>();
  let createdMatches = 0;
  let skippedDuplicates = 0;

  for (const game of games) {
    const season = game.season || activeSeason;
    const leagueName = game.group;

    // 1. Ensure league division exists
    const leagueFound = existingLeagues.some(
      l => leaguesMatch(l.id, leagueName) && (l.season || activeSeason) === season
    );
    if (!leagueFound && !createdLeaguesSet.has(leagueName)) {
      try {
        await createLeague(leagueName, season);
        existingLeagues.push({ id: leagueName, season, created_at: new Date().toISOString() });
        createdLeaguesSet.add(leagueName);
      } catch (err: any) {
        errors.push(`Failed to create division "${leagueName}": ${err.message}`);
      }
    }

    // 2. Resolve or create Home Team
    let homeTeam = existingTeams.find(
      t => t.name.trim().toLowerCase() === game.homeTeamName.trim().toLowerCase() &&
           leaguesMatch(t.league, leagueName) &&
           (t.season || activeSeason) === season
    );
    if (!homeTeam) {
      try {
        homeTeam = await createTeam(
          game.homeTeamName.trim(),
          leagueName,
          [
            { name: `${game.homeTeamName} Player 1` },
            { name: `${game.homeTeamName} Player 2` },
            { name: `${game.homeTeamName} Player 3` },
          ],
          season
        );
        existingTeams.push(homeTeam);
        createdTeamsSet.add(game.homeTeamName.trim());
      } catch (err: any) {
        errors.push(`Failed to auto-create Home Team "${game.homeTeamName}": ${err.message}`);
        continue;
      }
    }

    // 3. Resolve or create Away Team
    let awayTeam = existingTeams.find(
      t => t.name.trim().toLowerCase() === game.awayTeamName.trim().toLowerCase() &&
           leaguesMatch(t.league, leagueName) &&
           (t.season || activeSeason) === season
    );
    if (!awayTeam) {
      try {
        awayTeam = await createTeam(
          game.awayTeamName.trim(),
          leagueName,
          [
            { name: `${game.awayTeamName} Player 1` },
            { name: `${game.awayTeamName} Player 2` },
            { name: `${game.awayTeamName} Player 3` },
          ],
          season
        );
        existingTeams.push(awayTeam);
        createdTeamsSet.add(game.awayTeamName.trim());
      } catch (err: any) {
        errors.push(`Failed to auto-create Away Team "${game.awayTeamName}": ${err.message}`);
        continue;
      }
    }

    // 4. Duplicate check
    const isDup = isDuplicateMatch(game, homeTeam.id, awayTeam.id, existingMatches);
    if (isDup) {
      skippedDuplicates++;
      continue;
    }

    // 5. Create Scheduled Match
    try {
      const homePids = (homeTeam.players || []).slice(0, 3).map(p => p.id);
      const awayPids = (awayTeam.players || []).slice(0, 3).map(p => p.id);
      const created = await createScheduledMatch({
        league: leagueName,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homePlayerIds: homePids,
        awayPlayerIds: awayPids,
        season,
        date: game.scheduledIsoDate,
        location: game.location,
        startTime: game.startTime,
        endTime: game.endTime,
        notes: game.notes,
      });
      existingMatches.push(created);
      createdMatches++;
    } catch (err: any) {
      errors.push(`Failed to schedule match ${game.homeTeamName} vs ${game.awayTeamName}: ${err.message}`);
    }
  }

  return {
    totalRows: games.length,
    createdMatches,
    skippedDuplicates,
    createdTeams: Array.from(createdTeamsSet),
    createdLeagues: Array.from(createdLeaguesSet),
    errors,
  };
};

