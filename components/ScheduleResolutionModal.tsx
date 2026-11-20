import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {ScheduleImportDestination,ScheduleImportSummary} from '../types';
import {scheduleConflicts} from '../utils/scheduleConflicts';
import {bookingFields,changedBooking,resolutionGameError,type ResolutionGame,type ResolutionWorkspace} from '../utils/scheduleResolution';
import {conflictPairCount,conflictWarnings,displayBookingTime,displayScheduleDate,scheduleTimeOptions,scheduleTimeValue,oneHourEndTime} from '../utils/scheduleConflictPresentation';
import {CAGE_LOCATIONS} from '../utils/scheduleValidation';
import {generateUUID,requestScheduleResolution} from '../services/storageService';
interface Props {
  season:string; initial:ResolutionWorkspace;
  importing?:{csvText:string;leagueDestinations:Record<string,ScheduleImportDestination>};
  onCancel:()=>void; onSaved:(summary?:ScheduleImportSummary)=>void|Promise<void>;
}
const label=(field:string)=>({startTime:'Start time',endTime:'End time',homeTeamId:'Home team',awayTeamId:'Away team',location:'Cage / location',date:'Date',notes:'Notes'}[field]||field);
export const ScheduleResolutionModal:React.FC<Props>=({season,initial,importing,onCancel,onSaved})=>{
  const [state,setState]=useState({workspace:initial,drafts:Object.fromEntries(initial.games.map(g=>[g.id,{...g}])),notices:[] as string[]});
  const [visible,setVisible]=useState(new Set(initial.rootIds));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const [hadConflicts,setHadConflicts]=useState(false);
  const epoch=useRef(0);
  const saving=useRef(false),uncertainRef=useRef(false),dialog=useRef<HTMLDivElement>(null),scrollBox=useRef<HTMLDivElement>(null),requests=useRef(new Map<string,string>());
  const {workspace,drafts}=state;
  const importInput=workspace.importAlreadySaved?undefined:importing;
  const baseline=useMemo(()=>new Map(workspace.games.map(g=>[g.id,g])),[workspace.games]);
  const teamNames=useMemo(()=>new Map(workspace.teams.map(t=>[t.id,t.name])),[workspace.teams]);
  const merged=useMemo(()=>workspace.games.map(g=>g.lockedReason?g:drafts[g.id]||g),[workspace,drafts]);
  const changed=useMemo(()=>merged.filter(g=>!g.lockedReason&&(g.kind!=='existing'||changedBooking(baseline.get(g.id)!,g))),[merged,baseline]);
  const checked=useMemo(()=>new Set([...workspace.rootIds,...changed.map(g=>g.id)]),[workspace.rootIds,changed]);
  const conflicts=useMemo(()=>scheduleConflicts(merged,checked),[merged,checked]);
  const shown=new Set([...workspace.rootIds,...[...visible].map(id=>workspace.replacements?.[id]||id),...conflicts.flatMap(c=>[c.firstId,c.secondId])]);
  const byId=useMemo(()=>new Map(merged.map(g=>[g.id,g])),[merged]);
  const sections=[...shown].map(id=>byId.get(id)).filter((g):g is ResolutionGame=>!!g);
  const unavailable=sections.some(g=>g.lockedReason?.startsWith('This imported row is no longer available'));
  const invalid=sections.filter(g=>!g.lockedReason).map(g=>resolutionGameError(g,workspace.teams)).filter(Boolean);
  const teamName=(id:string)=>teamNames.get(id)||'Choose team';
  const gameNumbers=new Map(sections.map((game,index)=>[game.id,index+1]));
  const overlapCount=useMemo(()=>conflictPairCount(conflicts),[conflicts]);
  const warnings=useMemo(()=>conflictWarnings(conflicts,id=>teamNames.get(id)||'This team'),[conflicts,teamNames]);
  // Index once per edit, and collapse identical reasons in large imports.
  const conflictInfo=useMemo(()=>{
    const result=new Map<string,{fields:Set<string>}>();
    for(const conflict of conflicts){
      for(const id of [conflict.firstId,conflict.secondId]){
        let info=result.get(id);if(!info){info={fields:new Set()};result.set(id,info);}
        for(const key of ['date','startTime','endTime'])info.fields.add(key);
        if(conflict.kind==='cage')info.fields.add('location');
        else{const game=byId.get(id);if(game?.homeTeamId===conflict.teamId)info.fields.add('homeTeamId');if(game?.awayTeamId===conflict.teamId)info.fields.add('awayTeamId');}
      }
    }
    return result;
  },[conflicts,teamNames,byId]);
  useEffect(()=>{if(conflicts.length){setHadConflicts(true);setVisible(previous=>new Set([...previous,...conflicts.flatMap(c=>[c.firstId,c.secondId])]));}},[conflicts]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';dialog.current?.focus();
    return()=>{document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  const mergeFresh=(fresh:ResolutionWorkspace)=>setState(current=>{
    const notices=[...current.notices],next={...current.drafts};
    const old=new Map(current.workspace.games.map(g=>[g.id,g]));
    for(const game of fresh.games){
      const previousId=Object.keys(fresh.replacements||{}).find(id=>fresh.replacements![id]===game.id&&old.has(id))||game.id;
      const baseline=old.get(previousId),draft=current.drafts[previousId];
      if(!baseline||!draft){next[game.id]={...game};continue;}
      if(game.kind!==baseline.kind || game.kind==='existing'&&game.revision!==baseline.revision || game.lockedReason!==baseline.lockedReason){
        const detail=bookingFields.filter(k=>(game[k]||'')!==(baseline[k]||'')).map(k=>`${label(k)}: ${k==='homeTeamId'||k==='awayTeamId'?fresh.teams.find(t=>t.id===game[k])?.name||'Team unavailable':game[k]||'empty'}`).join('; ');
        notices.push(`${teamName(game.homeTeamId)} vs ${teamName(game.awayTeamId)} was updated on another screen. ${detail||game.lockedReason||'The game details were refreshed.'} ${game.lockedReason?'Your unsaved edits to this game have not been applied; the protected game is shown below.':'Your edits remain below. Review them before saving.'}`);
      }
      next[game.id]={...game};
      if(!game.lockedReason)for(const key of bookingFields)if((draft[key]||'')!==(baseline[key]||''))(next[game.id] as any)[key]=draft[key];
      for(const key of ['homeTeamId','awayTeamId'] as const){const id=next[game.id][key];if(fresh.teamReplacements?.[id]&&!fresh.teams.some(t=>t.id===id))next[game.id][key]=fresh.teamReplacements[id];}

    }
    // New single games exist only in this local draft until the atomic save.
    for(const game of current.workspace.games)if(game.kind==='new'&&!fresh.games.some(g=>g.id===game.id))fresh.games.push(game);
    // Keep removed games as read-only context rather than silently dropping a draft.
    for(const game of current.workspace.games)if(game.kind==='existing'&&!fresh.games.some(g=>g.id===game.id)){
      fresh.games.push({...game,lockedReason:'This game was removed on another screen. It cannot be saved.'});
      notices.push('A game was removed on another screen. Its unsaved changes have not been applied.');
    }
    for(const game of current.workspace.games)if(game.kind==='import'&&!fresh.games.some(g=>g.id===game.id)&&!fresh.replacements?.[game.id]){
      fresh.games.push({...game,lockedReason:'This imported row is no longer available. Cancel and reopen the CSV to review it; its unsaved edits have not been applied.'});
    }
    return {workspace:{...fresh,rootIds:current.workspace.rootIds.map(id=>fresh.replacements?.[id]||id),importAlreadySaved:fresh.importAlreadySaved||current.workspace.importAlreadySaved},drafts:next,notices:[...new Set(notices)]};
  });
  useEffect(()=>{
    let disposed=false,refreshing=false;const controller=new AbortController();
    const refresh=async()=>{
      if(saving.current||uncertainRef.current||refreshing)return;
      refreshing=true;const started=epoch.current;
      try{const fresh:ResolutionWorkspace=await requestScheduleResolution(season,{action:'preview_resolution',import:importInput},controller.signal);if(!disposed&&started===epoch.current&&!saving.current&&!uncertainRef.current)mergeFresh(fresh);}
      catch{/* Save rechecks under database locks even if the background refresh cannot connect. */}
      finally{refreshing=false;}
    };
    void refresh();const timer=window.setInterval(refresh,10000);
    return()=>{disposed=true;controller.abort();window.clearInterval(timer);};
  },[season,importInput]);
  const update=(id:string,key:keyof ResolutionGame,value:string)=>{
    setError('');setState(current=>({...current,drafts:{...current.drafts,[id]:{...current.drafts[id],...(key==='startTime'?{startTime:value,endTime:oneHourEndTime(value)||''}:{[key]:value})}}}));
  };
  const save=async()=>{
    if(saving.current||unavailable||conflicts.length||invalid.length||!changed.length)return;
    epoch.current++;saving.current=true;setBusy(true);setError('');
    const payload={changes:changed.map(({lockedReason,...game})=>game),import:importInput};
    const signature=JSON.stringify(payload);let requestId=requests.current.get(signature);
    if(!requestId){requestId=generateUUID();requests.current.set(signature,requestId);}
    try{
      const result=await requestScheduleResolution(season,{action:'resolve_schedule',requestId,...payload});
      // A committed save must not be presented as rejected if parent refresh fails.
      try{await onSaved(result.summary);}catch{setError('The changes were saved. Close this window and refresh the schedule.');}
    }catch(err:any){
      scrollBox.current?.scrollTo({top:0});
      if(err.resolution){mergeFresh(err.resolution);setError(err.message);}
      else if(err.status){setError(err.message);}
      else {uncertainRef.current=true;setUncertain(true);setError('Could not confirm the save. Your entries are kept here. Reconnect and press Save Changes again to check the result safely.');}
    }finally{saving.current=false;setBusy(false);}
  };
  const onKeyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'&&!busy){event.preventDefault();onCancel();}
    if(event.key==='Tab'){
      const nodes=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
      if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  };
  return createPortal(<div className="fixed inset-0 z-[10000] bg-slate-950/80 p-2 sm:p-5 flex items-center justify-center">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="schedule-resolution-title" onKeyDown={onKeyDown} className="w-full max-w-6xl max-h-[92dvh] flex flex-col rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xl">
      <header className="p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <h3 id="schedule-resolution-title" className="text-lg font-black">{hadConflicts||conflicts.length?'Resolve schedule conflicts':importing?'Review imported games':initial.games.find(g=>initial.rootIds.includes(g.id))?.kind==='new'?'Create scheduled game':'Edit scheduled game'}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">{hadConflicts||conflicts.length?'Edit any unlocked game below to fix the overlap. Highlighted fields need attention.':'Adjust the game details below.'} Nothing is saved until you select Save Changes.</p>
      </header>
      <div ref={scrollBox} className="overflow-y-auto min-h-0 p-3 sm:p-4 space-y-4">
        {error&&<p role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200">{error}</p>}
        {state.notices.map(note=><p key={note} role="status" className="p-3 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100 rounded-lg text-sm">{note}</p>)}
        <div role="status" aria-live="polite" className={`rounded-xl border p-4 ${conflicts.length||invalid.length||unavailable||uncertain?'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100':'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/50 text-green-900 dark:text-green-100'}`}>
          <p className="font-bold text-base">{uncertain?'Save needs confirmation':unavailable?'This import needs to be reopened':conflicts.length?`${new Set(conflicts.flatMap(c=>[c.firstId,c.secondId])).size} games overlap`:invalid.length?'Some game details are missing or invalid':changed.length?'Ready to save — no overlaps':'No unsaved changes'}</p>
          <p className="mt-1 text-sm">{uncertain?'Your entries are kept here. Reconnect and select Save Changes to confirm the result.':unavailable?'The schedule changed on another screen. Your unsaved edits have not been applied.':conflicts.length?`${overlapCount} overlap${overlapCount===1?'':'s'} to fix. Adjust the highlighted fields below.`:invalid.length?'Check the message inside each game card.':changed.length?`${changed.length} game${changed.length===1?'':'s'} will be saved together. The rest of the season has also been checked.`:'Cancel to return to the schedule, or edit a game below.'}</p>
        </div>
        <div className={`grid grid-cols-1 ${sections.length>1?'lg:grid-cols-2':''} gap-4 items-start`}>
        {sections.map((game,index)=>{
          const info=conflictInfo.get(game.id);
          const gameError=!game.lockedReason&&resolutionGameError(game,workspace.teams);
          const highlighted=info?.fields||new Set<string>();
          const cls=(key:string)=>`mt-1 w-full min-h-11 rounded-lg border p-2.5 text-base bg-white dark:bg-slate-950 text-slate-900 dark:text-white disabled:opacity-80 ${highlighted.has(key)?'border-amber-600 dark:border-amber-400 ring-1 ring-amber-500':'border-slate-300 dark:border-slate-700'}`;
          return <section key={game.id} aria-label={`Game ${index+1}: ${teamName(game.homeTeamId)} vs ${teamName(game.awayTeamId)}`} className={`border rounded-xl overflow-hidden ${game.lockedReason?'border-slate-300 dark:border-slate-600':info?'border-amber-400 dark:border-amber-600':'border-slate-300 dark:border-slate-700'}`}>
            <div className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2 mb-2 text-xs font-bold">
                <span className="rounded-md px-2 py-1 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900">Game {index+1}</span>
                <span className="text-slate-600 dark:text-slate-300">{workspace.rootIds.includes(game.id)?game.kind==='import'?'From your CSV':game.kind==='new'?'New game':workspace.rootIds.length>1?'Selected for review':'Game you opened':'Also affected'}</span>
                <span className={`rounded-full px-2 py-1 ${game.lockedReason?'bg-slate-200 dark:bg-slate-700':info||gameError?'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100':'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100'}`}>{game.lockedReason?'Read-only':info?'Overlapping':gameError?'Needs details':'No overlap'}</span>
              </div>
              <h4 className="font-bold text-lg leading-snug"><span>{teamName(game.homeTeamId)} vs {teamName(game.awayTeamId)}</span></h4>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{game.league} · {displayScheduleDate(game.date)}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">{displayBookingTime(game.startTime)}–{displayBookingTime(game.endTime)} · {game.location.replace('The Dugout: ','')||'Choose tunnels'}</p>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
            {game.lockedReason&&<p className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-sm"><strong>This game cannot be changed.</strong> {game.lockedReason} Resolve the overlap by editing another game.</p>}
            {(warnings.get(game.id)||[]).map(warning=><div key={warning.title+warning.detail} className="rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/50 p-3 text-sm text-amber-950 dark:text-amber-100">
              <p className="font-bold">{warning.title}</p>
              <p>{warning.detail}</p>
              <ul className="mt-2 space-y-1 text-xs">{[...warning.otherIds].slice(0,4).map(id=>{const other=byId.get(id);return <li key={id}>Overlaps Game {gameNumbers.get(id)}: {other?`${teamName(other.homeTeamId)} vs ${teamName(other.awayTeamId)}`:'another scheduled game'}</li>;})}</ul>
              {warning.otherIds.size>4&&<p className="mt-1 text-xs">Plus {warning.otherIds.size-4} other games shown in this window.</p>}
            </div>)}
            {gameError&&<p className="text-red-700 dark:text-red-300 text-sm">{gameError}</p>}
            <fieldset disabled={busy||uncertain||!!game.lockedReason} className="space-y-4">
              {game.kind==='new'&&<label className="text-sm font-bold">League<select aria-label="League" value={game.league} onChange={e=>update(game.id,'league',e.target.value)} className={cls('league')}>{workspace.leagues.map(l=><option key={l.id} value={l.id}>{l.id}</option>)}</select></label>}
              <div><h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Date, time &amp; tunnels</h5><div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold col-span-2">Date<input type="date" value={game.date} onChange={e=>update(game.id,'date',e.target.value)} aria-invalid={highlighted.has('date')||undefined} className={cls('date')+' [color-scheme:light] dark:[color-scheme:dark]'}/></label>
              <label className="text-sm font-bold">Start time<select aria-label="Start time" value={scheduleTimeValue(game.startTime)} onChange={e=>update(game.id,'startTime',e.target.value)} aria-invalid={highlighted.has('startTime')||undefined} className={cls('startTime')}><option value="" disabled>Select time...</option>{scheduleTimeOptions(game.startTime,baseline.get(game.id)?.startTime).map(option=><option key={option.value} value={option.value} disabled={!oneHourEndTime(option.value)}>{option.label}</option>)}</select><span className="block mt-1 text-xs font-normal text-slate-500 dark:text-slate-400">End time updates to one hour later.</span></label>
              <label className="text-sm font-bold">End time<select aria-label="End time" value={scheduleTimeValue(game.endTime)} onChange={e=>update(game.id,'endTime',e.target.value)} aria-invalid={highlighted.has('endTime')||undefined} className={cls('endTime')}><option value="" disabled>Select time...</option>{scheduleTimeOptions(game.endTime,baseline.get(game.id)?.endTime).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-sm font-bold col-span-2">Cage / location<select aria-label="Cage / location" value={game.location} onChange={e=>update(game.id,'location',e.target.value)} aria-invalid={highlighted.has('location')||undefined} className={cls('location')}><option value="">Select cage...</option>{CAGE_LOCATIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
              </div></div>
              <div><h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Teams</h5><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['homeTeamId','awayTeamId'] as const).map(key=><label key={key} className="text-sm font-bold">{label(key)}<select aria-label={label(key)} value={game[key]} onChange={e=>update(game.id,key,e.target.value)} aria-invalid={highlighted.has(key)||undefined} className={cls(key)}><option value="">Choose team...</option>{workspace.teams.filter(t=>t.league===game.league).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>)}
              </div></div>
              {game.notes!==undefined&&<label className="text-sm font-bold sm:col-span-2">Notes<textarea maxLength={2000} value={game.notes} onChange={e=>update(game.id,'notes',e.target.value)} className={cls('notes')}/></label>}
            </fieldset>
            </div>
          </section>;
        })}
        </div>
      </div>
      <footer className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-3 items-center justify-end shrink-0">
        <p className="text-xs text-slate-600 dark:text-slate-300 w-full sm:w-auto sm:mr-auto">{busy?'Saving all changes…':uncertain?'Save not confirmed. Retry Save Changes.':conflicts.length?'Resolve the overlaps to enable Save Changes.':invalid.length?'Complete the game details to enable saving.':changed.length?`${changed.length} game${changed.length===1?'':'s'} changed · not saved yet`: 'Nothing changed'}</p>
        <div className="flex gap-2 justify-end w-full sm:w-auto">
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 px-4 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold disabled:opacity-50">Cancel</button>
        <button type="button" onClick={()=>void save()} disabled={busy||unavailable||!!conflicts.length||!!invalid.length||!changed.length} className="min-h-11 px-4 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">{busy?'Saving…':'Save Changes'}</button>
        </div>
      </footer>
    </div>
  </div>,document.body);
};
