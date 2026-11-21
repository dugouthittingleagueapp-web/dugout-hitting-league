import React, {useEffect,useState} from 'react';
import {getAdminOperations} from '../services/storageService';
import {leagueToday,type ReadinessResult} from '../server/gameDayReadiness';
import {displayBookingTime} from '../utils/scheduleConflictPresentation';

export const GameDayReadiness: React.FC<{season:string;onNavigate:(screen:'schedule'|'rosters'|'game')=>void}> = ({season,onNavigate}) => {
  const [date,setDate]=useState(leagueToday);
  const [data,setData]=useState<ReadinessResult|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true;setBusy(true);setError('');setData(null);
    getAdminOperations<ReadinessResult>('readiness',season,{date}).then(result=>{if(active)setData(result);}).catch(()=>{if(active)setError('Readiness could not be checked. Refresh to try again. Games have not been changed.');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[season,date,refresh]);
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6 text-slate-100" aria-labelledby="readiness-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="readiness-title" className="text-xl font-bold">Game-Day Readiness</h3><p className="text-sm text-slate-300">Season {season} · Times are local to the league.</p></div>
      <button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)} className="rounded-lg bg-blue-700 px-4 py-2 font-bold disabled:opacity-50">{busy?'Checking…':'Refresh readiness'}</button></div>
    <div className="my-4 flex flex-wrap gap-3"><label className="text-sm">Game date<input aria-label="Readiness game date" type="date" value={date} onChange={e=>setDate(e.target.value)} className="ml-2 rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
      {!!data?.dates.length&&<label className="text-sm">Scheduled days<select aria-label="Scheduled game days" value={data.dates.includes(date)?date:''} onChange={e=>{if(e.target.value)setDate(e.target.value);}} className="ml-2 rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"><option value="">Choose a game day</option>{data.dates.map(d=><option key={d} value={d}>{d}</option>)}</select></label>}</div>
    {error&&<p role="alert" className="text-amber-300">{error}</p>}
    {data&&<><p className="mb-3 text-xs text-slate-400">Checked {new Date(data.checkedAt).toLocaleString()}</p>{!data.games.length&&<p>No games scheduled for this date.</p>}
      <div className="space-y-3">{data.games.map(game=><details key={game.id} className="rounded-xl border border-slate-700 bg-slate-950 p-3">
        <summary className="cursor-pointer"><span className={`mr-2 inline-block rounded px-2 py-1 text-sm font-bold ${game.state==='ready'?'bg-emerald-950 text-emerald-300':game.state==='blocked'?'bg-red-950 text-red-300':'bg-amber-950 text-amber-200'}`}>{game.state==='ready'?'Ready':game.state==='blocked'?'Blocked':'Needs Attention'}</span><strong>{game.home} vs {game.away}</strong><span className="mt-2 block text-sm text-slate-300">{displayBookingTime(game.startTime)}–{displayBookingTime(game.endTime)} · {game.location.replace('The Dugout: ','')} · {game.league} · {game.status.replace('_',' ')}</span>{game.issues.length>0&&<span className="mt-2 block text-sm text-amber-200">{game.issues[0].message}{game.issues.length>1?` (${game.issues.length} checks need review)`:''}</span>}</summary>
        <ul className="mt-3 space-y-2">{game.issues.map((issue,i)=><li key={issue.code+i} className="rounded-lg bg-slate-900 p-3 text-sm"><p>{issue.message}</p><button type="button" onClick={()=>onNavigate(issue.screen)} className="mt-2 font-bold text-blue-300 underline">{issue.screen==='schedule'?'Open Schedule':issue.screen==='rosters'?'Open Rosters':'Open league games'}</button></li>)}{game.checks.map(check=><li key={check} className="text-sm text-emerald-300">✓ {check}</li>)}</ul>
      </details>)}</div></>}
  </section>;
};
