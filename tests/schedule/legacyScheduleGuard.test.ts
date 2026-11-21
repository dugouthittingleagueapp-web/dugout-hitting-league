import {describe,it,expect,vi} from 'vitest';
import {changesOfficialBooking,validateLegacyBooking} from '../../server/legacyScheduleGuard';
import {scoringFixture} from '../scoring/scoringFixtures';
const game={...scoringFixture().game,date:'2027-11-01T18:00:00.000Z',season:'2027',startTime:'6:00 pm',endTime:'7:00 pm',location:'The Dugout: Tunnels 5/6'};
describe('Every official scheduling entry uses calendar rules',()=>{
 it('allows unchanged legacy scoring snapshots and normalized display formats',()=>{
  expect(changesOfficialBooking(game,{...game,startTime:'18:00',location:'Tunnels 5/6'})).toBe(false);
 });
 it.each([{startTime:'18:30'},{homeTeamId:'other'},{date:'2027-11-02'},{location:'Tunnels 7/8'}])('detects schedule changes in legacy scoring payloads %j',body=>expect(changesOfficialBooking(game,body)).toBe(true));
 it('keeps ad-hoc and practice game creation available',async()=>{
  const query=vi.fn();await validateLegacyBooking({query} as any,'2027',{},false);await validateLegacyBooking({query} as any,'2027',game,true);expect(query).not.toHaveBeenCalled();
 });
 it('rejects a cross-league cage conflict on the legacy creation route',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{...game,id:'another',league:'Other',home_team_id:'x',away_team_id:'y',start_time:'18:30',end_time:'19:30'}]});
  await expect(validateLegacyBooking({query} as any,'2027',game,false)).rejects.toThrow('Both games');
 });
 it('allows adjacent bookings and rejects overnight/invalid bookings',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{...game,id:'another',home_team_id:'x',away_team_id:'y',start_time:'19:00',end_time:'20:00'}]});
  await expect(validateLegacyBooking({query} as any,'2027',game,false)).resolves.toBeUndefined();
  await expect(validateLegacyBooking({query} as any,'2027',{...game,startTime:'23:30',endTime:'00:30'},false)).rejects.toThrow('same day');
 });
});
