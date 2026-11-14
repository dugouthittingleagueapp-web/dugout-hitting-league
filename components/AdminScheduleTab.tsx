import React, { useEffect, useMemo, useState } from 'react';
import * as storage from '../services/storageService';
import type { League, Team, ScheduledGameRecord, ScheduleImportSummary } from '../types';
import { combineDateAndTime, isValidScheduleDate, isValidScheduleTime } from '../utils/scheduleImporter';
import { ScheduleImportModal } from './ScheduleImportModal';

type Props = { season: string; onChanged: () => void };
type Draft = { league: string; homeId: string; awayId: string; date: string; startTime: string; endTime: string; location: string; notes: string };
const blank = (): Draft => ({ league: '', homeId: '', awayId: '', date: '', startTime: '6:00 pm', endTime: '7:00 pm', location: 'The Dugout', notes: '' });
const dayOf = (date: string) => String(date || '').slice(0,10);
const inputClass = 'block w-full mt-1 p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white';
const actionClass = 'px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-sm disabled:opacity-40';

export const AdminScheduleTab: React.FC<Props> = ({ season, onChanged }) => {
  const [games, setGames] = useState<storage.AdminScheduledGame[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueFilter, setLeagueFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editableOnly, setEditableOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<storage.AdminScheduledGame | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Team | null>(null);
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState<Draft>(blank());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [serial, setSerial] = useState(0);
  const refresh = () => setSerial(n => n + 1);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    Promise.all([storage.getScheduledGamesForAdmin(season), storage.getTeams(null,season), storage.getLeagues(season)])
      .then(([g,t,l]) => { if (live) { setGames(g); setTeams(t); setLeagues(l); } })
      .catch((e: Error) => { if (live) { setGames([]); setError(e.message || 'Could not load the schedule.'); } })
      .finally(() => { if(live) setLoading(false); });
    return () => { live = false; };
  }, [season,serial]);
  useEffect(() => { setEditing(null); setCreating(false); setRenaming(null); setLeagueFilter(''); },[season]);
  const availableLeagues = useMemo(() => leagues.filter(l => !l.season || l.season === season),[leagues,season]);
  const availableTeams = useMemo(() => teams.filter(t => t.season === season && draft.league && storage.leaguesMatch(t.league,draft.league)),[teams,season,draft.league]);
  const displayed = useMemo(() => games.filter(g => {
    if (leagueFilter && !storage.leaguesMatch(g.league,leagueFilter)) return false;
    if (dateFilter && dayOf(g.date) !== dateFilter) return false;
    if (editableOnly && !g.potentially_editable) return false;
    const q=search.trim().toLowerCase();
    return !q || [g.home_name,g.away_name,g.league,g.location,g.notes,g.start_time,g.end_time,dayOf(g.date)].some(v => String(v || '').toLowerCase().includes(q));
  }),[games,leagueFilter,dateFilter,editableOnly,search]);
  const byDay = useMemo(() => {
    const rows=new Map<string,storage.AdminScheduledGame[]>();
    for(const g of displayed) { const key=dayOf(g.date); rows.set(key,[...(rows.get(key)||[]),g]); }
    return [...rows.entries()];
  },[displayed]);
  const closeForm=()=>{setCreating(false);setEditing(null);setRenaming(null);};
  const beginNew=()=>{closeForm();setDraft({...blank(),league:leagueFilter});setError('');setCreating(true);};
  const beginEdit=(g:storage.AdminScheduledGame)=>{
    if(!g.potentially_editable)return;
    closeForm();
    setDraft({league:g.league,homeId:g.home_team_id||'',awayId:g.away_team_id||'',date:dayOf(g.date),startTime:g.start_time||'6:00 pm',endTime:g.end_time||'7:00 pm',location:g.location||'',notes:g.notes||''});
    setError('');setEditing(g);
  };
  const change=(key:keyof Draft,value:string)=>setDraft(v=>({...v,[key]:value,...(key==='league'?{homeId:'',awayId:''}:{})}));
  const saveGame=async()=>{
    const home=availableTeams.find(t=>t.id===draft.homeId),away=availableTeams.find(t=>t.id===draft.awayId);
    if(!home||!away||home.id===away.id||!draft.league||!isValidScheduleDate(draft.date)||!isValidScheduleTime(draft.startTime)||!isValidScheduleTime(draft.endTime)){
      setError('Select a division, two different teams, a valid date and start/end times.');return;
    }
    setSaving(true);setError('');setMessage('');
    try{
      const details={season,group:draft.league,date:draft.date,scheduledIsoDate:combineDateAndTime(draft.date,draft.startTime.trim()),startTime:draft.startTime.trim(),endTime:draft.endTime.trim(),location:draft.location.trim(),notes:draft.notes.trim(),homeTeamId:home.id,awayTeamId:away.id};
      if(editing){
        await storage.updateSingleScheduledGame(editing.id,{...details,expectedRevision:Number(editing.revision)});
        setMessage('Game updated. Other games and scores were not changed.');
      }else{
        const record:ScheduledGameRecord={...details,homeTeamName:home.name,awayTeamName:away.name};
        const result=await storage.createSingleScheduledGame(record);
        setMessage(result.skippedDuplicates?'The matchup already exists that day; no duplicate was created.':'Game added to the schedule.');
      }
      closeForm();refresh();onChanged();
    }catch(e:any){setError(e.message||'Could not save this game.');}
    finally{setSaving(false);}
  };
  const remove=async(g:storage.AdminScheduledGame)=>{
    if(!g.potentially_editable || !window.confirm('Delete only '+g.home_name+' vs '+g.away_name+' on '+dayOf(g.date)+'? Other games will stay in the schedule.'))return;
    setSaving(true);setError('');setMessage('');
    try{await storage.deleteSingleScheduledGame(g.id);setMessage('Only this unstarted game was removed.');refresh();onChanged();}
    catch(e:any){setError(e.message||'Could not delete this game.');}
    finally{setSaving(false);}
  };
  const beginRename=(id:string|null)=>{
    const team=teams.find(t=>t.id===id);
    if(!team){setError('Team not found. Refresh and try again.');return;}
    closeForm();setRenaming(team);setNewName(team.name);setError('');
  };
  const saveName=async()=>{
    if(!renaming||!newName.trim())return;
    setSaving(true);setError('');
    try{await storage.renameActiveSeasonTeam(renaming.id,newName.trim(),season);setMessage('Team name corrected everywhere. Existing games, scores and roster were preserved.');closeForm();refresh();onChanged();}
    catch(e:any){setError(e.message||'Could not rename this team.');}
    finally{setSaving(false);}
  };
  const finishImport=(summary:ScheduleImportSummary)=>{
    setImporting(false);closeForm();
    setMessage(summary.createdMatches+' games imported; '+summary.skippedDuplicates+' duplicates skipped.');
    refresh();onChanged();
  };

  return <section className="space-y-4" aria-label="Admin schedule management">
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white">Schedule</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">{season} active season · Import, adjust or add any unstarted game without leaving Admin.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={()=>setImporting(true)} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-bold">Import CSV</button>
          <button type="button" onClick={beginNew} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-bold">+ Add Game</button>
          <button type="button" onClick={refresh} disabled={loading||saving} className={actionClass}>Refresh</button>
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">{games.length} games · {games.filter(g=>g.potentially_editable).length} editable · {availableLeagues.length} divisions</div>
    </div>
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
      <h4 className="text-sm font-bold text-slate-800 dark:text-white mb-3">Find a game</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm text-slate-800 dark:text-slate-200">Division<select className={inputClass} value={leagueFilter} onChange={e=>setLeagueFilter(e.target.value)}>
          <option value="">All divisions</option>{availableLeagues.map(l=><option key={l.id} value={l.id}>{l.id}</option>)}
        </select></label>
        <label className="text-sm text-slate-800 dark:text-slate-200">Date<input type="date" className={inputClass} value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/></label>
        <label className="text-sm text-slate-800 dark:text-slate-200">Search team or cage<input type="search" className={inputClass} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Team, cage, time…"/></label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={editableOnly} onChange={e=>setEditableOnly(e.target.checked)}/>Only games I can edit</label>
    </div>
    {error&&<div role="alert" className="bg-red-50 border border-red-300 text-red-800 p-3 rounded-xl text-sm">{error}</div>}
    {message&&<div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3 rounded-xl text-sm">{message}</div>}
    {(creating||editing)&&<form aria-label="Game schedule editor" onSubmit={e=>{e.preventDefault();void saveGame();}} className="bg-blue-50 dark:bg-slate-900 border-2 border-blue-400 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex justify-between items-center gap-2"><h4 className="font-black text-lg text-slate-900 dark:text-white">{editing?'Edit this game':'Add one game'}</h4><button type="button" className={actionClass} disabled={saving} onClick={closeForm}>Cancel</button></div>
      <p className="text-xs text-slate-600 dark:text-slate-300">Only this game will be changed. Protected games cannot be edited.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-slate-800 dark:text-white">Division<select className={inputClass} value={draft.league} required onChange={e=>change('league',e.target.value)}><option value="">Choose division</option>{availableLeagues.map(l=><option key={l.id} value={l.id}>{l.id}</option>)}</select></label>
        <label className="text-sm text-slate-800 dark:text-white">Game date<input type="date" className={inputClass} value={draft.date} required onChange={e=>change('date',e.target.value)}/></label>
        <label className="text-sm text-slate-800 dark:text-white">Home team<select className={inputClass} value={draft.homeId} required onChange={e=>change('homeId',e.target.value)}><option value="">Choose home team</option>{availableTeams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="text-sm text-slate-800 dark:text-white">Away team<select className={inputClass} value={draft.awayId} required onChange={e=>change('awayId',e.target.value)}><option value="">Choose away team</option>{availableTeams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="text-sm text-slate-800 dark:text-white">Start time<input className={inputClass} value={draft.startTime} placeholder="6:00 pm" required onChange={e=>change('startTime',e.target.value)}/></label>
        <label className="text-sm text-slate-800 dark:text-white">End time<input className={inputClass} value={draft.endTime} placeholder="7:00 pm" required onChange={e=>change('endTime',e.target.value)}/></label>
        <label className="text-sm text-slate-800 dark:text-white sm:col-span-2">Cage / tunnel / location<input className={inputClass} value={draft.location} maxLength={250} onChange={e=>change('location',e.target.value)}/></label>
        <label className="text-sm text-slate-800 dark:text-white sm:col-span-2">Notes<textarea className={inputClass} rows={2} value={draft.notes} maxLength={1000} onChange={e=>change('notes',e.target.value)}/></label>
      </div>
      <button type="submit" disabled={saving||loading||!draft.homeId||!draft.awayId||draft.homeId===draft.awayId} className="rounded-lg bg-blue-600 text-white font-bold px-5 py-3 disabled:opacity-40">{saving?'Saving…':editing?'Save changes':'Add game'}</button>
    </form>}
    {renaming&&<form aria-label="Correct team name" onSubmit={e=>{e.preventDefault();void saveName();}} className="bg-blue-50 dark:bg-slate-900 border-2 border-blue-400 rounded-2xl p-4 space-y-3">
      <h4 className="font-bold text-slate-900 dark:text-white">Correct team name</h4>
      <p className="text-xs text-slate-600 dark:text-slate-300">Rename {renaming.name} everywhere this season. Existing games, scores, and roster IDs stay linked.</p>
      <label className="text-sm text-slate-800 dark:text-white">New team name<input autoFocus className={inputClass} maxLength={120} value={newName} onChange={e=>setNewName(e.target.value)}/></label>
      <div className="flex gap-2"><button type="submit" disabled={saving||!newName.trim()} className="bg-blue-600 px-4 py-2 rounded-lg font-bold text-white disabled:opacity-40">Save name</button><button type="button" disabled={saving} onClick={closeForm} className={actionClass}>Cancel</button></div>
    </form>}
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
      <h4 className="font-bold text-slate-900 dark:text-white mb-3">Games ({displayed.length}) {loading&&<span className="text-xs text-blue-600">Refreshing…</span>}</h4>
      {!loading&&displayed.length===0&&<p className="text-sm text-slate-500">No games match your filters. You can add one above.</p>}
      <div className="space-y-5">{byDay.map(([date,rows])=><div key={date}>
        <h5 className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg font-bold text-sm text-slate-800 dark:text-white mb-2">{date} · {rows.length} game(s)</h5>
        <div className="space-y-2">{rows.map(g=><div key={g.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0"><div className="font-bold text-sm text-slate-900 dark:text-white">{g.home_name||'Unknown'} vs {g.away_name||'Unknown'}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{g.league} · {g.start_time||'TBD'}–{g.end_time||'TBD'} · {g.location||'No cage'}</div>
            {g.notes&&<div className="text-xs text-slate-500">{g.notes}</div>}
            {!g.potentially_editable&&<div className="text-xs text-amber-600">Started, scored, or protected — cannot edit</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {g.potentially_editable&&<><button type="button" disabled={saving||loading} onClick={()=>beginEdit(g)} className={actionClass}>Edit game</button><button type="button" disabled={saving||loading} onClick={()=>void remove(g)} className="px-3 py-2 rounded-lg border border-red-300 text-red-700 dark:text-red-300 font-semibold text-sm">Delete</button></>}
            <button type="button" disabled={saving||loading} onClick={()=>beginRename(g.home_team_id)} className={actionClass}>Rename home</button>
            <button type="button" disabled={saving||loading} onClick={()=>beginRename(g.away_team_id)} className={actionClass}>Rename away</button>
          </div>
        </div>)}</div>
      </div>)}</div>
    </div>
    {importing&&<ScheduleImportModal isOpen={importing} currentSeason={season} availableLeagues={availableLeagues} onClose={()=>setImporting(false)} onSuccess={finishImport}/>}
  </section>;
};
