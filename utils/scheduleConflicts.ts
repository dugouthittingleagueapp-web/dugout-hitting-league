import { canonicalCage, scheduleDateKey, scheduleTimeMinutes } from './scheduleValidation.js';

export interface ScheduleBooking {
  id?: string;
  season?: string;
  league: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  csvRow?: number;
}

const interval = (game: ScheduleBooking): [number, number] | null => {
  const start = scheduleTimeMinutes(game.startTime || ''), end = scheduleTimeMinutes(game.endTime || '');
  return start !== null && end !== null && end > start ? [start, end] : null;
};
const describe = (game: ScheduleBooking): string =>
  `${game.csvRow ? `CSV row ${game.csvRow}` : 'Saved game'}: ${game.homeTeamName || 'Home team'} vs ${game.awayTeamName || 'Away team'} (${game.league}), ${scheduleDateKey(game.date) || game.date}, ${game.startTime || '?'}–${game.endTime || '?'}, ${canonicalCage(game.location || '') || game.location || 'location not set'}`;

/** Half-open time ranges allow back-to-back games. Never compare team names as identities. */
export const findScheduleConflicts = (candidate: ScheduleBooking, bookings: ScheduleBooking[], limit = 20): string[] => {
  const errors: string[] = [], day = scheduleDateKey(candidate.date), time = interval(candidate);
  if (!day || !time) return errors;
  const cage = canonicalCage(candidate.location || '');
  for (const other of bookings) {
    if ((candidate.id && candidate.id === other.id) || scheduleDateKey(other.date) !== day) continue;
    const sameCage = !!cage && cage === canonicalCage(other.location || '');
    const shared = [...new Set([candidate.homeTeamId, candidate.awayTeamId])]
      .filter(id => id && [other.homeTeamId, other.awayTeamId].includes(id));
    if (!sameCage && !shared.length) continue;
    const otherTime = interval(other);
    if (!otherTime) {
      errors.push(`${describe(candidate)} cannot be checked against ${describe(other)} because that saved game is missing valid start/end times. Ask an admin to check its time first.`);
    } else if (time[0] < otherTime[1] && otherTime[0] < time[1]) {
      const reasons = [
        ...(sameCage ? [`${cage!.replace('The Dugout: ', '')} is already booked`] : []),
        ...shared.map(id => `${id === candidate.homeTeamId ? candidate.homeTeamName || 'The home team' : candidate.awayTeamName || 'The away team'} already has a game`),
      ];
      errors.push(`${describe(candidate)} overlaps ${describe(other)}. ${reasons.join('; ')}. Choose another time or tunnels.`);
    }
    if (errors.length >= limit) break;
  }
  return errors;
};
