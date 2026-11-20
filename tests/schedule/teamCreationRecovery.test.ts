import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createAdminTeamRoster,getMatchTeams} from '../../services/storageService';
import type {Team} from '../../types';

const team:Team={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'New team',league:'11U',season:'2027',players:[{id:'one',name:'One'},{id:'two',name:'Two'}],subs:[]};
const storage=()=>{
 const values=new Map<string,string>();
 return {get length(){return values.size;},key:(index:number)=>[...values.keys()][index]||null,getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
};
describe('New team recovery and authoritative offline caches',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('window',{});vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());});
 afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
 it('times out a hanging request, aborts it and retries the same team and player identities',async()=>{
  let signal:AbortSignal;const fetcher=vi.fn().mockImplementationOnce((_url,init)=>{signal=init.signal;return new Promise(()=>{});}).mockResolvedValueOnce(new Response(JSON.stringify({...team,identityLinks:[]})));
  vi.stubGlobal('fetch',fetcher);
  const failed=expect(createAdminTeamRoster(team,{'one':'person'})).rejects.toThrow('Your entries are still here');
  await vi.advanceTimersByTimeAsync(15000);await failed;expect(signal!.aborted).toBe(true);
  expect(localStorage.getItem('dugout_team_'+team.id)).toBeNull();
  await createAdminTeamRoster(team,{'one':'person'});
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
 });
 it('bounds a hanging response body and ignores a late response after a successful retry',async()=>{
  let finish!:(value:unknown)=>void;
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:()=>new Promise(resolve=>{finish=resolve;})}).mockResolvedValueOnce(new Response(JSON.stringify({...team,identityLinks:[]})));
  vi.stubGlobal('fetch',fetcher);
  const failed=expect(createAdminTeamRoster(team)).rejects.toThrow('Retry this form');
  await vi.advanceTimersByTimeAsync(15000);await failed;await createAdminTeamRoster(team);
  finish({...team,name:'Stale late response',identityLinks:[]});await Promise.resolve();await Promise.resolve();
  expect(JSON.parse(localStorage.getItem('dugout_team_'+team.id)!).name).toBe(team.name);
 });
 it('updates cached directories and resolves the saved team after an immediate disconnection',async()=>{
  for(const key of ['dugout_all_teams_cache','dugout_teams_2027_all','dugout_teams_2027_ 11u ','dugout_teams_2027_Other','dugout_teams_2026_11U'])localStorage.setItem(key,'[]');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({...team,identityLinks:[]}))).mockRejectedValue(new Error('Disconnected')));
  await createAdminTeamRoster(team);
  for(const key of ['dugout_all_teams_cache','dugout_teams_2027_all','dugout_teams_2027_ 11u '])expect(JSON.parse(localStorage.getItem(key)!)).toEqual([team]);
  expect(localStorage.getItem('dugout_teams_2027_Other')).toBe('[]');expect(localStorage.getItem('dugout_teams_2026_11U')).toBe('[]');
  expect(await getMatchTeams(team.id,team.id)).toEqual([team]);
 });
 it('does not claim a confirmed save failed when browser storage is unavailable',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw Error('Unavailable');},get length(){throw Error('Unavailable');}});
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({...team,identityLinks:[]})))));
  expect((await createAdminTeamRoster(team)).id).toBe(team.id);
 });
 it('never caches an HTTP failure and does not duplicate a cached team on successful retry',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{"error":"Check the roster"}',{status:400})).mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({...team,identityLinks:[]})))));
  await expect(createAdminTeamRoster(team)).rejects.toThrow('Check the roster');expect(localStorage.getItem('dugout_team_'+team.id)).toBeNull();
  localStorage.setItem('dugout_all_teams_cache','[]');await createAdminTeamRoster(team);await createAdminTeamRoster(team);
  expect(JSON.parse(localStorage.getItem('dugout_all_teams_cache')!)).toEqual([team]);
 });
});
