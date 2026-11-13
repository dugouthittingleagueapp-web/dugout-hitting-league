import type { Match } from '../types';
import { sortMatchesChronologically } from './matchSort';

// Schedule grouping is pure and shared across dashboard and tests.
// Helper to get ISO Week Key (YYYY-Www) with zero-padded week to ensure natural chronological sorting
export const getWeekKey = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(( ( (d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const paddedWeek = String(weekNo).padStart(2, '0');
    return `${d.getFullYear()}-W${paddedWeek}`;
};


export interface ScheduleWeek { id: string; label: string; matches: Match[] }

export const groupMatchesByWeek = (
  matches: Match[],
  currentLeague: string | null,
  leaguesMatch: (a?: string | null, b?: string | null) => boolean
): ScheduleWeek[] => {
  if (!currentLeague) return [];
  const weeksMap = new Map<string, Match[]>();
  matches.forEach(m => {
    if (m.league && !leaguesMatch(m.league, currentLeague)) return;
    const key = getWeekKey(m.date);
    if (!weeksMap.has(key)) weeksMap.set(key, []);
    weeksMap.get(key)!.push(m);
  });
  const sortedKeys = Array.from(weeksMap.keys()).sort();
  return sortedKeys.map((key, index) => ({
    id: key,
    label: `Week ${index + 1}`,
    matches: sortMatchesChronologically(weeksMap.get(key)!),
  }));
};
