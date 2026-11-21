import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {appendTieBreakerRound,createNextTieBreakerRound,areRegulationPitchesRecorded,getExtraRoundBlockReason,getScoringCompletionPrompt} from '../../utils/gameFinalization';
import {scoringFixture,memoryScoringStorage} from './scoringFixtures';
import {retrySavedScoring,getScoringSyncWarning} from '../../services/storageService';
import {markScoringSyncWarning} from '../../services/offlineSync';
import {applyPitchCommand} from '../../utils/scoringProtocol';
import {journalEntries} from '../../services/scoringJournal';
import {stagePitch} from '../../services/storageService';
const complete=()=>{const g=scoringFixture().game;for(const i of g.innings)for(const s of ['home','away'] as const)for(const p of i[s].playerScores)for(const v of p.pitches)v.points=0;return g;};
describe('Game-day reliability',()=>{
 beforeEach(()=>{vi.stubGlobal('localStorage',memoryScoringStorage());vi.stubGlobal('sessionStorage',memoryScoringStorage());vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('window',{dispatchEvent:vi.fn(),addEventListener:vi.fn()});});
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
 it('rejects starting extras while regulation pitches are missing even at 0-0',()=>{
  const g=scoringFixture().game;expect(()=>appendTieBreakerRound(g,createNextTieBreakerRound([], 'h1','a1'))).toThrow(/record|complete/i);
 });
 it.each([5,3,1])('rejects advancing an incomplete %i-pitch round despite tied totals',limit=>{
  const g=complete();g.tieBreaker=[5,3,1].slice(0,limit===5?1:limit===3?2:3).map((n,i)=>({roundNumber:i+1,pitchLimit:n,homePlayerId:'h1',awayPlayerId:'a1',homeScores:Array(n).fill(0),awayScores:Array(n).fill(0)}));
  g.tieBreaker[g.tieBreaker.length-1].homeScores[0]=null;
  expect(()=>appendTieBreakerRound(g,createNextTieBreakerRound(g.tieBreaker,'h1','a1'))).toThrow(/record|complete/i);
 });
 it('rejects advancing a completed winning round or finished game',()=>{
  const g=complete();g.innings[0].home.playerScores[0].pitches[0].points=1;
  expect(()=>appendTieBreakerRound(g,createNextTieBreakerRound([], 'h1','a1'))).toThrow();
  expect(()=>appendTieBreakerRound({...complete(),isComplete:true,status:'FINAL'},createNextTieBreakerRound([], 'h1','a1'))).toThrow();
 });
 it('restores ownership before retrying and synchronizes only the selected game',async()=>{
  const g=scoringFixture().game;let online=false,owned=false;const calls:string[]=[];
  sessionStorage.setItem('dugout_scoring_token_'+g.id,'11111111-1111-4111-8111-111111111111');
  const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url==='/api/schedule-admin')return new Response('{"recorded":true}');
   if(!online)throw new Error('offline');calls.push(url);
   if(url==='/api/scoring-lock'){owned=true;return new Response('{"owned":true,"locked":true}');}
   if(!owned)return new Response('{"error":"Scoring access is not ready"}',{status:423});
   const b=JSON.parse(init!.body as string);return new Response(JSON.stringify({...applyPitchCommand(g,b.command),revision:1}));
  });vi.stubGlobal('fetch',fetcher);
  await stagePitch(g,{kind:'pitch',inning:1,side:'home',playerId:'h1',pitchIndex:0,expected:null,points:4}).saved;
  markScoringSyncWarning(g.id,'Scoring access is not ready');
  localStorage.setItem('dugout_pending_sync_matches',JSON.stringify({other:{...g,id:'other'}}));
  online=true;await retrySavedScoring(g.id);
  expect(calls).toEqual(['/api/scoring-lock','/api/scoring']);
  expect(journalEntries(g.id)[0].ack).toEqual({revision:1});expect(getScoringSyncWarning(g.id)).toBeNull();
  expect(JSON.parse(localStorage.getItem('dugout_pending_sync_matches')!).other).toBeDefined();
 });
 it('does not erase a conflict or claim success when another scorer still owns the game',async()=>{
  markScoringSyncWarning('blocked','Some scores need checking');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"error":"Another umpire is scoring this game"}',{status:423})));
  await expect(retrySavedScoring('blocked')).rejects.toThrow(/Another umpire/);
  expect(getScoringSyncWarning('blocked')).toBeTruthy();
 });
 it.each([409,423,503])('retains the exact journal and reports failure when a retry receives %i',async status=>{
  const g={...scoringFixture().game,id:'retry-'+status};
  sessionStorage.setItem('dugout_scoring_token_'+g.id,'11111111-1111-4111-8111-111111111111');
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
  await stagePitch(g,{kind:'pitch',inning:1,side:'home',playerId:'h1',pitchIndex:0,expected:null,points:4}).saved;
  const original=journalEntries(g.id)[0];
  const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url==='/api/scoring-lock')return new Response('{"owned":true,"locked":true}');
   expect(JSON.parse(init!.body as string)).toMatchObject({revision:0,writeId:original.id,command:original.command});
   return new Response('{"error":"Not saved"}',{status});
  });vi.stubGlobal('fetch',fetcher);
  await expect(retrySavedScoring(g.id)).rejects.toThrow();
  expect(journalEntries(g.id)[0]).toEqual(original);expect(getScoringSyncWarning(g.id)).toBeTruthy();
 });
 it('safely retries a retained legacy snapshot after restoring access, without borrowing a newer revision',async()=>{
  const g={...scoringFixture().game,id:'legacy-retry'};
  localStorage.setItem('dugout_pending_sync_matches',JSON.stringify({[g.id]:g}));markScoringSyncWarning(g.id,'Check access');
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(url==='/api/schedule-admin')return new Response('{"recorded":true}');calls.push(url);
   if(url==='/api/scoring-lock')return new Response('{"owned":true,"locked":true}');
   expect(JSON.parse(init!.body as string).revision).toBe(0);return new Response(JSON.stringify({...g,revision:1}));
  }));
  await retrySavedScoring(g.id);expect(calls).toEqual(['/api/scoring-lock','/api/matches']);
  expect(localStorage.getItem('dugout_pending_sync_matches')).toBeNull();expect(getScoringSyncWarning(g.id)).toBeNull();
 });

 it('explains incomplete and forfeited games and enables extras only after the final recorded tied pitch',()=>{
  const g=complete();g.innings[5].home.playerScores[2].pitches[9].points=null;
  expect(areRegulationPitchesRecorded(g)).toBe(false);
  expect(getExtraRoundBlockReason(g)).toMatch(/remaining regulation pitches/);
  g.innings[5].home.playerScores[2].pitches[9].points=0;
  expect(areRegulationPitchesRecorded(g)).toBe(true);expect(getExtraRoundBlockReason(g)).toBeNull();
  expect(getExtraRoundBlockReason({...g,isForfeit:true})).toMatch(/forfeit/);
  expect(getExtraRoundBlockReason({...g,isComplete:true,status:'FINAL'})).toMatch(/finished/);
 });

 it('opens extras when edits change a completed regulation game to 1-1, without interrupting the first correction',()=>{
  const tied=complete(),homeLeads=structuredClone(tied);homeLeads.innings[0].home.playerScores[0].pitches[0].points=1;
  expect(getScoringCompletionPrompt(tied,homeLeads)).toBeNull();
  const corrected=structuredClone(homeLeads);corrected.innings[0].away.playerScores[0].pitches[0].points=1;
  expect(getScoringCompletionPrompt(homeLeads,corrected)).toBe('extras');
  expect(getScoringCompletionPrompt(corrected,corrected)).toBeNull();
  expect(getScoringCompletionPrompt({...homeLeads,isComplete:true},{...corrected,isComplete:true})).toBeNull();
 });
 it('prompts when the last missing regulation pitch is filled in any inning, but never with other blanks remaining',()=>{
  const before=complete();before.innings[0].away.playerScores[0].pitches[0].points=null;
  expect(getScoringCompletionPrompt(before,complete())).toBe('extras');
  const incomplete=structuredClone(before);incomplete.innings[5].home.playerScores[2].pitches[9].points=null;
  expect(getScoringCompletionPrompt(incomplete,before)).toBeNull();
 });
 it.each([5,3,1])('prompts for another extra round when edits tie a fully recorded %i-pitch round',limit=>{
  const before=complete();before.tieBreaker=[5,3,1].slice(0,limit===5?1:limit===3?2:3).map((n,i)=>({roundNumber:i+1,pitchLimit:n,homePlayerId:'h1',awayPlayerId:'a1',homeScores:Array(n).fill(0),awayScores:Array(n).fill(0)}));
  before.tieBreaker[before.tieBreaker.length-1].homeScores[0]=1;
  const after=structuredClone(before);after.tieBreaker![after.tieBreaker!.length-1].awayScores[0]=1;
  expect(getScoringCompletionPrompt(before,after)).toBe('extras');
 });

});
