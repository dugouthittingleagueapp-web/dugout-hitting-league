import { describe, expect, it } from 'vitest';
import { scheduleDateKey, scheduleTimeMinutes, scheduleDateTimeError } from '../../utils/scheduleValidation';
import { parseScheduleCsv } from '../../utils/scheduleImporter';
import { mapMatchFromDB } from '../../utils/dbMappers';

const csv = (rows: string[]) => ['Date,Start Time,End Time,Home Team,Away Team,Location', ...rows.map(row => row + ',Tunnels 5/6')].join('\n');

describe('Shared schedule date and time rules', () => {
  it('accepts leap days only in leap years and rejects calendar rollovers', () => {
    expect(scheduleDateKey('2028-02-29')).toBe('2028-02-29');
    expect(scheduleDateKey('2/29/2028')).toBe('2028-02-29');
    for (const invalid of ['2027-02-29', '2027-02-30', '2027-04-31', '2027-13-01', '2027-00-01', '2027-11-00']) {
      expect(scheduleDateKey(invalid)).toBeNull();
    }
  });

  it('treats 12-hour and 24-hour input consistently, including noon and midnight', () => {
    expect(scheduleTimeMinutes('6:00 pm')).toBe(1080);
    expect(scheduleTimeMinutes('18:00')).toBe(1080);
    expect(scheduleTimeMinutes('6 p.m.')).toBe(1080);
    expect(scheduleTimeMinutes('12:00 am')).toBe(0);
    expect(scheduleTimeMinutes('12:00 pm')).toBe(720);
    for (const invalid of ['', '25:00', '6:60 pm', '13:00 pm', '0 am', 'later', '6:00 pm garbage']) {
      expect(scheduleTimeMinutes(invalid)).toBeNull();
    }
  });

  it('rejects reversed or equal times but accepts equivalent time formats', () => {
    expect(scheduleDateTimeError('2027-11-01', '6:00 pm', '19:00')).toBeNull();
    expect(scheduleDateTimeError('2027-11-01', '7:00 pm', '6:00 pm')).toMatch(/after start/);
    expect(scheduleDateTimeError('2027-11-01', '6:00 pm', '18:00')).toMatch(/after start/);
  });

  it('reports invalid CSV rows and still previews valid rows in chronological order', () => {
    const result = parseScheduleCsv(csv([
      '2027-02-30,6:00 pm,7:00 pm,A,B',
      '2027-11-01,9:00 pm,10:00 pm,A,B',
      '2027-11-01,9:00 am,10:00 am,C,D',
      '2027-11-01,12:00 pm,1:00 pm,E,F',
      '2027-11-01,6:00 pm,5:00 pm,G,H',
      '2027-11-01,later,7:00 pm,I,J',
    ]));
    expect(result.games.map(game => game.homeTeamName)).toEqual(['C', 'E', 'A']);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join(' ')).toMatch(/Row 2:.*calendar/);
    expect(result.games[0].scheduledIsoDate).toBe('2027-11-01T09:00:00.000Z');
  });

  it('keeps saved notes in the app model, including an intentionally cleared note', () => {
    const row = { id: 'scheduled', season: '2027', innings: [], notes: 'Bring spare balls' };
    expect(mapMatchFromDB(row).notes).toBe('Bring spare balls');
    expect(mapMatchFromDB({ ...row, notes: '' }).notes).toBe('');
    expect(mapMatchFromDB({ ...row, notes: null }).notes).toBeUndefined();
  });
});
