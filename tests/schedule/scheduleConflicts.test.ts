import {describe,it,expect} from 'vitest';
import {scheduleConflict} from '../../utils/scheduleConflicts';
const game={id:'existing',date:'2027-11-01',startTime:'6:00 pm',endTime:'7:00 pm',location:'Tunnels 5/6',homeTeamId:'home',awayTeamId:'away'};
describe('Schedule collision protection',()=>{
 it('blocks a replacement matchup in the same cage even across leagues',()=>expect(scheduleConflict({...game,id:'new',homeTeamId:'new-home',awayTeamId:'new-away'},[game])).toContain('Tunnels 5/6'));
 it('blocks overlapping games for a team in different cages',()=>expect(scheduleConflict({...game,id:'new',location:'Tunnels 7/8',startTime:'6:30 pm',endTime:'7:30 pm'},[game])).toContain('team'));
 it('allows simultaneous games in separate cages for different teams',()=>expect(scheduleConflict({...game,id:'new',location:'Tunnels 7/8',homeTeamId:'new-home',awayTeamId:'new-away'},[game])).toBeNull());
 it('allows adjacent time slots',()=>expect(scheduleConflict({...game,id:'new',startTime:'7:00 pm',endTime:'8:00 pm'},[game])).toBeNull());
 it('ignores the edited game itself',()=>expect(scheduleConflict(game,[game])).toBeNull());
 it('keeps different dates separate',()=>expect(scheduleConflict({...game,id:'new',date:'2027-11-08'},[game])).toBeNull());
});

import {scheduleConflicts,conflictDescription} from '../../utils/scheduleConflicts';
it('returns all overlapping cage and team reasons instead of stopping at the first game',()=>{
 const games=[game,{...game,id:'second',homeTeamId:'different',awayTeamId:'other'}, {...game,id:'third',location:'Tunnels 7/8'}, {...game,id:'fourth',date:'2027-11-02'}];
 const conflicts=scheduleConflicts(games,new Set(['existing']));
 expect(conflicts.filter(c=>c.kind==='cage')).toHaveLength(1);
 expect(conflicts.filter(c=>c.kind==='team')).toHaveLength(2);
 expect(new Set(conflicts.map(c=>c.secondId))).toEqual(new Set(['second','third']));
 expect(conflictDescription(conflicts.find(c=>c.kind==='team')!,()=> 'Eagles')).toContain('Eagles is scheduled in both games');
});
