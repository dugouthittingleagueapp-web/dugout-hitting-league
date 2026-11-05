import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  parseTimeString,
  combineDateAndTime,
  findColumnIndices,
  parseScheduleCsv,
  isDuplicateMatch,
  buildAutoCreatedTeam,
} from '../../utils/scheduleImporter';
import { Match } from '../../types';

describe('Schedule Importer Utility', () => {
  describe('parseCSV', () => {
    it('correctly parses comma-separated values with quoted cells and embedded commas', () => {
      const csv = 'Date,"Start Time",Location,"Home Team"\n2026-11-02,"6:00 pm","The Dugout: Tunnels 5/6","Banana Bros"';
      const rows = parseCSV(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(['Date', 'Start Time', 'Location', 'Home Team']);
      expect(rows[1]).toEqual(['2026-11-02', '6:00 pm', 'The Dugout: Tunnels 5/6', 'Banana Bros']);
    });

    it('handles CRLF line breaks and trailing empty rows', () => {
      const csv = 'Header1,Header2\r\nVal1,Val2\r\n\r\n';
      const rows = parseCSV(csv);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toEqual(['Val1', 'Val2']);
    });
  });

  describe('parseTimeString and combineDateAndTime', () => {
    it('parses 12h PM and AM times into 24h hours and minutes', () => {
      expect(parseTimeString('6:00 pm')).toEqual({ hours: 18, minutes: 0 });
      expect(parseTimeString('7:15 pm')).toEqual({ hours: 19, minutes: 15 });
      expect(parseTimeString('11:30 am')).toEqual({ hours: 11, minutes: 30 });
      expect(parseTimeString('12:00 pm')).toEqual({ hours: 12, minutes: 0 });
      expect(parseTimeString('12:30 am')).toEqual({ hours: 0, minutes: 30 });
    });

    it('combines calendar date and start time into a valid ISO string', () => {
      const iso = combineDateAndTime('2026-11-02', '6:00 pm');
      expect(iso).toContain('2026-11-02T18:00:00');
    });
  });

  describe('findColumnIndices', () => {
    it('dynamically identifies headers regardless of casing and spacing', () => {
      const headers = ['Date', 'Start Time', 'End Time', 'Location', 'Group', 'Event Type', 'Notes', 'Home Team', 'Away Team'];
      const indices = findColumnIndices(headers);
      expect(indices.date).toBe(0);
      expect(indices.startTime).toBe(1);
      expect(indices.endTime).toBe(2);
      expect(indices.location).toBe(3);
      expect(indices.group).toBe(4);
      expect(indices.homeTeam).toBe(7);
      expect(indices.awayTeam).toBe(8);
    });
  });

  describe('parseScheduleCsv', () => {
    const sampleCsv = `Date,"Start Time","End Time",Location,Group,"Event Type",Notes,"Home Team","Away Team"
2026-11-02,"6:00 pm","7:00 pm","The Dugout: Tunnels 5/6","9U 3v3",Game,,"Banana Bros","Raiders Bomb Squad"
2026-11-02,"6:00 pm","7:00 pm","The Dugout: Tunnels 7/8","9U 3v3",Game,,"AYRA Bright",C-C-Crushers!
2026-11-02,"7:15 pm","8:15 pm","The Dugout: Tunnels 5/6","9U 3v3",Game,,"Backyard Bomberz","Grand Slam Orioles"
2026-11-02,"7:15 pm","8:15 pm","The Dugout: Tunnels 7/8","9U 3v3",Game,,"Baseball Team","The Baseball Buddies"`;

    it('parses valid CSV rows into ScheduledGameRecord objects', () => {
      const { games, errors } = parseScheduleCsv(sampleCsv);
      expect(errors).toHaveLength(0);
      expect(games).toHaveLength(4);

      expect(games[0]).toMatchObject({
        date: '2026-11-02',
        startTime: '6:00 pm',
        endTime: '7:00 pm',
        location: 'The Dugout: Tunnels 5/6',
        group: '9U 3v3',
        homeTeamName: 'Banana Bros',
        awayTeamName: 'Raiders Bomb Squad',
        season: '2026',
      });
      expect(games[0].scheduledIsoDate).toBeDefined();
    });

    it('directs schedule games to the selected existing league regardless of internal CSV group name', () => {
      // CSV internal group is "9U 3v3", user directs it to app league "9U - Mondays"
      const { games } = parseScheduleCsv(sampleCsv, {
        targetLeague: '9U - Mondays',
        defaultSeason: '2026',
      });
      expect(games).toHaveLength(4);
      games.forEach(g => {
        expect(g.group).toBe('9U - Mondays');
        expect(g.csvGroup).toBe('9U 3v3');
      });
    });

    it('returns error when essential headers are missing', () => {
      const badCsv = 'HeaderA,HeaderB\nValA,ValB';
      const { games, errors } = parseScheduleCsv(badCsv);
      expect(games).toHaveLength(0);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('isDuplicateMatch', () => {
    const existingMatch: Match = {
      id: 'match-1',
      league: '9U 3v3',
      season: '2026',
      homeTeamId: 'team-home',
      awayTeamId: 'team-away',
      date: '2026-11-02T18:00:00.000Z',
      isComplete: false,
      is_practice: false,
      innings: [],
    };

    it('detects duplicate match when same teams play on the same date and league', () => {
      const candidate = {
        date: '2026-11-02',
        startTime: '6:00 pm',
        endTime: '7:00 pm',
        location: 'Tunnel 5',
        group: '9U 3v3',
        homeTeamName: 'Home',
        awayTeamName: 'Away',
        scheduledIsoDate: '2026-11-02T18:00:00.000Z',
        season: '2026',
      };

      expect(isDuplicateMatch(candidate, 'team-home', 'team-away', [existingMatch])).toBe(true);
      // Even if home and away teams are reversed on the same day
      expect(isDuplicateMatch(candidate, 'team-away', 'team-home', [existingMatch])).toBe(true);
    });

    it('allows scheduling if date is different', () => {
      const candidate = {
        date: '2026-11-09',
        startTime: '6:00 pm',
        endTime: '7:00 pm',
        location: 'Tunnel 5',
        group: '9U 3v3',
        homeTeamName: 'Home',
        awayTeamName: 'Away',
        scheduledIsoDate: '2026-11-09T18:00:00.000Z',
        season: '2026',
      };

      expect(isDuplicateMatch(candidate, 'team-home', 'team-away', [existingMatch])).toBe(false);
    });
  });

  describe('buildAutoCreatedTeam', () => {
    it('creates team with 3 default player slots ready for roster assignment', () => {
      const team = buildAutoCreatedTeam('Banana Bros', '9U 3v3', '2026');
      expect(team.name).toBe('Banana Bros');
      expect(team.league).toBe('9U 3v3');
      expect(team.season).toBe('2026');
      expect(team.players).toHaveLength(3);
      expect(team.players[0].name).toBe('Banana Bros Player 1');
    });
  });
});
