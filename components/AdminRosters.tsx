import React, { useEffect, useRef, useState } from 'react';
import type { League, Player, Team } from '../types';
import * as storage from '../services/storageService';
import { priorPlayerCandidates, playerHistoryTeamLabel, type PlayerIdentityLink, type PlayerIdentityCandidate } from '../utils/playerIdentity';

const freshPlayer = (): Player => ({ id: storage.generateUUID(), name: '', lastName: '' });
const copy = (players: Player[]) => players.map(p => ({ ...p }));

export const AdminRosters: React.FC<{ season: string; initialTeamId?:string; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }> = ({ season, initialTeamId, onDirtyChange, onBusyChange }) => {
  const pendingTarget=useRef(initialTeamId);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [league, setLeague] = useState('');
  const [selected, setSelected] = useState<Team | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [subs, setSubs] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [identityLinks, setIdentityLinks] = useState<PlayerIdentityLink[]>([]);
  const [playerHistory, setPlayerHistory] = useState<PlayerIdentityCandidate[]>([]);
  const [identityChoices, setIdentityChoices] = useState<Record<string, string>>({});
  const [historySearch, setHistorySearch] = useState<Record<string, string>>({});
  const [openSearch, setOpenSearch] = useState<Record<string, boolean>>({});
  const [openMatches, setOpenMatches] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState('');
  const firstNameInputs = useRef<Record<string,HTMLInputElement>>({});
  const matchingExistingTeam = creating ? teams.find(team => storage.leaguesMatch(team.league,league) && team.name.trim().toLowerCase() === teamName.trim().toLowerCase()) : undefined;
  const hasPlayerEntries = [...players,...subs].some(player => player.name.trim() || player.lastName?.trim());
  const dirty = !!selected && (creating ? !!teamName.trim() || hasPlayerEntries || Object.keys(identityChoices).length > 0 :
    Object.keys(identityChoices).length > 0 || JSON.stringify({ players, subs }) !== JSON.stringify({ players: selected.players, subs: selected.subs || [] }));
  const candidates = (player: Player) => {
    const link = identityLinks.find(link => link.rosterPlayerId === player.id);
    return link && link.resolution !== 'unreviewed' ? [] : priorPlayerCandidates(player, season, playerHistory, link?.personId);
  };
  const shownCandidates = (player: Player) => {
    const query = (historySearch[player.id] || '').trim().toLowerCase();
    const ownPersonId = identityLinks.find(link => link.rosterPlayerId === player.id)?.personId;
    const manual = query ? playerHistory.filter(candidate => candidate.personId !== ownPersonId &&
      [candidate.name, candidate.lastName || '', ...(candidate.aliases || []).map(alias => `${alias.name} ${alias.lastName || ''}`),
        ...candidate.teams.map(team => `${team.teamName} ${team.league || ''} ${team.season}`)].join(' ').toLowerCase().includes(query)) : [];
    return [...new Map([...candidates(player), ...manual].map(candidate => [candidate.personId, candidate])).values()];
  };

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(saving); }, [saving, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSuccess(''); setSelected(null); setCreating(false); setLeague(''); setTeams([]); setLeagues([]);
    storage.getAdminRosterData(season).then(data => {
      if (!active) return;
      setTeams(data.teams); setLeagues(data.leagues);
      setIdentityLinks(data.identityLinks); setPlayerHistory(data.playerHistory); setIdentityChoices({});
      if(pendingTarget.current){
        const team=data.teams.find(t=>t.id===pendingTarget.current && t.season===season);
        const destination=team && data.leagues.find(l=>storage.leaguesMatch(l.id,team.league));
        if(team && destination){setLeague(destination.id);openTeam(team);pendingTarget.current=undefined;}
        else setError('This team or its league is no longer available in the active season. Return to Before games and check again.');
      }else if (data.leagues.length === 1) setLeague(data.leagues[0].id);
    }).catch(err => { if (active) setError(err.message || 'Could not load rosters. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [season, reload]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const canLeave = () => !dirty || window.confirm('Leave without saving this roster?');
  const selectTeam = (id: string) => {
    const openingExistingEmptyDraft = creating && matchingExistingTeam?.id === id && !hasPlayerEntries && !Object.keys(identityChoices).length;
    if (!openingExistingEmptyDraft && !canLeave()) return;
    openTeam(teams.find(t => t.id === id) || null);
  };
  const openTeam=(team:Team|null)=>{
    setSelected(team); setCreating(false); setPlayers(copy(team?.players || [])); setSubs(copy(team?.subs || [])); setIdentityChoices({}); setHistorySearch({}); setOpenSearch({}); setOpenMatches({}); setError(''); setSuccess('');
  };
  const startCreate = () => {
    if (!league || !canLeave()) return;
    setSelected({id:storage.generateUUID(),name:'',league,season,players:[],subs:[]});
    setCreating(true); setTeamName(''); setPlayers([freshPlayer(),freshPlayer(),freshPlayer()]); setSubs([]);
    setIdentityChoices({}); setHistorySearch({}); setOpenSearch({}); setOpenMatches({}); setError(''); setSuccess('');
  };
  const changeLeague = (value: string) => {
    if (creating) {
      setLeague(value); setSelected(current => current ? {...current,league:value} : null);
      setError(''); setSuccess(''); return;
    }
    if (!canLeave()) return;
    setLeague(value); setSelected(null); setError(''); setSuccess('');
  };
  const edit = (kind: 'players' | 'subs', id: string, field: 'name' | 'lastName', value: string) => {
    const update = (list: Player[]) => list.map(p => p.id === id ? { ...p, [field]: value } : p);
    (kind === 'players' ? setPlayers : setSubs)(update); setSuccess('');
    setIdentityChoices(current => { const next = {...current}; delete next[id]; return next; });
  };
  const move = (kind: 'players' | 'subs', player: Player) => {
    if (kind === 'players') { setPlayers(players.filter(p => p.id !== player.id)); setSubs([...subs, player]); }
    else { setSubs(subs.filter(p => p.id !== player.id)); setPlayers([...players, player]); }
    setSuccess('');
  };
  const matchPreviousPlayer = (kind: 'players' | 'subs', playerId: string, candidate: PlayerIdentityCandidate) => {
    (kind === 'players' ? setPlayers : setSubs)(current => current.map(player => player.id === playerId
      ? {...player, name: candidate.name, lastName: candidate.lastName || ''} : player));
    setIdentityChoices(current => ({...current, [playerId]:candidate.personId}));
    closeHistory(playerId);
    firstNameInputs.current[playerId]?.focus({preventScroll:true});
    setSuccess(''); setError('');
  };
  const closeHistory = (playerId: string) => {
    setOpenSearch(current => ({...current,[playerId]:false}));
    setOpenMatches(current => ({...current,[playerId]:false}));
    setHistorySearch(current => ({...current,[playerId]:''}));
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || saving) return;
    if ([...players, ...subs].some(player => candidates(player).length && !identityChoices[player.id])) {
      setError('Confirm the previous-season matches shown below before saving.');
      const match = document.querySelector<HTMLElement>('[data-unconfirmed-match]');
      match?.scrollIntoView({block:'center',behavior:'smooth'});
      match?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const expectedLinks = Object.fromEntries([...players, ...subs].map(player => [player.id, identityLinks.find(link => link.rosterPlayerId === player.id)?.personId || null]));
      const saved = creating
        ? await storage.createAdminTeamRoster({...selected,name:teamName.trim(),players,subs},identityChoices)
        : await storage.saveAdminRoster(selected, players, subs, identityChoices, expectedLinks);
      setIdentityLinks(saved.identityLinks); setIdentityChoices({});
      setOpenSearch({}); setOpenMatches({}); setHistorySearch({});
      setTeams(current => current.some(team=>team.id===saved.id) ? current.map(team => team.id === saved.id ? saved : team) : [...current,saved]);
      setSelected(saved); setPlayers(copy(saved.players)); setSubs(copy(saved.subs || []));
      setCreating(false);
      setSuccess(creating ? 'Team and roster created. You can now use this team in the schedule.' : 'Roster saved. Recorded games and scores are preserved.');
    } catch (err: any) { setError(err.message || 'The roster was not saved. Try again.'); }
    finally { setSaving(false); }
  };
  const inputClass = 'w-full min-w-0 min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-3 py-2 text-base text-slate-900 dark:text-white';
  const section = (kind: 'players' | 'subs', list: Player[], title: string) => (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-slate-900 dark:text-white">{title}{list.length ? ` (${list.length})` : kind === 'subs' ? ' (optional)' : ''}</h3>
        {kind === 'subs' && <button type="button" disabled={saving || subs.length >= 50}
          onClick={() => { setSubs(current => [...current,freshPlayer()]); setSuccess(''); }}
          className="min-h-[44px] rounded-lg px-3 text-sm font-bold text-blue-700 dark:text-blue-300 disabled:opacity-40">Add substitute</button>}
      </div>
      {list.map((player, index) => {
        const existing = [...(selected?.players || []), ...(selected?.subs || [])].some(p => p.id === player.id);
        const label = `${kind === 'players' ? 'Team player' : 'Substitute'} ${index + 1}`;
        const choice = identityChoices[player.id];
        const linkedHistory = playerHistory.find(candidate => candidate.personId === identityLinks.find(link => link.rosterPlayerId === player.id)?.personId);
        const chosenHistory = playerHistory.find(candidate => candidate.personId === choice);
        const displayedHistory = chosenHistory || (choice !== 'new' ? linkedHistory : undefined);
        const matches = shownCandidates(player);
        const showMatches = matches.length > 0 && (!choice || openMatches[player.id]);
        const changeMatch = () => {
          setOpenSearch(current => ({...current,[player.id]:true}));
          setOpenMatches(current => ({...current,[player.id]:true}));
          setHistorySearch(current => ({...current,[player.id]:current[player.id] || `${displayedHistory?.name || player.name} ${displayedHistory?.lastName ?? player.lastName ?? ''}`.trim()}));
        };
        return (
          <div key={player.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{kind === 'players' ? `Player ${index + 1}` : label}</p>
              <div className="flex items-center gap-1">
                {!displayedHistory && choice !== 'new' && <button type="button" disabled={saving} aria-label={`Search history for ${label}`} aria-expanded={!!openSearch[player.id]}
                  onClick={() => { if (openSearch[player.id]) closeHistory(player.id); else setOpenSearch(current => ({...current,[player.id]:true})); }}
                  className="min-h-[44px] px-1 text-sm font-semibold text-blue-700 dark:text-blue-300">{openSearch[player.id] ? 'Close search' : 'Find previous'}</button>}
              <details className="relative text-sm">
                <summary aria-label={`Options for ${label}`} className="min-h-[44px] cursor-pointer select-none px-2 py-3 text-slate-600 dark:text-slate-300">Options</summary>
                <div className="absolute right-0 top-full z-20 w-48 space-y-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-lg">
                  <button type="button" disabled={saving || (kind === 'players' ? players.length <= 2 : players.length >= 3)}
                    onClick={() => move(kind,player)} className="min-h-[44px] w-full rounded-lg px-2 text-left font-semibold text-blue-700 dark:text-blue-300 disabled:opacity-40">
                    {kind === 'players' ? 'Move to substitutes' : 'Make team player'}
                  </button>
                  {!existing && <button type="button" disabled={saving} className="min-h-[44px] w-full rounded-lg px-2 text-left font-semibold text-rose-700 dark:text-rose-300"
                    onClick={() => (kind === 'players' ? setPlayers : setSubs)(current => current.filter(p => p.id !== player.id))}>Remove new player</button>}
                </div>
              </details>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <label className="text-sm text-slate-700 dark:text-slate-200">First name
                <input aria-label={`${label} first name`} ref={element => { if (element) firstNameInputs.current[player.id] = element; else delete firstNameInputs.current[player.id]; }} autoComplete="off" className={inputClass} value={player.name} maxLength={80} required disabled={saving}
                  onChange={e => edit(kind,player.id,'name',e.target.value)} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">Last name
                <input aria-label={`${label} last name`} autoComplete="off" className={inputClass} value={player.lastName || ''} maxLength={80} disabled={saving}
                  onChange={e => edit(kind,player.id,'lastName',e.target.value)} />
              </label>
            </div>
            {(displayedHistory || choice === 'new') && <div className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-2 text-sm text-emerald-800 dark:text-emerald-200">
              <p aria-label={chosenHistory ? `Selected previous player for ${label}` : choice === 'new' ? `Selected player choice for ${label}` : `${label} connected history`}>
                {displayedHistory ? <>✓ {displayedHistory.name} {displayedHistory.lastName}<span className="block text-xs">{displayedHistory.teams.map(playerHistoryTeamLabel).join(', ')}</span></> : '✓ Different player selected'}
              </p>
              <button type="button" disabled={saving} aria-label={`${openSearch[player.id] ? 'Close player search' : 'Change player match'} for ${label}`} onClick={() => { if (openSearch[player.id]) closeHistory(player.id); else changeMatch(); }}
                className="min-h-[44px] px-2 font-bold underline">{openSearch[player.id] ? 'Done' : 'Change'}</button>
            </div>}
            {openSearch[player.id] && <label className="mt-2 block text-sm text-slate-600 dark:text-slate-300">Find a previous player
              <input type="search" autoFocus aria-label={`Find a previous player for ${label}`} className={inputClass}
                placeholder="Name, team or league" disabled={saving} value={historySearch[player.id] || ''}
                onChange={event => setHistorySearch(current => ({...current,[player.id]:event.target.value}))} />
            </label>}
            {showMatches && <div data-unconfirmed-match={candidates(player).length && !choice ? '' : undefined} className="mt-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-slate-900 dark:text-slate-100" aria-label={`Previous-season matches for ${label}`}>
              <p className="font-bold">Has this player played before?</p>
              {matches.map((candidate,candidateIndex) => <div key={candidate.personId} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-blue-200 dark:border-blue-800 pt-2">
                <div><p className="font-semibold">{candidate.name} {candidate.lastName}</p><p className="text-xs">{candidate.teams.map(playerHistoryTeamLabel).join(', ')}</p></div>
                <button type="button" disabled={saving} aria-label={`${label}: match previous player ${candidateIndex + 1}`} aria-pressed={choice === candidate.personId}
                  onClick={() => matchPreviousPlayer(kind,player.id,candidate)}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 font-bold text-white">Yes, same player</button>
              </div>)}
              <button type="button" disabled={saving} aria-pressed={choice === 'new'} onClick={() => { setIdentityChoices(current => ({...current,[player.id]:'new'})); closeHistory(player.id); firstNameInputs.current[player.id]?.focus({preventScroll:true}); setError(''); }}
                className="mt-2 min-h-[44px] font-semibold text-slate-700 dark:text-slate-200 underline">No, this is a different player</button>
            </div>}
            {openSearch[player.id] && historySearch[player.id]?.trim() && !matches.length && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No previous players found.</p>}
          </div>
        );
      })}
      {kind === 'players' && players.length < 3 && <button type="button" disabled={saving}
        onClick={() => { setPlayers(current => current.length ? [...current,freshPlayer()] : [freshPlayer(),freshPlayer(),freshPlayer()]); setSuccess(''); }}
        className="min-h-[44px] rounded-lg border border-blue-300 dark:border-blue-700 px-4 py-2 font-bold text-blue-700 dark:text-blue-300 disabled:opacity-40">
        {players.length ? 'Add team player' : 'Set up three players'}
      </button>}
    </section>
  );

  const leagueField = (
    <label className="text-sm font-bold text-slate-700 dark:text-slate-200">League
          <select aria-label="League" className={inputClass} value={league} required={creating} disabled={loading || saving} onChange={e => changeLeague(e.target.value)}>
            <option value="">Choose a league</option>{leagues.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
          </select>
        </label>
  );

  return (
    <section aria-label="Roster management" className="space-y-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-4 sm:p-6">
      <div><h2 className="text-2xl font-bold text-slate-900 dark:text-white">{creating ? 'Create team' : 'Rosters'}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{creating ? `Enter the team and its three players for ${season}. Returning players appear as you type.` : selected ? `Editing ${selected.name} · ${selected.league} · ${season}.` : `Manage teams and players for ${season}. Choose a team or create a new one.`}</p></div>
      {loading && <p role="status">Loading rosters…</p>}
      {error && <div role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950 p-3 text-rose-800 dark:text-rose-200">{error}
        <button type="button" disabled={saving} className="ml-3 font-bold underline" onClick={() => { if (canLeave()) setReload(value => value + 1); }}>Reload rosters</button>
      </div>}
      {success && <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950 p-3 text-emerald-800 dark:text-emerald-200">{success}</p>}
      {!loading && leagues.length === 0 && !error && <p>Create a league or import its schedule first.</p>}
      {!creating && <div className="grid gap-3 sm:grid-cols-2">
        {leagueField}
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Team
          <select aria-label="Team" className={inputClass} value={creating ? '' : selected?.id || ''} disabled={!league || loading || saving || creating} onChange={e => selectTeam(e.target.value)}>
            <option value="">Choose a team</option>{teams.filter(t => storage.leaguesMatch(t.league, league)).map(t => <option key={t.id} value={t.id}>{t.name}{t.players.length<2 ? ' — roster needed' : ''}</option>)}
          </select>
        </label>
      </div>}
      {!creating && <button type="button" disabled={!league || loading || saving || creating} onClick={startCreate} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-40">Create team</button>}
      {!creating && league && !loading && !teams.some(t => storage.leaguesMatch(t.league, league)) && <p>No teams yet. Create a team and roster here, or import the schedule first.</p>}
      {selected && <form onSubmit={save} className="space-y-6">
        {creating && <div className="grid gap-3 sm:grid-cols-2">{leagueField}<label className="text-sm font-bold text-slate-700 dark:text-slate-200">Team name
          <input aria-label="New team name" autoFocus className={inputClass} value={teamName} required maxLength={100} disabled={saving} onChange={event=>setTeamName(event.target.value)} />
        </label></div>}
        {matchingExistingTeam && <p className="rounded-xl bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-900 dark:text-blue-100">
          This team already exists. Its schedule and roster will be kept.
          <button type="button" className="ml-2 font-bold underline" onClick={()=>selectTeam(matchingExistingTeam.id)}>Open existing team</button>
        </p>}
        {section('players', players, 'Team players')}
        {section('subs', subs, 'Substitutes')}
        <div className="sticky bottom-0 z-10 flex flex-wrap gap-3 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 py-3">
          <button type="submit" disabled={saving || !dirty || players.length < 2 || !!matchingExistingTeam || (creating && !league)} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-40">{saving ? 'Saving…' : creating ? 'Create team' : 'Save roster'}</button>
          <button type="button" disabled={saving || (!dirty && !creating)} onClick={() => { if (!canLeave()) return; if (creating) { setSelected(null); setCreating(false); } else { setPlayers(copy(selected.players)); setSubs(copy(selected.subs || [])); } setIdentityChoices({}); setOpenSearch({}); setOpenMatches({}); setHistorySearch({}); setError(''); setSuccess(''); }}
            className="rounded-xl border border-slate-300 dark:border-slate-600 px-5 py-3 font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40">{creating ? 'Cancel new team' : 'Discard changes'}</button>
        </div>
      </form>}
    </section>
  );
};
