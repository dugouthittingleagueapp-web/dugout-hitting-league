import type { Player, Team } from '../types';

export interface PlayerIdentityLink { rosterPlayerId: string; personId: string; resolution: string; }
export interface PlayerIdentityCandidate { personId: string; name: string; lastName?: string; aliases?: Pick<Player, 'name' | 'lastName'>[]; teams: { teamId?: string; teamName: string; league?: string; season: string }[]; }
export const playerHistoryTeamLabel = (team: PlayerIdentityCandidate['teams'][number]): string =>
  `${team.teamName}${team.league ? ` · ${team.league}` : ''} (${team.season})`;
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
const nicknameFamilies = [
  ['michael', 'mike', 'mikey'], ['robert', 'rob', 'robbie', 'bob', 'bobby'],
  ['william', 'will', 'bill', 'billy'], ['james', 'jim', 'jimmy', 'jamie'],
  ['daniel', 'dan', 'danny'], ['matthew', 'matt'], ['christopher', 'chris'],
  ['joseph', 'joe', 'joey'], ['nicholas', 'nick', 'nicky'], ['thomas', 'tom', 'tommy'],
  ['benjamin', 'ben', 'benny'], ['alexander', 'alex'], ['samuel', 'sam', 'sammy'],
  ['andrew', 'andy', 'drew'], ['joshua', 'josh'], ['timothy', 'tim', 'timmy']
];
const firstNameFamily = (name: string) => nicknameFamilies.find(family => family.includes(name))?.[0] || name;
export const identityName = (player: Pick<Player, 'name' | 'lastName'>) => {
  const words = normalize(`${player.name} ${player.lastName || ''}`).split(/\s+/).filter(Boolean);
  return { first: words[0] || '', last: words.length > 1 ? words[words.length - 1] : '' };
};
/** Names only find candidates. They never authorize an identity link. */
export const possibleSameName = (a: Pick<Player, 'name' | 'lastName'>, b: Pick<Player, 'name' | 'lastName'>): boolean => {
  const x = identityName(a), y = identityName(b);
  return !!x.first && firstNameFamily(x.first) === firstNameFamily(y.first) && (!x.last || !y.last || x.last === y.last ||
    (x.last.length === 1 || y.last.length === 1) && x.last[0] === y.last[0]);
};
export const priorPlayerCandidates = (player: Player, season: string, history: PlayerIdentityCandidate[], ownPersonId?: string) =>
  history.filter(candidate => candidate.personId !== ownPersonId && candidate.teams.some(team => team.season < season) && [candidate, ...(candidate.aliases || [])].some(name => possibleSameName(player, name)));

/** Select exactly one permanent identity; never fall back to names in career statistics. */
export const careerRosterIds = (id: string, links: PlayerIdentityLink[]): Set<string> => {
  const personId = links.find(link => link.rosterPlayerId === id)?.personId || id;
  const ids = links.filter(link => link.personId === personId).map(link => link.rosterPlayerId);
  return new Set(ids.length ? ids : [id]);
};

/** Initial conversion only: preserve clear cross-season matches, leave ambiguity separate. */
export const planPlayerIdentities = (teams: Team[], uuid: () => string) => {
  const entries = teams.flatMap(team => [...(team.players || []), ...(team.subs || [])].map(player => ({ player, team })));
  const visited = new Set<string>();
  const people: { id: string; name: string; lastName: string }[] = [];
  const links: PlayerIdentityLink[] = [];
  for (const entry of entries) {
    if (visited.has(entry.player.id)) continue;
    // Materialize the existing display-name associations, rather than using
    // broader candidate search rules to infer historical relationships.
    const label = (player: Player) => normalize(`${player.name}${player.lastName ? ' ' + player.lastName.charAt(0) : ''}`);
    const group = entries.filter(other => label(other.player) === label(entry.player));
    const bySeason = new Map<string, Set<string>>();
    const fullLastNames = new Set<string>();
    for (const { player, team } of group) {
      const ids = bySeason.get(team.season) || new Set<string>(); ids.add(player.id); bySeason.set(team.season, ids);
      const last = identityName(player).last; if (last.length > 1) fullLastNames.add(last);
    }
    const clear = [...bySeason.values()].every(ids => ids.size === 1) && fullLastNames.size <= 1 &&
      group.every(a => group.every(b => possibleSameName(a.player, b.player)));
    const selected = clear ? group : entries.filter(e => e.player.id === entry.player.id);
    const distinct = [...new Map(selected.map(e => [e.player.id, e])).values()].filter(e => !visited.has(e.player.id));
    if (!distinct.length) continue;
    const best = [...distinct].sort((a, b) => `${b.player.name} ${b.player.lastName || ''}`.length - `${a.player.name} ${a.player.lastName || ''}`.length)[0].player;
    const personId = uuid(); people.push({ id: personId, name: best.name, lastName: best.lastName || '' });
    for (const { player } of distinct) { visited.add(player.id); links.push({ rosterPlayerId: player.id, personId, resolution: clear ? 'existing' : 'unreviewed' }); }
  }
  return { people, links };
};
