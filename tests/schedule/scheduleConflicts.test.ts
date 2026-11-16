import { describe, expect, it } from 'vitest';
import { findScheduleConflicts, type ScheduleBooking } from '../../utils/scheduleConflicts';

const booking = (changes: Partial<ScheduleBooking> = {}): ScheduleBooking => ({
  id: 'new', league: '11U', date: '2027-11-01', startTime: '6:00 pm', endTime: '7:00 pm', location: 'Tunnels 5/6',
  homeTeamId: 'a', awayTeamId: 'b', homeTeamName: 'Eagles', awayTeamName: 'Panthers', csvRow: 2, ...changes,
});
const other = (changes: Partial<ScheduleBooking> = {}) => booking({ id: 'old', league: '12U', homeTeamId: 'c', awayTeamId: 'd',
  homeTeamName: 'Bears', awayTeamName: 'Owls', csvRow: undefined, ...changes });

describe('Calendar booking conflicts', () => {
  it('identifies simultaneous tunnel bookings across leagues with game details', () => {
    const errors = findScheduleConflicts(booking(), [other()]);
    expect(errors).toHaveLength(1);
    for (const text of ['CSV row 2', 'Saved game', 'Eagles', 'Bears', '11U', '12U', '2027-11-01', 'Tunnels 5/6 is already booked']) expect(errors[0]).toContain(text);
  });
  it.each([['5:30 pm', '6:30 pm'], ['6:30 pm', '7:30 pm'], ['6:15 pm', '6:45 pm'], ['5:00 pm', '8:00 pm']])('rejects partial or contained overlap %s–%s', (startTime, endTime) => {
    expect(findScheduleConflicts(booking(), [other({ startTime, endTime })])).toHaveLength(1);
  });
  it.each([['5:00 pm', '6:00 pm'], ['7:00 pm', '8:00 pm']])('allows back-to-back games %s–%s', (startTime, endTime) => {
    expect(findScheduleConflicts(booking(), [other({ startTime, endTime })])).toEqual([]);
  });
  it('checks team IDs on either side even in different tunnels', () => {
    const errors = findScheduleConflicts(booking(), [other({ awayTeamId: 'a', location: 'Tunnels 7/8' })]);
    expect(errors[0]).toContain('Eagles already has a game');
    expect(errors[0]).not.toContain('already booked');
  });
  it('allows different tunnels with different teams, different dates and the edited game itself', () => {
    expect(findScheduleConflicts(booking(), [other({ location: 'Tunnels 7/8' }), other({ date: '2027-11-02' }), booking()])).toEqual([]);
  });
  it('normalizes date formats, 24-hour times and canonical tunnel labels', () => {
    expect(findScheduleConflicts(booking(), [other({ date: '11/01/2027', startTime: '18:00', endTime: '19:00', location: 'The Dugout: Tunnels 5/6' })])).toHaveLength(1);
  });
  it('does not confuse identically named teams from different leagues', () => {
    expect(findScheduleConflicts(booking(), [other({ homeTeamName: 'Eagles', awayTeamName: 'Panthers', location: 'Tunnels 7/8' })])).toEqual([]);
  });
  it('keeps CSV row references when detecting conflicts inside a file', () => {
    expect(findScheduleConflicts(booking(), [other({ csvRow: 8 })])[0]).toContain('CSV row 8');
  });
  it('requires review when an existing potentially competing game has no valid time', () => {
    expect(findScheduleConflicts(booking(), [other({ endTime: null })])[0]).toContain('missing valid start/end times');
  });
  it('bounds feedback for a file with many competing rows', () => {
    expect(findScheduleConflicts(booking(), Array.from({ length: 100 }, (_, i) => other({ id: String(i) })))).toHaveLength(20);
  });
});
