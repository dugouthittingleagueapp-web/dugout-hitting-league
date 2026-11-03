import { Match, Team } from '../types';

export const OFFICIAL_TEAM_NAME = 'C-C-Crushers!';

export interface MergeCrushersResult {
  success: boolean;
  teamsMerged: number;
  teamsRenamed: number;
  matchesUpdated: number;
  finalizedMatchesUpdated: number;
  scheduledMatchesUpdated: number;
  playersMigrated: number;
  details: string[];
}

/**
 * Checks if a team name is the duplicate variant (without exclamation mark).
 */
export const isDuplicateCrushersName = (name?: string): boolean => {
  if (!name) return false;
  const clean = name.trim();
  return clean.toLowerCase() === 'c-c-crushers' && clean !== OFFICIAL_TEAM_NAME;
};

/**
 * Checks if a team name is the official variant (with exclamation mark).
 */
export const isOfficialCrushersName = (name?: string): boolean => {
  if (!name) return false;
  return name.trim().toLowerCase() === 'c-c-crushers!' || name.trim() === OFFICIAL_TEAM_NAME;
};

/**
 * Merges duplicate 'C-C-Crushers' into official 'C-C-Crushers!' across teams and matches in-memory/JSON data.
 */
export function migrateCrushersInDbData(db: {
  teams: Team[];
  matches: Match[];
  leagues?: any[];
}): MergeCrushersResult {
  const result: MergeCrushersResult = {
    success: true,
    teamsMerged: 0,
    teamsRenamed: 0,
    matchesUpdated: 0,
    finalizedMatchesUpdated: 0,
    scheduledMatchesUpdated: 0,
    playersMigrated: 0,
    details: []
  };

  if (!Array.isArray(db.teams)) db.teams = [];
  if (!Array.isArray(db.matches)) db.matches = [];

  const duplicates = db.teams.filter(t => isDuplicateCrushersName(t.name));

  if (duplicates.length === 0) {
    result.details.push('No duplicate "C-C-Crushers" team records found.');
    return result;
  }

  for (const dup of duplicates) {
    // 1. Locate primary record for C-C-Crushers! in the same league/season (or same league)
    let primary = db.teams.find(
      t => isOfficialCrushersName(t.name) &&
           t.id !== dup.id &&
           (t.league || '').trim().toLowerCase() === (dup.league || '').trim().toLowerCase() &&
           (t.season || '2026') === (dup.season || '2026')
    );

    if (!primary) {
      primary = db.teams.find(
        t => isOfficialCrushersName(t.name) &&
             t.id !== dup.id &&
             (t.league || '').trim().toLowerCase() === (dup.league || '').trim().toLowerCase()
      );
    }

    if (primary) {
      result.details.push(
        `Merging duplicate team "${dup.name}" (ID: ${dup.id}) into official "${primary.name}" (ID: ${primary.id}) in league "${dup.league}".`
      );

      // A. Merge Players and Subs
      const playerMap = new Map<string, string>(); // dupPlayerId -> primaryPlayerId
      const primaryPlayers = [...(primary.players || [])];
      const primarySubs = [...(primary.subs || [])];
      const dupPlayers = [...(dup.players || []), ...(dup.subs || [])];

      for (const dp of dupPlayers) {
        const dpCleanName = (dp.name || '').trim().toLowerCase();
        const existingPrimary =
          primaryPlayers.find(p => (p.name || '').trim().toLowerCase() === dpCleanName) ||
          primarySubs.find(p => (p.name || '').trim().toLowerCase() === dpCleanName);

        if (existingPrimary) {
          playerMap.set(dp.id, existingPrimary.id);
        } else {
          // If primary has generic placeholder names (e.g. "C-C-Crushers! Player 1") and duplicate has real names
          const placeholderIdx = primaryPlayers.findIndex(
            p => p.name.includes('Player ') && !dp.name.includes('Player ')
          );
          if (placeholderIdx !== -1) {
            primaryPlayers[placeholderIdx].name = dp.name;
            if (dp.lastName) primaryPlayers[placeholderIdx].lastName = dp.lastName;
            playerMap.set(dp.id, primaryPlayers[placeholderIdx].id);
          } else {
            primaryPlayers.push({ ...dp });
            playerMap.set(dp.id, dp.id);
            result.playersMigrated++;
          }
        }
      }

      primary.players = primaryPlayers;
      primary.subs = primarySubs;

      // B. Update Last Night's Game, Box Scores, Player Statistics, and Future Schedule
      for (const match of db.matches) {
        let matchChanged = false;
        const isMatchCompleted = !!match.isComplete;

        if (match.homeTeamId === dup.id || (match as any).home_team_id === dup.id) {
          match.homeTeamId = primary.id;
          (match as any).home_team_id = primary.id;
          matchChanged = true;
        }

        if (match.awayTeamId === dup.id || (match as any).away_team_id === dup.id) {
          match.awayTeamId = primary.id;
          (match as any).away_team_id = primary.id;
          matchChanged = true;
        }

        // Remap player scores in innings
        if (match.innings && Array.isArray(match.innings)) {
          match.innings.forEach(inning => {
            ['home', 'away'].forEach(sideKey => {
              const teamInning = (inning as any)[sideKey];
              if (teamInning && Array.isArray(teamInning.playerScores)) {
                teamInning.playerScores.forEach((ps: any) => {
                  if (playerMap.has(ps.playerId)) {
                    ps.playerId = playerMap.get(ps.playerId)!;
                    matchChanged = true;
                  }
                });
              }
            });
          });
        }

        // Remap tie-breaker participants
        if (match.tieBreaker && Array.isArray(match.tieBreaker)) {
          match.tieBreaker.forEach(tb => {
            if (playerMap.has(tb.homePlayerId)) {
              tb.homePlayerId = playerMap.get(tb.homePlayerId)!;
              matchChanged = true;
            }
            if (playerMap.has(tb.awayPlayerId)) {
              tb.awayPlayerId = playerMap.get(tb.awayPlayerId)!;
              matchChanged = true;
            }
          });
        }

        if (matchChanged) {
          result.matchesUpdated++;
          if (isMatchCompleted) {
            result.finalizedMatchesUpdated++;
            result.details.push(
              `Migrated finalized game stats & box score for match ${match.id} (${match.date || 'unknown date'}) to ${OFFICIAL_TEAM_NAME}.`
            );
          } else {
            result.scheduledMatchesUpdated++;
          }
        }
      }

      // C. Remove Duplicate Entry
      db.teams = db.teams.filter(t => t.id !== dup.id);
      result.teamsMerged++;
    } else {
      // If no official C-C-Crushers! team exists in this league, rename the duplicate to the official name
      result.details.push(
        `Renaming team "${dup.name}" (ID: ${dup.id}) to official "${OFFICIAL_TEAM_NAME}" in league "${dup.league}".`
      );
      dup.name = OFFICIAL_TEAM_NAME;
      result.teamsRenamed++;
    }
  }

  return result;
}
