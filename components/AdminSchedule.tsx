import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { League, Match, Team } from '../types';
import * as storage from '../services/storageService';
import { sortMatchesChronologically } from '../utils/matchSort';
import { scheduleLockedReason } from '../utils/schedulePolicy';
import { ScheduleResolutionModal } from './ScheduleResolutionModal';
import type {ResolutionWorkspace,ResolutionGame} from '../utils/scheduleResolution';
import {scheduleConflicts} from '../utils/scheduleConflicts';
import {conflictPairCount,displayBookingTime} from '../utils/scheduleConflictPresentation';
import {generateUUID} from '../services/storageService';
import { CAGE_LOCATIONS, canonicalCage } from '../utils/scheduleValidation';

const dateKey = (date: string) => String(date || '').slice(0, 10);
const formatDay = (date: string) => dateKey(date) || 'Unscheduled';
const editable = (game: Match) => !scheduleLockedReason(game);
const lockedReason = scheduleLockedReason;
const authHeaders = (): HeadersInit => {
  try {
    const token = sessionStorage.getItem('dugout_auth_token') || localStorage.getItem('dugout_auth_token');
    return token ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } : { 'Content-Type': 'application/json' };
  } catch { return { 'Content-Type': 'application/json' }; }
};

interface Props {
  season: string;
  onImport: (leagues: League[]) => void;
  refreshToken: number;
}

export const AdminSchedule: React.FC<Props> = ({ season, onImport, refreshToken }) => {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [games, setGames] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [busy, setBusy] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [resolution,setResolution]=useState<ResolutionWorkspace|null>(null);
  const [removing, setRemoving] = useState<Match | null>(null);
  const [renaming, setRenaming] = useState<Team | null>(null);
  const [newName, setNewName] = useState('');
  const [showTeams, setShowTeams] = useState(false);
  const [teamLeagueFilter, setTeamLeagueFilter] = useState('all');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    setGames([]); setTeams([]); setLeagues([]);
    try {
      const data = await storage.getAdminScheduleData(season);
      setGames(data.matches);
      setTeams(data.teams);
      setLeagues(data.leagues);
    } catch (err: any) {
      setError(err?.message || 'Could not load the schedule.');
    } finally { setBusy(false); }
  }, [season]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const visible = useMemo(() => sortMatchesChronologically(games.filter(game => {
    if (leagueFilter !== 'all' && !storage.leaguesMatch(game.league, leagueFilter)) return false;
    const home = teams.find(team => team.id === game.homeTeamId)?.name || '';
    const away = teams.find(team => team.id === game.awayTeamId)?.name || '';
    const q = search.toLowerCase().trim();
    return !q || [game.league, home, away, game.location || '', dateKey(game.date)].join(' ').toLowerCase().includes(q);
  })), [games, teams, leagueFilter, search]);
  const overlaps=useMemo(()=>scheduleConflicts(games),[games]);
  const overlapIds=useMemo(()=>new Set(overlaps.flatMap(c=>[c.firstId,c.secondId])),[overlaps]);
  const overlapPairs=useMemo(()=>conflictPairCount(overlaps),[overlaps]);
  const overlappingGames=useMemo(()=>sortMatchesChronologically(games.filter(g=>overlapIds.has(g.id))),[games,overlapIds]);
  const editableOverlapIds=overlappingGames.filter(editable).map(g=>g.id);
  const calendar=useMemo<ResolutionGame[]>(()=>games.map(m=>({id:m.id,league:m.league,kind:'existing',revision:m.revision||0,date:dateKey(m.date),startTime:m.startTime||'',endTime:m.endTime||'',location:canonicalCage(m.location)||m.location||'',homeTeamId:m.homeTeamId,awayTeamId:m.awayTeamId,notes:m.notes||undefined,lockedReason:lockedReason(m)})),[games]);
  const scheduled = games.filter(editable).length;

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/schedule-admin', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: authHeaders(),
      body: JSON.stringify({ ...payload, season })
    });
    if (!res.ok) {
      const response = await res.json().catch(() => ({}));
      throw new Error(response.error || 'Could not save this change.');
    }
    return res.json();
  };

  const beginEdit = (game?: Match) => {
    setError(''); setSuccess('');
    const draftCalendar=[...calendar];
    const root=game?.id||generateUUID();
    if(!game)draftCalendar.push({id:root,kind:'new',league:leagues[0]?.id||'',revision:0,date:season+'-'+new Date().toISOString().slice(5,10),startTime:'6:00 pm',endTime:'7:00 pm',location:CAGE_LOCATIONS[0].value,homeTeamId:'',awayTeamId:''});
    setResolution({games:draftCalendar,teams,leagues,rootIds:[root]});
  };
  const reviewOverlaps=()=>{setError('');setSuccess('');setResolution({games:calendar,teams,leagues,rootIds:editableOverlapIds.length?editableOverlapIds:overlappingGames.map(g=>g.id)});};
  const removeGame = async (game: Match) => {
    setWorkingId(game.id);
    setError('');
    try {
      await post({ action: 'delete_game', id: game.id });
      setSuccess('Unplayed game removed.');
      setRemoving(null);
      await load();
    } catch (err: any) { setError(err?.message || 'Could not remove this game.'); }
    finally { setWorkingId(''); }
  };
  const rename = async () => {
    if (!renaming || !newName.trim()) return;
    setWorkingId(renaming.id);
    setError('');
    try {
      await post({ action: 'rename_team', id: renaming.id, teamName: newName.trim() });
      setRenaming(null);
      setSuccess('Team name updated everywhere this team appears.');
      await load();
    } catch (err: any) { setError(err?.message || 'Could not rename the team.'); }
    finally { setWorkingId(''); }
  };
  const leagueTeams = (league: string) => teams.filter(team => storage.leaguesMatch(team.league, league));
  const name = (id: string) => teams.find(team => team.id === id)?.name || 'Unknown team';
  const inputClass = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white p-2.5 text-sm';
  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 justify-between sm:items-center">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">Season Schedule · {season}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {games.length} official games · {scheduled} awaiting play · {teams.length} teams
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => void load()} disabled={busy} className="rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white px-4 py-2.5 font-bold text-sm disabled:opacity-50">
            {busy ? 'Refreshing...' : 'Refresh'}
          </button>
          <button onClick={()=>beginEdit()} disabled={busy||!!error||!leagues.length} className="rounded-lg bg-blue-600 text-white px-4 py-2.5 font-bold text-sm disabled:opacity-50">+ Add game</button>
          <button onClick={() => onImport(leagues)} disabled={busy || !!error} className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 font-bold text-sm">+ Import Schedule CSV</button>
        </div>
      </div>
      {!busy&&overlapIds.size>0&&<div role="alert" aria-label="Schedule overlap warning" className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/60 text-red-950 dark:text-red-100 p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div>
          <h4 className="font-black text-lg">{overlapIds.size} games overlap</h4>
          <p className="text-sm mt-1">{overlapPairs} booking overlap{overlapPairs===1?'':'s'} found across the full {season} season, including games hidden by your filters.</p>
          <p className="text-sm mt-1">{editableOverlapIds.length?'Adjust unplayed games to clear their overlaps. Played games and games open for scoring stay locked.':'These games are protected. You can review their bookings, but their results cannot be changed here.'}</p>
        </div>
        <button type="button" onClick={reviewOverlaps} className="min-h-11 rounded-lg bg-red-700 hover:bg-red-800 text-white px-4 py-2.5 font-bold text-sm shrink-0">{editableOverlapIds.length?'Review unplayed games':'View overlaps'}</button>
      </div>}
      <div className="bg-white/80 dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
        <h4 className="font-bold text-sm text-slate-900 dark:text-white">Find games</h4>
        <div className="flex flex-col sm:flex-row gap-2">
          <select aria-label="Filter by league" value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)} className={inputClass + ' sm:max-w-xs'}>
            <option value="all">All leagues</option>
            {leagues.map(league => <option key={league.id} value={league.id}>{league.id}</option>)}
          </select>
          <input aria-label="Find games" placeholder="Find a team, date, or cage..." value={search} onChange={e => setSearch(e.target.value)} className={inputClass}/>
        </div>
        {error && <div role="alert" className="rounded-lg bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 p-3 text-sm">{error}</div>}
        {success && <div role="status" className="text-green-700 dark:text-green-400 text-sm">{success}</div>}
      </div>

      <div className="bg-white/80 dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-white">Team names · {season}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">Choose a team to change its name across the schedule.</p>
          </div>
          <button type="button" onClick={() => setShowTeams(!showTeams)} aria-expanded={showTeams} aria-controls="schedule-team-names" className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white text-sm font-bold whitespace-nowrap">{showTeams ? 'Hide teams' : 'Rename teams'}</button>
        </div>
        {showTeams && (
          <div id="schedule-team-names" className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">Team league
              <select aria-label="Team league" value={teamLeagueFilter} onChange={e => setTeamLeagueFilter(e.target.value)} className={inputClass + ' sm:max-w-xs block mt-1'}>
                <option value="all">All leagues</option>
                {leagues.map(league => <option key={league.id} value={league.id}>{league.id}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {teams.filter(t => teamLeagueFilter === 'all' || storage.leaguesMatch(t.league, teamLeagueFilter)).map(team => (
                <div key={team.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                  <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{team.name} <span className="text-xs text-slate-500">({team.league})</span></span>
                  <button onClick={() => { setRenaming(team); setNewName(team.name); setError(''); }} className="text-blue-600 dark:text-blue-400 font-bold text-xs">Rename</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {visible.map(game => (
          <div key={game.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-3.5 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="font-bold text-sm text-slate-900 dark:text-white">{formatDay(game.date)} · {game.startTime ? displayBookingTime(game.startTime) : 'Time TBA'}</span>
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{game.league}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{game.isComplete ? 'FINAL' : (game.status || 'SCHEDULED')}</span>
                {overlapIds.has(game.id)&&<span className="rounded-full bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100 px-2 py-0.5 text-xs font-bold">Schedule overlap</span>}
              </div>
              <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">{name(game.homeTeamId)} vs {name(game.awayTeamId)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{game.location || 'Location TBA'} · {game.startTime ? displayBookingTime(game.startTime) : 'Time TBA'}–{game.endTime ? displayBookingTime(game.endTime) : 'Time TBA'}</div>
            </div>
            {editable(game) ? (
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => beginEdit(game)} className="rounded-lg px-3 py-2 text-sm font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Edit</button>
                <button type="button" onClick={() => { setRemoving(game); setError(''); setSuccess(''); }} disabled={workingId === game.id} className="rounded-lg px-3 py-2 text-sm font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 disabled:opacity-50">Remove</button>
              </div>
            ) : <span className="text-xs text-amber-700 dark:text-amber-300 font-bold" title={lockedReason(game) || undefined}>🔒 {lockedReason(game)}</span>}
          </div>
        ))}
        {!busy && !error && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
            <div className="text-sm font-bold text-slate-800 dark:text-white">No games found for these filters.</div>
            <p className="text-xs text-slate-500 mt-2">Import a schedule to automatically create teams and games in their assigned leagues.</p>
          </div>
        )}
      </div>
      {resolution&&<ScheduleResolutionModal season={season} initial={resolution} onCancel={()=>{setResolution(null);setError('');}} onSaved={async()=>{setResolution(null);await load();setSuccess('Schedule changes saved on the league dashboards.');}}/>}
      {renaming && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 p-3 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Rename team">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-5 w-full max-w-md space-y-3">
            <h3 className="font-black text-lg text-slate-900 dark:text-white">Rename {renaming.name}</h3>
            {error && <div className="p-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded">{error}</div>}
            <p className="text-xs text-slate-500 dark:text-slate-400">All games for this team will display its new name.</p>
            <input value={newName} onChange={e => setNewName(e.target.value)} className={inputClass} aria-label="New team name"/>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRenaming(null); setError(''); }} className="rounded-lg px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white">Cancel</button>
              <button onClick={() => void rename()} disabled={!!workingId || !newName.trim()} className="rounded-lg px-4 py-2 bg-blue-600 text-white font-bold disabled:opacity-50">Save name</button>
            </div>
          </div>
        </div>, document.body
      )}
      {removing && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 p-3 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Confirm removal of scheduled game">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-5 w-full max-w-md space-y-4">
            <h3 className="font-black text-lg text-slate-900 dark:text-white">Remove scheduled game?</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {name(removing.homeTeamId)} vs {name(removing.awayTeamId)} · {formatDay(removing.date)} · {removing.league}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              This removes an unplayed game from the schedule. Completed or scored games cannot be removed. This action cannot be undone.
            </p>
            {error && <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setRemoving(null); setError(''); }}
                disabled={!!workingId} className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white">Cancel</button>
              <button type="button" onClick={() => void removeGame(removing)} disabled={!!workingId}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-50">
                {workingId ? 'Removing...' : 'Remove game'}
              </button>
            </div>
          </div>
        </div>, document.body
      )}
    </section>
  );
};
