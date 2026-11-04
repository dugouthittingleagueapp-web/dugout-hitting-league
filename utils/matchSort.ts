
/**
 * Parses a time string (12h or 24h, with or without AM/PM) or an ISO date into total minutes from midnight (0 - 1439).
 */
export const parseMatchTimeToMinutes = (timeStr?: string | null, dateStr?: string | null): number => {
  if (timeStr && typeof timeStr === 'string' && timeStr.trim().length > 0) {
    const clean = timeStr.trim().toLowerCase();
    const isPM = clean.includes('pm') || clean.includes('p.m.');
    const isAM = clean.includes('am') || clean.includes('a.m.');
    const numbersOnly = clean.replace(/[^\d:]/g, '');
    const [hStr, mStr] = numbersOnly.split(':');
    let hours = parseInt(hStr || '0', 10);
    const minutes = parseInt(mStr || '0', 10);

    if (isPM && hours < 12) {
      hours += 12;
    } else if (isAM && hours === 12) {
      hours = 0;
    }

    return hours * 60 + minutes;
  }

  // Fallback: extract time from ISO date string if present
  if (dateStr && typeof dateStr === 'string' && dateStr.includes('T')) {
    const timeMatch = dateStr.match(/T(\d{2}):(\d{2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      return hours * 60 + minutes;
    }
  }

  // Default to 18:00 (6:00 PM) if completely unspecified
  return 18 * 60;
};

/**
 * Standardizes match date into YYYY-MM-DD format for chronological comparison.
 */
export const getMatchDateKey = (dateStr?: string | null): string => {
  if (!dateStr) return '9999-99-99';
  const clean = dateStr.trim();
  
  // Standard ISO prefix YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    return clean.slice(0, 10);
  }

  // Handle MM/DD/YYYY or M/D/YYYY
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 3) {
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      let year = parts[2];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }
  }

  // Try standard Date parse
  try {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch {}

  return clean;
};

/**
 * Sorts games/matches in strict chronological order (earliest to latest / ascending):
 * 1. By calendar date ascending (e.g., 2026-11-02 before 2026-11-09)
 * 2. By start time ascending (e.g., 10:00 AM before 1:00 PM before 6:00 PM before 7:15 PM)
 * 3. By ID ascending as a deterministic tie-breaker
 */
export const sortMatchesChronologically = <T extends { date: string; startTime?: string; id?: string }>(
  matches: T[]
): T[] => {
  if (!Array.isArray(matches) || matches.length <= 1) return [...(matches || [])];

  return [...matches].sort((a, b) => {
    // 1. Calendar date comparison
    const dateA = getMatchDateKey(a.date);
    const dateB = getMatchDateKey(b.date);
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    // 2. Start time of day comparison (minutes from midnight)
    const timeA = parseMatchTimeToMinutes(a.startTime, a.date);
    const timeB = parseMatchTimeToMinutes(b.startTime, b.date);
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    // 3. Stable tie-breaker
    const idA = a.id || '';
    const idB = b.id || '';
    return idA.localeCompare(idB);
  });
};
