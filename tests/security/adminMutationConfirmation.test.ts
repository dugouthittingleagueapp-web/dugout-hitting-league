import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {updateTeam,createTeam,saveTeam,deleteTeam,updateCurrentSeason,moveTeams} from '../../services/storageService';
import {memoryScoringStorage,scoringFixture} from '../scoring/scoringFixtures';
beforeEach(()=>{vi.stubGlobal('window',{});vi.stubGlobal('localStorage',memoryScoringStorage());vi.stubGlobal('sessionStorage',memoryScoringStorage());});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it.each([400,403,409,500])('does not queue a rejected roster or replace cached data on HTTP %s',async status=>{
 const team=scoringFixture().home;localStorage.setItem('dugout_team_'+team.id,JSON.stringify(team));
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"error":"This roster is protected"}',{status})));
 await expect(updateTeam({...team,name:'Not saved'})).rejects.toThrow('This roster is protected');
 expect(localStorage.getItem('dugout_team_'+team.id)).toBe(JSON.stringify(team));expect(localStorage.getItem('dugout_pending_sync_teams')).toBeNull();
});
it('does not report an offline roster as saved or enqueue it for later overwrite',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));
 await expect(updateTeam(scoringFixture().home)).rejects.toThrow('Could not confirm');
 expect(localStorage.length).toBe(0);
});
it('does not cache an unconfirmed team through either legacy creation entry',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));
 await expect(createTeam('Example','QC',[{name:'One'},{name:'Two'}],'2026')).rejects.toThrow('Could not confirm');
 await expect(saveTeam(scoringFixture().home)).rejects.toThrow('Could not confirm');expect(localStorage.length).toBe(0);
});
it('rejects protected deletion and preserves the active season cache after failed activation',async()=>{
 localStorage.setItem('dugout_current_season','2026');
 vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response('{"error":"Protected"}',{status:403}))));
 await expect(deleteTeam('protected')).rejects.toThrow('Protected');await expect(updateCurrentSeason('2027')).rejects.toThrow('Protected');
 expect(localStorage.getItem('dugout_current_season')).toBe('2026');
});
it('returns the actionable move failure from the server',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"error":"Eagles already exists"}',{status:409})));
 await expect(moveTeams(['a'],'9U')).rejects.toThrow('Eagles already exists');
});
it('times out a hanging legacy roster response without claiming success',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise(()=>{})));
 const result=expect(updateTeam(scoringFixture().home)).rejects.toThrow('Could not confirm');await vi.advanceTimersByTimeAsync(15000);await result;
 expect(localStorage.length).toBe(0);
});

it.each(['not JSON','null','{}','{"id":"other","players":[],"subs":[]}'])('rejects malformed successful confirmation %s without replacing the roster cache',async body=>{
 const team=scoringFixture().home;
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body,{status:200})));
 await expect(updateTeam(team)).rejects.toThrow('Could not confirm');expect(localStorage.length).toBe(0);
});

it('updates the roster cache only after receiving the matching saved team',async()=>{
 const team=scoringFixture().home;vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(team))));
 expect(await updateTeam(team)).toEqual(team);expect(JSON.parse(localStorage.getItem('dugout_team_'+team.id)!)).toEqual(team);
});
