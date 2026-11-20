import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Team} from '../types.js';
import {mapMatchFromDB} from '../utils/dbMappers.js';
import {scheduleLockedReason} from '../utils/schedulePolicy.js';
import {canonicalCage} from '../utils/scheduleValidation.js';
import {scheduleConflicts,conflictDescription} from '../utils/scheduleConflicts.js';
import {changedBooking,resolutionGameError,type ResolutionGame,type ResolutionWorkspace} from '../utils/scheduleResolution.js';
import {createEmptyInning} from '../utils/inningTemplate.js';
import {ScheduleError} from './scheduleTransaction.js';
import {planScheduleImport,executeScheduleImport,importReceiptKey,previousImport,type ImportPlan} from './scheduleImport.js';
export class ResolutionError extends ScheduleError {
  constructor(message:string,public resolution:ResolutionWorkspace){super(409,message);}
}
export const resolutionWorkspace=async(client:PoolClient,season:string,plan?:ImportPlan,lock=false):Promise<ResolutionWorkspace>=>{
  const rows=(await client.query(`SELECT m.* FROM matches m
    WHERE season=$1 AND (is_practice IS FALSE OR is_practice IS NULL) ORDER BY m.id${lock?' FOR UPDATE OF m':''}`,[season])).rows;
  // Separate statement after row locks: a lock acquired while SELECT waited must be visible.
  const locks=new Set((await client.query('SELECT match_id FROM scoring_locks WHERE match_id=ANY($1::text[])',[rows.map(r=>String(r.id))])).rows.map(r=>String(r.match_id)));
  const games:ResolutionGame[]=rows.map(row=>{
    row.scoring_locked=locks.has(String(row.id));
    const m=mapMatchFromDB(row);
    return {id:m.id,league:m.league,revision:m.revision||0,kind:'existing',date:(row.date instanceof Date?row.date.toISOString():String(m.date)).slice(0,10),startTime:m.startTime||'',endTime:m.endTime||'',location:canonicalCage(m.location)||m.location||'',homeTeamId:m.homeTeamId,awayTeamId:m.awayTeamId,notes:m.notes||undefined,lockedReason:scheduleLockedReason(m)};
  });
  const teams:Team[]=(await client.query('SELECT * FROM teams WHERE season=$1 ORDER BY name',[season])).rows;
  const leagues=(await client.query('SELECT id,season FROM leagues WHERE season=$1 ORDER BY id',[season])).rows;
  if(plan){
    teams.push(...plan.teamsToCreate);leagues.push(...plan.leaguesToCreate);
    games.push(...plan.matchesToCreate.map(m=>({id:m.id,league:m.league,revision:0,kind:'import' as const,date:m.date.slice(0,10),startTime:m.startTime||'',endTime:m.endTime||'',location:m.location||'',homeTeamId:m.homeTeamId,awayTeamId:m.awayTeamId,notes:m.notes})));
  }
  return {games,teams,leagues,replacements:plan?.replacements,teamReplacements:plan?.teamReplacements,rootIds:plan?.matchesToCreate.map(m=>m.id)||[]};
};
const inningsFor=(game:ResolutionGame,teams:Team[])=>{
  const ids=(id:string)=>{const players=teams.find(t=>t.id===id)?.players||[];if(!Array.isArray(players)||players.some(p=>!p||typeof p.id!=='string'))throw new ScheduleError(409,'This team roster needs an admin review before scheduling.');return players.slice(0,3).map(p=>p.id);};
  return Array.from({length:6},(_,i)=>createEmptyInning(i+1,ids(game.homeTeamId),ids(game.awayTeamId)));
};
/** Caller holds active-season advisory lock. Match row locks also exclude scoring/takeover races. */
export const saveScheduleResolution=async(client:PoolClient,season:string,body:any)=>{
  if(typeof body.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.requestId)||!Array.isArray(body.changes)||!body.changes.length||body.changes.length>5000)
    throw new ScheduleError(400,'Save up to 5,000 affected games at a time.');
  const digest=createHash('sha256').update(JSON.stringify([body.changes,body.import||null])).digest('hex');
  const receiptKey=`schedule_resolution:${season}:${body.requestId}`;
  const receipt=(await client.query('SELECT value FROM app_settings WHERE key=$1',[receiptKey])).rows[0];
  if(receipt){const saved=JSON.parse(receipt.value);if(saved.digest!==digest)throw new ScheduleError(409,'This save was already used for different changes. Close and reopen the schedule.');return saved.result;}
  let plan:ImportPlan|undefined,importKey:string|undefined;
  if(body.import){
    importKey=importReceiptKey(season,body.import.csvText,body.import.leagueDestinations);
    const previous=await previousImport(client,importKey);
    if(previous){
      const refreshed=await resolutionWorkspace(client,season,undefined,true);
      refreshed.rootIds=body.changes.map((game:any)=>game?.id).filter((id:unknown)=>typeof id==='string');
      refreshed.importAlreadySaved=true;
      throw new ResolutionError('This CSV was imported on another screen. Your remaining edits are still here. Review the saved games before saving again.',refreshed);
    }
    plan=await planScheduleImport(client,season,body.import.csvText,body.import.leagueDestinations,true);
  }
  const workspace=await resolutionWorkspace(client,season,plan,true);
  const original=new Map(workspace.games.map(g=>[g.id,g]));
  const changes:ResolutionGame[]=[];const seen=new Set<string>();
  for(const raw of body.changes){
    if(!raw||typeof raw.id!=='string'||seen.has(raw.id)||!['date','startTime','endTime','location','homeTeamId','awayTeamId'].every(k=>typeof raw[k]==='string'))throw new ScheduleError(400,'Enter valid game fields without duplicate games.');
    if(['innings','tieBreaker','tie_breaker','status','isComplete','is_complete','isForfeit','is_forfeit','isPractice','is_practice'].some(key=>Object.prototype.hasOwnProperty.call(raw,key)))throw new ScheduleError(400,'Schedule changes cannot include scores or game status.');
    seen.add(raw.id);
    if(workspace.replacements?.[raw.id]&&workspace.replacements[raw.id]!==raw.id)throw new ResolutionError('An imported game now exists in the schedule. Your edits are kept below. Review the refreshed game before saving.',workspace);
    let before=original.get(raw.id);
    if(!before){
      if(raw.kind!=='new'||body.import||!/^[0-9a-f-]{36}$/i.test(raw.id)||!workspace.leagues.some(l=>l.id===raw.league))throw new ResolutionError('A game was removed or its import destination changed. Review the refreshed schedule.',workspace);
      before={...raw,kind:'new',revision:0};workspace.games.push(before!);original.set(raw.id,before!);
    }
    if(before!.kind==='existing'&&(!Number.isSafeInteger(raw.revision)||Number(raw.revision)!==before!.revision)){
      workspace.rootIds=body.changes.map((g:any)=>g.id);throw new ResolutionError('Another administrator changed a game. Review the updated details before saving.',workspace);
    }
    if(before!.lockedReason)throw new ResolutionError(before!.lockedReason,workspace);
    const game:ResolutionGame={...before!,date:raw.date,startTime:raw.startTime.trim(),endTime:raw.endTime.trim(),location:canonicalCage(raw.location)||raw.location,homeTeamId:raw.homeTeamId,awayTeamId:raw.awayTeamId,notes:raw.notes===undefined?before!.notes:raw.notes};
    if([game.homeTeamId,game.awayTeamId].some(id=>workspace.teamReplacements?.[id]&&workspace.teamReplacements[id]!==id&&!workspace.teams.some(t=>t.id===id)))throw new ResolutionError('A team was created on another screen. Your edits are kept below. Review the updated teams before saving.',workspace);
    const invalid=resolutionGameError(game,workspace.teams);if(invalid)throw new ScheduleError(400,invalid);
    changes.push(game);
  }
  // Imported rows omitted by a forged/incomplete client are still validated and saved with the import.
  for(const g of workspace.games.filter(g=>g.kind==='import'&&!seen.has(g.id))){const invalid=resolutionGameError(g,workspace.teams);if(invalid)throw new ScheduleError(400,invalid);changes.push(g);}
  const changed=new Map(changes.map(g=>[g.id,g]));
  const final=workspace.games.map(g=>changed.get(g.id)||g);
  const conflicts=scheduleConflicts(final,new Set(changes.map(g=>g.id)));
  if(conflicts.length){workspace.rootIds=changes.map(g=>g.id);throw new ResolutionError(conflictDescription(conflicts[0],id=>workspace.teams.find(t=>t.id===id)?.name||'This team'),workspace);}
  // All validation finishes before the first write. Everything below shares one transaction.
  if(plan){
    const rows=plan.games.filter(g=>!g.duplicate);
    for(const [index,m] of plan.matchesToCreate.entries()){
      const g=changed.get(m.id)!;
      Object.assign(m,{date:g.date+'T12:00:00.000Z',startTime:g.startTime,endTime:g.endTime,location:g.location,homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,notes:g.notes,innings:inningsFor(g,workspace.teams)});
      Object.assign(rows[index],{date:g.date,scheduledIsoDate:m.date,startTime:g.startTime,endTime:g.endTime,location:g.location,notes:g.notes,homeTeamName:workspace.teams.find(t=>t.id===g.homeTeamId)!.name,awayTeamName:workspace.teams.find(t=>t.id===g.awayTeamId)!.name});
    }
    const usedTeams=new Set(final.flatMap(g=>[g.homeTeamId,g.awayTeamId]));
    plan.teamsToCreate=plan.teamsToCreate.filter(t=>usedTeams.has(t.id));
    plan.summary.createdTeams=plan.teamsToCreate.map(t=>t.name);
    // Provision team IDs before assigning them to existing unplayed games.
    await executeScheduleImport(client,{...plan,matchesToCreate:[]});
  }
  for(const game of changes.filter(g=>g.kind==='existing')){
    const before=original.get(game.id)!;if(!changedBooking(before,game))continue;
    const newMatchup=before.homeTeamId!==game.homeTeamId||before.awayTeamId!==game.awayTeamId;
    await client.query(`UPDATE matches SET revision=revision+1,date=$2,start_time=$3,end_time=$4,location=$5,home_team_id=$6,away_team_id=$7,notes=$8${newMatchup?',innings=$9,is_forfeit=FALSE,forfeiting_team_id=NULL,winning_team_id=NULL,forfeit_reason=NULL':''} WHERE id=$1`,
      [game.id,game.date+'T12:00:00.000Z',game.startTime,game.endTime,game.location,game.homeTeamId,game.awayTeamId,game.notes??null,...(newMatchup?[JSON.stringify(inningsFor(game,workspace.teams))]:[])]);
  }
  if(plan){
    await executeScheduleImport(client,{...plan,leaguesToCreate:[],teamsToCreate:[]});
    await client.query('INSERT INTO app_settings(key,value) VALUES($1,$2)',[importKey,JSON.stringify({games:plan.games,summary:plan.summary})]);
  }
  for(const game of changes.filter(g=>g.kind==='new'))await client.query(`INSERT INTO matches(id,league,season,date,start_time,end_time,location,home_team_id,away_team_id,notes,innings,status,is_complete,is_practice)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SCHEDULED',FALSE,FALSE)`,[game.id,game.league,season,game.date+'T12:00:00.000Z',game.startTime,game.endTime,game.location,game.homeTeamId,game.awayTeamId,game.notes||null,JSON.stringify(inningsFor(game,workspace.teams))]);
  const result={saved:true,summary:plan?.summary};
  await client.query('INSERT INTO app_settings(key,value) VALUES($1,$2)',[receiptKey,JSON.stringify({digest,result})]);
  return result;
};
