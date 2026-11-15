import { describe, it, expect } from 'vitest';
import { scheduleLockedReason } from '../../utils/schedulePolicy';
import { parseScheduleCsv } from '../../utils/scheduleImporter';

const blank = [{ number: 1, home: { playerScores: [{ pitches: [{ points: null }] }] }, away: { playerScores: [] } }];
describe('Shared schedule protection', () => {
  it('permits genuinely blank legacy schedules with no status', () => {
    expect(scheduleLockedReason({ innings: blank })).toBeNull();
    expect(scheduleLockedReason({ status: 'SCHEDULED', innings: JSON.stringify(blank) })).toBeNull();
  });
  it.each([0, 4, '0'])('protects a result even when status says SCHEDULED: %s', points => {
    expect(scheduleLockedReason({ status: 'SCHEDULED', innings: [{ home: { playerScores: [{ pitches: [{ points }] }] } }] })).not.toBeNull();
  });
  it.each([
    { is_complete: true }, { status: 'FINAL' }, { status: 'IN_PROGRESS' },
    { innings: '{broken' }, { innings: { unexpected: [] } }, { tie_breaker: [{}] },
  ])('fails closed for completed, started or unrecognized records: %j', data => {
    expect(scheduleLockedReason({ status: 'SCHEDULED', innings: blank, ...data })).not.toBeNull();
  });
});

describe('Full CSV validation before import', () => {
  const header = 'Date,Start Time,End Time,Location,Group,Home Team,Away Team,Notes\n';
  it.each([
    '2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,11U,A,"B',
    '2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,11U,"A"oops,B',
    '2027-11-01,6:00 pm,7:00 pm,Tunnels 99,11U,A,B',
    '2027-11-01,6:00 pm,7:00 pm,Tunnels 5/6,11U,A,a',
  ])('rejects malformed fields, unsupported cages or same-team games', row => {
    expect(parseScheduleCsv(header + row).errors.length).toBeGreaterThan(0);
  });
  it('accepts display cage names and normalizes them for storage', () => {
    const parsed = parseScheduleCsv(header + '2027-11-01,6:00 pm,7:00 pm,Tunnels 7/8,11U,A,B,"Bring balls, bats and tees"');
    expect(parsed.errors).toEqual([]);
    expect(parsed.games[0]).toMatchObject({ location: 'The Dugout: Tunnels 7/8', notes: 'Bring balls, bats and tees' });
  });
});
