/** Calendar and time rules shared by CSV imports, schedule editing and the API. */
export const scheduleDateKey = (value: string): string | null => {
  const clean = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(clean);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean);
  if (!iso && !us) return null;
  const year = Number(iso ? iso[1] : us![3]);
  const month = Number(iso ? iso[2] : us![1]);
  const day = Number(iso ? iso[3] : us![2]);
  if (year < 1000 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (clean.includes('T') && !Number.isFinite(Date.parse(clean))) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** Accept 12-hour (6:00 pm, 6 p.m.) or 24-hour (18:00) input. */
export const scheduleTimeMinutes = (value: string): number | null => {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(value.trim()) ||
    /^(\d{1,2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const period = match[3]?.toLowerCase();
  if (minute > 59 || hour > (period ? 12 : 23) || (period && hour < 1)) return null;
  if (period) hour = hour % 12 + (period === 'p' ? 12 : 0);
  return hour * 60 + minute;
};

export const scheduleDateTimeError = (date: string, start: string, end: string): string | null => {
  if (!scheduleDateKey(date)) return 'Enter a real calendar date (YYYY-MM-DD or MM/DD/YYYY).';
  const startMinutes = scheduleTimeMinutes(start);
  const endMinutes = scheduleTimeMinutes(end);
  if (startMinutes === null || endMinutes === null) return 'Enter valid start and end times, such as 6:00 pm or 18:00.';
  if (endMinutes <= startMinutes) return 'End time must be after start time on the same day.';
  return null;
};

export const CAGE_LOCATIONS = [
  { value: 'The Dugout: Tunnels 5/6', label: 'Tunnels 5/6' },
  { value: 'The Dugout: Tunnels 7/8', label: 'Tunnels 7/8' }
] as const;

export const canonicalCage = (value?: string): string | null => {
  const key = value?.trim().toLowerCase();
  return CAGE_LOCATIONS.find(cage => cage.value.toLowerCase() === key || cage.label.toLowerCase() === key)?.value ?? null;
};
