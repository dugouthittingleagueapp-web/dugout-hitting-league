import { describe, it, expect } from 'vitest';
import {
  parseMatchTimeToMinutes,
  getMatchDateKey,
  sortMatchesChronologically,
} from '../../utils/matchSort';
import { Match } from '../../types';

describe('Chronological Match Sorting Utility', () => {
  describe('parseMatchTimeToMinutes', () => {
    it('parses standard 12-hour PM and AM times to minutes from midnight', () => {
      expect(parseMatchTimeToMinutes('10:00 am')).toBe(600); // 10 * 60
      expect(parseMatchTimeToMinutes('11:30 am')).toBe(690); // 11 * 60 + 30
      expect(parseMatchTimeToMinutes('12:00 pm')).toBe(720); // noon
      expect(parseMatchTimeToMinutes('12:45 pm')).toBe(765);
      expect(parseMatchTimeToMinutes('1:00 pm')).toBe(780); // 13 * 60
      expect(parseMatchTimeToMinutes('6:00 pm')).toBe(1080); // 18 * 60
      expect(parseMatchTimeToMinutes('7:15 pm')).toBe(1155); // 19 * 60 + 15
      expect(parseMatchTimeToMinutes('12:00 am')).toBe(0); // midnight
      expect(parseMatchTimeToMinutes('12:30 am')).toBe(30);
    });

    it('parses 24-hour military format strings', () => {
      expect(parseMatchTimeToMinutes('09:30')).toBe(570);
      expect(parseMatchTimeToMinutes('18:00')).toBe(1080);
      expect(parseMatchTimeToMinutes('19:15')).toBe(1155);
    });

    it('falls back to extracting time from ISO string when startTime is omitted', () => {
      expect(parseMatchTimeToMinutes(undefined, '2026-11-02T19:15:00.000Z')).toBe(1155);
      expect(parseMatchTimeToMinutes(null, '2026-11-02T10:00:00.000Z')).toBe(600);
    });

    it('defaults to 18:00 (1080 minutes) if neither startTime nor ISO time is available', () => {
      expect(parseMatchTimeToMinutes(undefined, '2026-11-02')).toBe(1080);
      expect(parseMatchTimeToMinutes('', '')).toBe(1080);
    });
  });

  describe('getMatchDateKey', () => {
    it('extracts YYYY-MM-DD from standard ISO strings and plain date strings', () => {
      expect(getMatchDateKey('2026-11-02')).toBe('2026-11-02');
      expect(getMatchDateKey('2026-11-02T18:00:00.000Z')).toBe('2026-11-02');
      expect(getMatchDateKey('11/02/2026')).toBe('2026-11-02');
      expect(getMatchDateKey('11/2/2026')).toBe('2026-11-02');
    });
  });

  describe('sortMatchesChronologically', () => {
    it('sorts same-day matches chronologically (early games like 6:00 PM appear before 7:15 PM)', () => {
      const matchLate: Match = {
        id: 'match-late',
        league: '9U',
        season: '2026',
        homeTeamId: 't1',
        awayTeamId: 't2',
        date: '2026-11-02',
        startTime: '7:15 pm',
        innings: [],
        isComplete: false,
      };

      const matchEarly: Match = {
        id: 'match-early',
        league: '9U',
        season: '2026',
        homeTeamId: 't3',
        awayTeamId: 't4',
        date: '2026-11-02',
        startTime: '6:00 pm',
        innings: [],
        isComplete: false,
      };

      // Input in reverse order (late then early)
      const input = [matchLate, matchEarly];
      const sorted = sortMatchesChronologically(input);

      expect(sorted[0].id).toBe('match-early');
      expect(sorted[0].startTime).toBe('6:00 pm');
      expect(sorted[1].id).toBe('match-late');
      expect(sorted[1].startTime).toBe('7:15 pm');
    });

    it('sorts morning games before afternoon games before evening games', () => {
      const gEvening: Match = {
        id: 'evening',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-02',
        startTime: '6:00 pm',
        innings: [],
        isComplete: false,
      };
      const gMorning: Match = {
        id: 'morning',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-02',
        startTime: '10:00 am',
        innings: [],
        isComplete: false,
      };
      const gAfternoon: Match = {
        id: 'afternoon',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-02',
        startTime: '1:30 pm',
        innings: [],
        isComplete: false,
      };

      const sorted = sortMatchesChronologically([gEvening, gMorning, gAfternoon]);

      expect(sorted.map(m => m.id)).toEqual(['morning', 'afternoon', 'evening']);
    });

    it('sorts dates across multiple weeks in ascending chronological order', () => {
      const week3: Match = {
        id: 'w3',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-16',
        startTime: '6:00 pm',
        innings: [],
        isComplete: false,
      };
      const week1: Match = {
        id: 'w1',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-02',
        startTime: '7:15 pm',
        innings: [],
        isComplete: false,
      };
      const week2: Match = {
        id: 'w2',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-09',
        startTime: '6:00 pm',
        innings: [],
        isComplete: false,
      };

      const sorted = sortMatchesChronologically([week3, week1, week2]);

      expect(sorted.map(m => m.id)).toEqual(['w1', 'w2', 'w3']);
    });

    it('uses ID ascending as a stable tie-breaker for matches at the exact same date and time', () => {
      const m1: Match = {
        id: 'match-b',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-02',
        startTime: '6:00 pm',
        innings: [],
        isComplete: false,
      };
      const m2: Match = {
        id: 'match-a',
        league: '9U',
        season: '2026',
        homeTeamId: 'h',
        awayTeamId: 'a',
        date: '2026-11-02',
        startTime: '6:00 pm',
        innings: [],
        isComplete: false,
      };

      const sorted = sortMatchesChronologically([m1, m2]);
      expect(sorted.map(m => m.id)).toEqual(['match-a', 'match-b']);
    });

    it('does not mutate the source array', () => {
      const original = [
        { id: '2', date: '2026-11-02', startTime: '7:00 pm', innings: [] },
        { id: '1', date: '2026-11-02', startTime: '6:00 pm', innings: [] },
      ];
      const sorted = sortMatchesChronologically(original as any);
      expect(original[0].id).toBe('2');
      expect(sorted[0].id).toBe('1');
    });
  });
});
