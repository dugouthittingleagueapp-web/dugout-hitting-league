import type { Player } from '../types.js';
import { stableJson } from '../utils/scoringProtocol.js';
import { ScheduleError } from './scheduleTransaction.js';

type Roster = { players: Player[]; subs: Player[] };
const array = (value: unknown): Player[] => typeof value === 'string' ? JSON.parse(value) : Array.isArray(value) ? value : [];

/** Roster edits preserve identities; a player leaving the regular lineup stays a substitute. */
export const validateRosterChange = (current: { players: unknown; subs: unknown }, body: any): Roster => {
  const stored = { players: array(current.players), subs: array(current.subs) };
  if (!body.expectedRoster || stableJson(body.expectedRoster) !== stableJson(stored))
    throw new ScheduleError(409, 'This roster changed on another screen. Reload the roster before saving.');
  const { players, subs } = body;
  if (!Array.isArray(players) || players.length < 2 || players.length > 3 || !Array.isArray(subs) || subs.length > 50)
    throw new ScheduleError(400, 'Choose two or three team players and up to 50 substitutes.');
  const clean = (list: unknown[]): Player[] => list.map((p: any) => {
    if (!p || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 128 ||
        typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 80 ||
        (p.lastName !== undefined && (typeof p.lastName !== 'string' || p.lastName.trim().length > 80)))
      throw new ScheduleError(400, 'Enter a first name for every player and keep names under 80 characters.');
    return { id: p.id, name: p.name.trim(), lastName: (p.lastName || '').trim() };
  });
  const result = { players: clean(players), subs: clean(subs) };
  const ids = new Set([...result.players, ...result.subs].map(p => p.id));
  if (ids.size !== players.length + subs.length) throw new ScheduleError(400, 'Each player can appear only once on this roster.');
  if ([...stored.players, ...stored.subs].some(p => !ids.has(p.id)))
    throw new ScheduleError(409, 'Keep existing players on the roster. Move a team player to substitutes to preserve their game history.');
  return result;
};
