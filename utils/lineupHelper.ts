import { Match, Inning, PlayerInningScore, MatchStatus } from '../types';

/**
 * Re-orders and applies new home and away batting orders to all innings of a match.
 * Preserves any already recorded pitches for existing players while ensuring:
 * - The playerScores array reflects the exact batting order (index 0 = Batter 1, index 1 = Batter 2, index 2 = Batter 3)
 * - Pitch counts conform to league standards (10 pitches each for 3v3 or 2v2, 15 pitches for the short side in 3v2/2v3 Ghost Mode)
 */
export const applyLineupToMatch = (
  match: Match,
  newHomePlayerIds: string[],
  newAwayPlayerIds: string[],
  options?: { startFromInningIdx?: number }
): Match => {
  const homeCount = newHomePlayerIds.length;
  const awayCount = newAwayPlayerIds.length;

  let homePitchCount = 10;
  let awayPitchCount = 10;

  if (homeCount === 2 && awayCount === 3) {
    homePitchCount = 15; // Ghost Mode for Home
  } else if (awayCount === 2 && homeCount === 3) {
    awayPitchCount = 15; // Ghost Mode for Away
  }

  const startIdx = options?.startFromInningIdx ?? 0;

  const syncTeamPlayerScores = (
    existingScores: PlayerInningScore[] | undefined,
    playerIds: string[],
    targetPitchCount: number
  ): PlayerInningScore[] => {
    return playerIds.map(pid => {
      const found = existingScores?.find(p => p.playerId === pid);
      if (found) {
        const curLen = found.pitches?.length || 0;
        if (curLen === targetPitchCount) {
          return { playerId: pid, pitches: [...found.pitches] };
        }
        if (curLen < targetPitchCount) {
          const extra = Array(targetPitchCount - curLen)
            .fill(null)
            .map(() => ({ points: null }));
          return {
            playerId: pid,
            pitches: [...(found.pitches || []), ...extra],
          };
        }
        return {
          playerId: pid,
          pitches: found.pitches.slice(0, targetPitchCount),
        };
      }

      return {
        playerId: pid,
        pitches: Array(targetPitchCount)
          .fill(null)
          .map(() => ({ points: null })),
      };
    });
  };

  const updatedInnings: Inning[] = (match.innings || []).map((inning, idx) => {
    if (idx < startIdx) {
      return inning;
    }

    return {
      ...inning,
      home: {
        teamId: 'home',
        playerScores: syncTeamPlayerScores(
          inning.home?.playerScores,
          newHomePlayerIds,
          homePitchCount
        ),
      },
      away: {
        teamId: 'away',
        playerScores: syncTeamPlayerScores(
          inning.away?.playerScores,
          newAwayPlayerIds,
          awayPitchCount
        ),
      },
    };
  });

  return {
    ...match,
    innings: updatedInnings,
  };
};

/**
 * Moves a batter up (earlier) in the batting order.
 */
export const moveBatterUp = (playerIds: string[], index: number): string[] => {
  if (index <= 0 || index >= playerIds.length) return [...playerIds];
  const copy = [...playerIds];
  const temp = copy[index - 1];
  copy[index - 1] = copy[index];
  copy[index] = temp;
  return copy;
};

/**
 * Moves a batter down (later) in the batting order.
 */
export const moveBatterDown = (playerIds: string[], index: number): string[] => {
  if (index < 0 || index >= playerIds.length - 1) return [...playerIds];
  const copy = [...playerIds];
  const temp = copy[index + 1];
  copy[index + 1] = copy[index];
  copy[index] = temp;
  return copy;
};

/**
 * Formats a player's full name, guaranteeing that both first name and last name
 * are shown in full without abbreviation, truncation, or duplicate surnames.
 */
export const formatFullPlayerName = (p?: { name?: string; lastName?: string }): string => {
  if (!p) return 'Unknown Player';
  const first = (p.name || '').trim();
  const last = (p.lastName || '').trim();
  if (!last) return first || 'Unknown Player';
  if (!first) return last;
  if (first.toLowerCase().endsWith(last.toLowerCase())) {
    return first;
  }
  return `${first} ${last}`;
};

/**
 * Returns the effective lifecycle status of a match:
 * - 'FINAL': match is complete
 * - 'IN_PROGRESS': actively being scored by an umpire (LIVE)
 * - 'SCHEDULED': upcoming scheduled match that has not started
 */
export const getMatchStatus = (match: Match): MatchStatus => {
  if (match.isComplete || match.status === 'FINAL') return 'FINAL';
  if (match.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (match.status === 'SCHEDULED') return 'SCHEDULED';

  // Fallback for legacy records: check if any pitches have been recorded
  const hasRecordedPitches = (match.innings || []).some(ing =>
    ing.home?.playerScores?.some(p => p.pitches?.some(pt => pt?.points !== null && pt?.points !== undefined)) ||
    ing.away?.playerScores?.some(p => p.pitches?.some(pt => pt?.points !== null && pt?.points !== undefined))
  );

  return hasRecordedPitches ? 'IN_PROGRESS' : 'SCHEDULED';
};

/**
 * Swaps Home and Away designations on a match record.
 * Updates homeTeamId/awayTeamId, swaps the batting sides in each inning,
 * and swaps tieBreaker assignments if present.
 */
export const swapHomeAndAway = (match: Match): Match => {
  const newHomeTeamId = match.awayTeamId;
  const newAwayTeamId = match.homeTeamId;

  const swappedInnings: Inning[] = (match.innings || []).map(inning => ({
    ...inning,
    home: {
      teamId: 'home',
      playerScores: (inning.away?.playerScores || []).map(ps => ({
        playerId: ps.playerId,
        pitches: [...(ps.pitches || [])]
      }))
    },
    away: {
      teamId: 'away',
      playerScores: (inning.home?.playerScores || []).map(ps => ({
        playerId: ps.playerId,
        pitches: [...(ps.pitches || [])]
      }))
    }
  }));

  const swappedTieBreaker = match.tieBreaker?.map(tb => ({
    roundNumber: tb.roundNumber,
    pitchLimit: tb.pitchLimit,
    homePlayerId: tb.awayPlayerId,
    awayPlayerId: tb.homePlayerId,
    homeScores: [...tb.awayScores],
    awayScores: [...tb.homeScores]
  }));

  return {
    ...match,
    homeTeamId: newHomeTeamId,
    awayTeamId: newAwayTeamId,
    innings: swappedInnings,
    tieBreaker: swappedTieBreaker
  };
};

/**
 * Auto-advances schedule view to the current or closest upcoming week based on the system date.
 */
export const findCurrentOrUpcomingWeekId = (
  weeks: { id: string; label: string; matches: Match[] }[],
  currentDateStr: string = new Date().toISOString()
): string => {
  if (!weeks || weeks.length === 0) return '';

  const d = new Date(currentDateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const currentWeekKey = `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;

  // 1. Active in-progress week takes first precedence (games currently being scored)
  const liveWeek = weeks.find(w => w.matches.some(m => getMatchStatus(m) === 'IN_PROGRESS'));
  if (liveWeek) return liveWeek.id;

  // 2. Exact match for current system calendar week
  const exact = weeks.find(w => w.id === currentWeekKey);
  if (exact) return exact.id;

  // 3. Earliest upcoming week with scheduled games
  const todayDay = currentDateStr.substring(0, 10);
  const upcomingWeek = weeks.find(w =>
    w.matches.some(m => !m.isComplete && m.date && m.date.substring(0, 10) >= todayDay)
  );
  if (upcomingWeek) return upcomingWeek.id;

  // 4. Chronological fallback
  const futureWeek = weeks.find(w => w.id > currentWeekKey);
  if (futureWeek) return futureWeek.id;

  return weeks[weeks.length - 1].id;
};

