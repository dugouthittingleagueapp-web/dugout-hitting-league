import type { Match, Team } from '../types';
import { mapMatchFromDB } from '../utils/dbMappers';

// Browser-only pending writes and save warnings. These keys stay unchanged
// so a deployment cannot make existing offline scores inaccessible.
// Offline Sync Queue Keys
const PENDING_MATCHES_KEY = 'dugout_pending_sync_matches';
const PENDING_TEAMS_KEY = 'dugout_pending_sync_teams';
const SYNC_CONFLICTS_KEY = 'dugout_scoring_sync_conflicts';

// UI notices are deliberately separate from scoring conflicts. A short Wi-Fi
// interruption must never block the scoring controls.
export type ScoringSaveState = 'saving' | 'saved' | 'offline' | 'attention';
const publishScoringSaveState = (matchId: string, state: ScoringSaveState) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dugout:scoring-save-state', { detail: { matchId, state } }));
  }
};
export const hasPendingMatchSync = (matchId: string): boolean => {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_MATCHES_KEY) || '{}');
    return Object.prototype.hasOwnProperty.call(pending, matchId);
  } catch { return false; }
};

// A newer successful write from this same device can supersede an older
// offline snapshot, but only when every recorded pitch in the old snapshot
// is present unchanged in the newer saved game.
const containsEarlierScores = (earlier: Match, later: Match): boolean => {
  if (earlier.id !== later.id || earlier.homeTeamId !== later.homeTeamId ||
      earlier.awayTeamId !== later.awayTeamId) return false;
  return (earlier.innings || []).every((inning, inningIndex) => {
    const next = later.innings?.[inningIndex];
    if (!next || inning.number !== next.number) return false;
    return (['home', 'away'] as const).every(side => {
      const oldTeam = inning[side];
      const newTeam = next[side];
      if (oldTeam.teamId !== newTeam?.teamId) return false;
      return oldTeam.playerScores.every(oldPlayer => {
        const newPlayer = newTeam.playerScores.find(p => p.playerId === oldPlayer.playerId);
        if (!newPlayer) return false;
        return oldPlayer.pitches.every((pitch, index) =>
          pitch.points === null || newPlayer.pitches[index]?.points === pitch.points);
      });
    });
  });
};
export const getScoringSyncWarning = (id: string): string | null => {
  try {
    const items: Record<string, string> = JSON.parse(localStorage.getItem(SYNC_CONFLICTS_KEY) || '{}');
    return items[id] || null;
  } catch { return null; }
};
const markScoringSyncWarning = (id: string, message: string) => {
  try {
    const items: Record<string, string> = JSON.parse(localStorage.getItem(SYNC_CONFLICTS_KEY) || '{}');
    items[id] = message;
    localStorage.setItem(SYNC_CONFLICTS_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('dugout:scoring-sync-warning', { detail: { matchId: id, message } }));
    publishScoringSaveState(id, 'attention');
  } catch { /* Retain the original pending snapshot even if warning storage fails. */ }
};
const clearScoringSyncWarning = (id: string) => {
  try {
    const items: Record<string, string> = JSON.parse(localStorage.getItem(SYNC_CONFLICTS_KEY) || '{}');
    delete items[id];
    localStorage.setItem(SYNC_CONFLICTS_KEY, JSON.stringify(items));
  } catch {}
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


export interface OfflineSyncDependencies {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  serializeMatchOperation: <T>(id: string, operation: () => Promise<T>) => Promise<T>;
  matchWriteHeaders: (id: string) => HeadersInit;
  recordRevision: (match: Match) => Match;
}

/**
 * Replays browser-local team and score updates using the SAME per-game
 * serialization and revision tracking as foreground scoring.
 * Dependencies are injected to avoid circular imports from storageService.
 */
export const createOfflineSynchronizer = (dependencies: OfflineSyncDependencies): (() => Promise<void>) => {
  const { apiFetch, serializeMatchOperation, matchWriteHeaders, recordRevision } = dependencies;
  let inFlightOfflineSync: Promise<void> | null = null;
  
  /**
   * Avoid overlapping reconnect sync passes that could resend the same queued
   * roster or game to Neon. All listeners share this one in-flight operation.
   */
  const syncOfflineData = (): Promise<void> => {
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
          // A reconnect replay must never run concurrently with a pitch being
          // entered on the same device. Re-read the pending snapshot only after
          // earlier game writes have completed.
          await serializeMatchOperation(matchId, async () => {
            if (getScoringSyncWarning(matchId)) return;
            let pending: Record<string, Match>;
            try {
              pending = JSON.parse(localStorage.getItem(PENDING_MATCHES_KEY) || '{}');
            } catch { return; }
            const match = pending[matchId];
            if (!match) return;
            try {
              // Keep the revision from the original offline snapshot. Never
              // replace it with the newer revision cached from other reads.
              const res = await apiFetch('/api/matches', {
                method: 'PUT',
                headers: matchWriteHeaders(match.id),
                body: JSON.stringify(match)
              });
              if (res.ok) {
                const saved = recordRevision(mapMatchFromDB(await res.json()));
                const current: Record<string, Match> = JSON.parse(localStorage.getItem(PENDING_MATCHES_KEY) || '{}');
                if (JSON.stringify(current[matchId]) === JSON.stringify(match)) {
                  delete current[matchId];
                  if (Object.keys(current).length) localStorage.setItem(PENDING_MATCHES_KEY, JSON.stringify(current));
                  else localStorage.removeItem(PENDING_MATCHES_KEY);
                  localStorage.setItem(`dugout_match_${matchId}`, JSON.stringify(saved));
                  clearScoringSyncWarning(matchId);
                  publishScoringSaveState(matchId, 'saved');
                } else {
                  // Another snapshot replaced this one during the request.
                  // Never overwrite the local cache or erase unsent pitches.
                  markScoringSyncWarning(matchId,
                    'Some scores are still saved on this device. Please ask an admin to check them before scoring again.');
                }
              } else if ([401, 403, 409, 423].includes(res.status)) {
                const info = await res.json().catch(() => ({}));
                console.warn('Queued score needs review:', info.code || res.status);
                markScoringSyncWarning(matchId,
                  'Some scores from this device could not be synced because the game changed or scoring control moved. Do not re-enter those pitches. Ask an admin to review them.');
              }
            } catch (err) {
              // Keep the saved pitches in the queue for the next reconnect.
              console.warn('Queued scoring will retry when connected', err);
              publishScoringSaveState(matchId, 'offline');
            }
          });
        }
      }
    } catch (e) {}
  };
  return syncOfflineData;
};
