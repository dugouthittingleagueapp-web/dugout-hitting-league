import {it,expect} from 'vitest';
import {conflictPairCount,conflictWarnings,displayScheduleDate} from '../../utils/scheduleConflictPresentation';
import type {ScheduleConflict} from '../../utils/scheduleConflicts';
const cage:ScheduleConflict={firstId:'a',secondId:'b',kind:'cage',date:'2027-11-01',start:1080,end:1140,cage:'The Dugout: Tunnels 5/6'};
it('counts one overlapping game pair once even when it also has a team conflict',()=>{
 expect(conflictPairCount([cage,{...cage,kind:'team',teamId:'eagles'}])).toBe(1);
});
it('names the shared tunnels and team, with the actual date and overlap time',()=>{
 const result=conflictWarnings([cage,{...cage,kind:'team',teamId:'eagles'}],()=> 'Eagles');
 expect(result.get('a')?.map(w=>w.title)).toEqual(['Tunnels 5/6 is booked twice','Eagles is playing in two games at once']);
 expect(result.get('a')?.[0].detail).toBe('Mon, Nov 1, 2027 · 6:00 PM–7:00 PM');
 expect([...result.get('a')![0].otherIds]).toEqual(['b']);expect([...result.get('b')![0].otherIds]).toEqual(['a']);
});
it('combines identical warnings while retaining every other affected game',()=>{
 const result=conflictWarnings([cage,{...cage,secondId:'c'}],id=>id);
 expect(result.get('a')).toHaveLength(1);expect([...result.get('a')![0].otherIds]).toEqual(['b','c']);
 expect(displayScheduleDate('')).toBe('Date needed');
});

import {scheduleTimeOptions,scheduleTimeValue} from '../../utils/scheduleConflictPresentation';
it('offers every quarter hour with clear AM/PM labels',()=>{
 const options=scheduleTimeOptions('6:00 pm');expect(options).toHaveLength(96);
 expect(options[0]).toEqual({value:'00:00',label:'12:00 AM'});
 expect(options.find(option=>option.value==='18:15')?.label).toBe('6:15 PM');
 expect(options[95]).toEqual({value:'23:45',label:'11:45 PM'});
 expect(scheduleTimeValue('6:00 pm')).toBe('18:00');
});
it('preserves an existing off-grid booking instead of silently rounding it',()=>{
 const options=scheduleTimeOptions('6:10 pm');expect(options).toHaveLength(97);
 expect(options.find(option=>option.value==='18:10')?.label).toBe('6:10 PM (current)');
 expect(scheduleTimeValue('6:10 pm')).toBe('18:10');
 expect(scheduleTimeOptions('18:15','6:10 pm').some(option=>option.value==='18:10')).toBe(true);
});
