import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { AgeGroup, Match, Team } from '../types';
import * as storage from '../services/storageService';
import { getMatchRevisionDelta } from '../utils/matchRevisionDelta';

interface DashboardMatchSyncOptions {
  active: boolean;
  league: AgeGroup | null;
  season: string;
  refreshDashboard: (league: AgeGroup, season: string, silent?: boolean, refreshTeams?: boolean) => Promise<void>;
  setMatches: Dispatch<SetStateAction<Match[]>>;
  setTeams: Dispatch<SetStateAction<Team[]>>;
}

/**
 * Single owner for dashboard refresh lifecycle. The dashboard needs full
 * matches for statistics, but should not transfer every pitch every 30 seconds.
 *
 * 1. Initial dashboard load remains unchanged.
 * 2. Establish a revision baseline once per view (including a safety resync).
 * 3. Fetch only new/changed game details, and remove deleted games.
 * 4. Refresh rosters once every ten polling ticks.
 * 5. Fall back to the original full fetch on any revision protocol error.
 *
 * Live scoring and the archived 2025 data retain their original behavior.
 */
export const useDashboardMatchSync = ({
  active, league, season, refreshDashboard, setMatches, setTeams
}: DashboardMatchSyncOptions): void => {
  useEffect(() => {
    if (!active || !league) return;
    let cancelled = false;
    let inFlight = false;
    let ticks = 0;
    let lastRevisions: storage.MatchRevision[] | null = null;

    const poll = async () => {
      if (document.visibilityState === 'hidden' || inFlight || cancelled) return;
      inFlight = true;
      try {
        ticks++;
        if (season === '2025') {
          // Historical archive may contain bundled games not stored in Neon.
          await refreshDashboard(league, season, true, ticks % 10 === 0);
          return;
        }

        const latest = await storage.getMatchRevisions(league, season);
        if (cancelled) return;
        if (!lastRevisions) {
          // Establish a safe baseline, including edits made during initial load.
          await refreshDashboard(league, season, true, ticks % 10 === 0);
          if (!cancelled) lastRevisions = latest;
          return;
        }

        const delta = getMatchRevisionDelta(lastRevisions, latest);
        if (delta.changedIds.length || delta.removedIds.length) {
          // Only write state after every changed match is successfully read.
          // Missing or disconnected responses must never erase saved scores.
          const changed = await Promise.all(delta.changedIds.map(id => storage.getMatchFromServer(id)));
          if (cancelled) return;
          const visibleIds = new Set(latest.map(row => row.id));
          const changedIds = new Set(delta.changedIds);
          setMatches(previous => storage.sortMatchesChronologically([
            ...previous.filter(m => visibleIds.has(m.id) && !changedIds.has(m.id)),
            ...changed
          ]));
        }
        lastRevisions = latest;
        if (ticks % 10 === 0) {
          const freshTeams = await storage.getTeams(null, season);
          if (!cancelled) setTeams(freshTeams);
        }
      } catch (error) {
        console.warn('Compact dashboard refresh unavailable; keeping current scores', error);
        if (!cancelled) await refreshDashboard(league, season, true, ticks % 10 === 0);
        lastRevisions = null;
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(() => { void poll(); }, 30000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, league, season, refreshDashboard, setMatches, setTeams]);
};
