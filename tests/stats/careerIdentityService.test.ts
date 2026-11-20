import {afterEach,describe,it,expect,vi} from 'vitest';
import {getPlayerCareerStats} from '../../services/storageService';
const teams=[{id:'old-team',name:'Old Team',season:'2026',league:'QC',players:[{id:'old-entry',name:'Alex',lastName:'Jones'}],subs:[]},{id:'new-team',name:'New Team',season:'2027',league:'QC',players:[{id:'new-entry',name:'Alex',lastName:'Changed'},{id:'other-alex',name:'Alex',lastName:'Changed'}],subs:[]}];
const game=(id:string,season:string,playerId:string,points:number)=>({id,season,league:'QC',home_team_id:season==='2026'?'old-team':'new-team',away_team_id:'opponent',date:`${season}-11-01`,is_complete:true,status:'FINAL',innings:[{number:1,home:{playerScores:[{playerId,pitches:[{points}]}]},away:{playerScores:[]}}]});
const links=[{rosterPlayerId:'old-entry',personId:'person-1',resolution:'existing'},{rosterPlayerId:'new-entry',personId:'person-1',resolution:'confirmed'},{rosterPlayerId:'other-alex',personId:'person-2',resolution:'new'}];
afterEach(()=>{vi.unstubAllGlobals();});
describe('Career statistics use permanent identity',()=>{
 it('joins linked seasons after a rename while excluding a different same-name player',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>new Response(JSON.stringify(input.endsWith('/api/teams')?teams:input.endsWith('/api/matches')?[game('old','2026','old-entry',3),game('new','2027','new-entry',4),game('other','2027','other-alex',2)]:links))));
  const result=await getPlayerCareerStats('new-entry');
  expect(result?.careerTotals.totalPoints).toBe(7);expect(result?.careerTotals.gamesPlayed).toBe(2);
  expect(result?.playerName).toBe('Alex C.');
  const other=await getPlayerCareerStats('other-alex');expect(other?.careerTotals.totalPoints).toBe(2);
 });
 it('reports unavailable data instead of displaying partial career totals',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>new Response(JSON.stringify(input.endsWith('/api/teams')?teams:links),{status:input.endsWith('/api/matches')?503:200})));
  await expect(getPlayerCareerStats('new-entry')).rejects.toThrow('unavailable');
 });
});
