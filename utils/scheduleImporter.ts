import { Match, Team, League, ScheduledGameRecord, ScheduleImportSummary, Inning } from '../types';
import { generateUUID, createEmptyInning, leaguesMatch } from '../services/storageService';

/**
 * Robust CSV parser that correctly handles quoted values, embedded commas,
 * escaped quotes, and different newline conventions (\r\n or \n).
 */
export const parseCSV = (csvText: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote ("") inside quotes
        currentCell += '"';
        i++; // skip next quote
      } else {
        // Toggle quote mode
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n in CRLF
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  // Push final cell and row if anything remains
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
};

/**
 * Parses time string like "6:00 pm", "7:15 pm", "18:00" into { hours, minutes } in 24h format.
 */
export const parseTimeString = (timeStr?: string): { hours: number; minutes: number } => {
  if (!timeStr) return { hours: 18, minutes: 0 };
  const clean = timeStr.trim().toLowerCase();
  const isPM = clean.includes('pm');
  const isAM = clean.includes('am');
  const numbersOnly = clean.replace(/[^\d:]/g, '');
  const [hStr, mStr] = numbersOnly.split(':');
  let hours = parseInt(hStr || '18', 10);
  const minutes = parseInt(mStr || '0', 10);

  if (isPM && hours < 12) {
    hours += 12;
  } else if (isAM && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
};

/**
 * Combines date string ("2026-11-02") and time string ("6:00 pm") into an ISO timestamp.
 */
export const combineDateAndTime = (dateStr: string, timeStr?: string): string => {
  const cleanDate = dateStr.trim();
  const { hours, minutes } = parseTimeString(timeStr);
  const pad = (n: number) => n.toString().padStart(2, '0');

  // If date already contains full ISO string, keep or parse it
  if (cleanDate.includes('T')) {
    return new Date(cleanDate).toISOString();
  }

  // Create date using standard YYYY-MM-DD format
  const dateParts = cleanDate.split(/[-/]/);
  let year = new Date().getFullYear();
  let month = 1;
  let day = 1;

  if (dateParts.length === 3) {
    if (dateParts[0].length === 4) {
      // YYYY-MM-DD
      year = parseInt(dateParts[0], 10);
      month = parseInt(dateParts[1], 10);
      day = parseInt(dateParts[2], 10);
    } else {
      // MM/DD/YYYY
      month = parseInt(dateParts[0], 10);
      day = parseInt(dateParts[1], 10);
      year = parseInt(dateParts[2], 10);
    }
  }

  // Construct ISO string
  const dateObj = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  return dateObj.toISOString();
};

/**
 * Column header matcher for flexible dynamic CSV import
 */
export interface ColumnIndices {
  date: number;
  startTime: number;
  endTime: number;
  location: number;
  group: number;
  homeTeam: number;
  awayTeam: number;
  eventType: number;
  notes: number;
}

export const findColumnIndices = (headers: string[]): ColumnIndices => {
  const normalized = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const findIdx = (patterns: string[]): number => {
    for (const pattern of patterns) {
      const idx = normalized.findIndex(h => h.includes(pattern));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  return {
    date: findIdx(['date', 'day']),
    startTime: findIdx(['starttime', 'start', 'time']),
    endTime: findIdx(['endtime', 'end']),
    location: findIdx(['location', 'venue', 'tunnel', 'field']),
    group: findIdx(['group', 'league', 'division', 'agegroup']),
    homeTeam: findIdx(['hometeam', 'home']),
    awayTeam: findIdx(['awayteam', 'away']),
    eventType: findIdx(['eventtype', 'type', 'event']),
    notes: findIdx(['notes', 'note', 'comment', 'description']),
  };
};

/**
 * Parse CSV raw text into structured ScheduledGameRecord objects with full validation.
 */
export const parseScheduleCsv = (
  csvContent: string,
  options?: { targetLeague?: string; defaultLeague?: string; defaultSeason?: string }
): { games: ScheduledGameRecord[]; errors: string[] } => {
  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return { games: [], errors: ['CSV file is empty or missing headers'] };
  }

  const headers = rows[0];
  const indices = findColumnIndices(headers);

  if (indices.date === -1) {
    return { games: [], errors: ['Could not find "Date" column in CSV headers'] };
  }
  if (indices.homeTeam === -1 || indices.awayTeam === -1) {
    return { games: [], errors: ['Could not find "Home Team" and/or "Away Team" columns in CSV headers'] };
  }

  const games: ScheduledGameRecord[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every(cell => !cell.trim())) continue;

    const rowNum = i + 1;
    const date = row[indices.date]?.trim() || '';
    const homeTeamName = row[indices.homeTeam]?.trim() || '';
    const awayTeamName = row[indices.awayTeam]?.trim() || '';

    if (!date) {
      errors.push(`Row ${rowNum}: Missing game date, skipped.`);
      continue;
    }
    if (!homeTeamName || !awayTeamName) {
      errors.push(`Row ${rowNum}: Missing Home or Away team name, skipped.`);
      continue;
    }

    const eventType = indices.eventType !== -1 ? row[indices.eventType]?.trim() : 'Game';
    // If CSV specifies event type and it's not a game/practice (e.g. "Meeting"), skip
    if (eventType && !eventType.toLowerCase().includes('game') && !eventType.toLowerCase().includes('match')) {
      continue;
    }

    const startTime = indices.startTime !== -1 ? row[indices.startTime]?.trim() : '6:00 pm';
    const endTime = indices.endTime !== -1 ? row[indices.endTime]?.trim() : '7:00 pm';
    const location = indices.location !== -1 ? row[indices.location]?.trim() : 'The Dugout';
    const csvGroup = indices.group !== -1 ? row[indices.group]?.trim() : '';
    // If user explicitly directed the schedule to an existing app league, prioritize targetLeague
    const group = (options?.targetLeague && options.targetLeague.trim()) 
      ? options.targetLeague.trim() 
      : (csvGroup || options?.defaultLeague || '9U 3v3');
    const notes = indices.notes !== -1 ? row[indices.notes]?.trim() : undefined;

    const scheduledIsoDate = combineDateAndTime(date, startTime);
    const inferredSeason = options?.defaultSeason || String(new Date(scheduledIsoDate).getFullYear());

    games.push({
      date,
      startTime,
      endTime,
      location,
      group,
      csvGroup: csvGroup || undefined,
      homeTeamName,
      awayTeamName,
      notes,
      scheduledIsoDate,
      season: inferredSeason,
    });
  }

  return { games, errors };
};

/**
 * Checks whether a candidate game matches an existing match in the database to prevent duplicate scheduling.
 */
export const isDuplicateMatch = (
  candidate: ScheduledGameRecord,
  homeTeamId: string,
  awayTeamId: string,
  existingMatches: Match[]
): boolean => {
  const candidateDay = candidate.scheduledIsoDate.substring(0, 10);

  return existingMatches.some(m => {
    // 1. Same season and league check
    if (!leaguesMatch(m.league, candidate.group)) return false;
    if (m.season && candidate.season && m.season !== candidate.season) return false;

    // 2. Same teams participating
    const sameTeams =
      (m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
      (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId);
    if (!sameTeams) return false;

    // 3. Same calendar date (YYYY-MM-DD)
    const existingDay = m.date ? m.date.substring(0, 10) : '';
    if (existingDay === candidateDay) return true;

    // 4. Exact timestamp match
    if (m.date === candidate.scheduledIsoDate) return true;

    return false;
  });
};

/**
 * Formats a default team record if team needs auto-creation.
 */
export const buildAutoCreatedTeam = (
  teamName: string,
  league: string,
  season: string
): Team => {
  return {
    id: generateUUID(),
    name: teamName.trim(),
    league: league.trim(),
    season,
    players: [
      { id: generateUUID(), name: `${teamName.trim()} Player 1` },
      { id: generateUUID(), name: `${teamName.trim()} Player 2` },
      { id: generateUUID(), name: `${teamName.trim()} Player 3` },
    ],
    subs: [],
  };
};
