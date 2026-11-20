import type { Team } from '../types';
import { leaguesMatch } from './leagueNames';

/** Cache only a confirmed server result; storage failure must not undo a successful save. */
export const cacheConfirmedTeam = (storage: Storage, team: Team): void => {
  try { storage.setItem(`dugout_team_${team.id}`, JSON.stringify(team)); } catch {}
  let keys: string[];
  try { keys = Array.from({length: storage.length}, (_, index) => storage.key(index)).filter((key): key is string => !!key); }
  catch { return; }
  for (const key of keys) {
    const prefix = `dugout_teams_${team.season}_`;
    if (key !== 'dugout_all_teams_cache' && !key.startsWith(prefix)) continue;
    try {
      const list = JSON.parse(storage.getItem(key) || 'null');
      if (!Array.isArray(list)) continue;
      const updated = list.filter(entry => entry.id !== team.id);
      const league = key.slice(prefix.length);
      if (key === 'dugout_all_teams_cache' || league === 'all' || leaguesMatch(league, team.league)) updated.push(team);
      storage.setItem(key, JSON.stringify(updated));
    } catch {}
  }
};
