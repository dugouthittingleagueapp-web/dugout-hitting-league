import React, { useEffect, useState } from 'react';
import type { League, Player, Team } from '../types';
import * as storage from '../services/storageService';
import { priorPlayerCandidates, type PlayerIdentityLink, type PlayerIdentityCandidate } from '../utils/playerIdentity';

const freshPlayer = (): Player => ({ id: storage.generateUUID(), name: '', lastName: '' });
const copy = (players: Player[]) => players.map(p => ({ ...p }));

export const AdminRosters: React.FC<{ season: string; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }> = ({ season, onDirtyChange, onBusyChange }) => {
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
  const dirty = !!selected && (Object.keys(identityChoices).length > 0 || JSON.stringify({ players, subs }) !== JSON.stringify({ players: selected.players, subs: selected.subs || [] }));
  const candidates = (player: Player) => {
    const link = identityLinks.find(link => link.rosterPlayerId === player.id);
    return link && link.resolution !== 'unreviewed' ? [] : priorPlayerCandidates(player, season, playerHistory, link?.personId);
  };
  const shownCandidates = (player: Player) => {
    const query = (historySearch[player.id] || '').trim().toLowerCase();
    const ownPersonId = identityLinks.find(link => link.rosterPlayerId === player.id)?.personId;
    const manual = query ? playerHistory.filter(candidate => candidate.personId !== ownPersonId &&
      [candidate.name, candidate.lastName || '', ...(candidate.aliases || []).map(alias => `${alias.name} ${alias.lastName || ''}`),
        ...candidate.teams.map(team => `${team.teamName} ${team.season}`)].join(' ').toLowerCase().includes(query)) : [];
    return [...new Map([...candidates(player), ...manual].map(candidate => [candidate.personId, candidate])).values()];
  };

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(saving); }, [saving, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSuccess(''); setSelected(null); setLeague(''); setTeams([]); setLeagues([]);
    storage.getAdminRosterData(season).then(data => {
      if (!active) return;
      setTeams(data.teams); setLeagues(data.leagues);
      setIdentityLinks(data.identityLinks); setPlayerHistory(data.playerHistory); setIdentityChoices({});
      if (data.leagues.length === 1) setLeague(data.leagues[0].id);
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
    if (!canLeave()) return;
    const team = teams.find(t => t.id === id) || null;
    setSelected(team); setPlayers(copy(team?.players || [])); setSubs(copy(team?.subs || [])); setIdentityChoices({}); setError(''); setSuccess('');
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
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || saving) return;
    if ([...players, ...subs].some(player => candidates(player).length && !identityChoices[player.id])) {
      setError('Confirm the previous-season matches shown below before saving.'); return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const expectedLinks = Object.fromEntries([...players, ...subs].map(player => [player.id, identityLinks.find(link => link.rosterPlayerId === player.id)?.personId || null]));
      const saved = await storage.saveAdminRoster(selected, players, subs, identityChoices, expectedLinks);
      setIdentityLinks(saved.identityLinks); setIdentityChoices({});
      setTeams(current => current.map(team => team.id === saved.id ? saved : team));
      setSelected(saved); setPlayers(copy(saved.players)); setSubs(copy(saved.subs || []));
      setSuccess('Roster saved. Recorded games and scores are preserved.');
    } catch (err: any) { setError(err.message || 'The roster was not saved. Try again.'); }
    finally { setSaving(false); }
  };
  const inputClass = 'w-full min-w-0 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white';
  const section = (kind: 'players' | 'subs', list: Player[], title: string) => (
    <section className="space-y-3" aria-label={title}>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title} ({list.length})</h3>
      {list.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{kind === 'players' ? 'Add two or three team players.' : 'No substitutes listed.'}</p>}
      {list.map((player, index) => {
        const existing = [...(selected?.players || []), ...(selected?.subs || [])].some(p => p.id === player.id);
        const label = `${kind === 'players' ? 'Team player' : 'Substitute'} ${index + 1}`;
        const linkedHistory = playerHistory.find(candidate => candidate.personId === identityLinks.find(link => link.rosterPlayerId === player.id)?.personId);
        return (
          <div key={player.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
            {linkedHistory && <p aria-label={`${label} connected history`} className="mb-2 text-sm text-emerald-700 dark:text-emerald-300">
              History connected: {linkedHistory.name} {linkedHistory.lastName} · {linkedHistory.teams.map(team => `${team.teamName} (${team.season})`).join(', ')}
            </p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700 dark:text-slate-200">First name
                <input aria-label={`${label} first name`} className={inputClass} value={player.name} maxLength={80} required disabled={saving}
                  onChange={e => edit(kind, player.id, 'name', e.target.value)} />
              </label>
              <label className="text-sm text-slate-700 dark:text-slate-200">Last name
                <input aria-label={`${label} last name`} className={inputClass} value={player.lastName || ''} maxLength={80} disabled={saving}
                  onChange={e => edit(kind, player.id, 'lastName', e.target.value)} />
              </label>
            </div>
            <label className="mt-3 block text-sm text-slate-600 dark:text-slate-300">Find a previous player
              <input type="search" aria-label={`Find a previous player for ${label}`} className={inputClass}
                placeholder="Search an older name or team" disabled={saving} value={historySearch[player.id] || ''}
                onChange={event => setHistorySearch(current => ({...current, [player.id]:event.target.value}))} />
            </label>
            {shownCandidates(player).length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-slate-900 dark:text-slate-100" aria-label={`Previous-season matches for ${label}`}>
                <p className="font-bold">Has this player played before?</p>
                {shownCandidates(player).map((candidate, candidateIndex) => (
                  <div key={candidate.personId} className="mt-3 border-t border-amber-200 dark:border-amber-800 pt-2">
                    <p className="font-semibold">{candidate.name} {candidate.lastName}</p>
                    <p>{candidate.teams.map(team => `${team.teamName} (${team.season})`).join(', ')}</p>
                    <button type="button" disabled={saving} aria-label={`${label}: match previous player ${candidateIndex + 1}`}
                      aria-pressed={identityChoices[player.id] === candidate.personId}
                      onClick={() => { setIdentityChoices(current => ({...current, [player.id]:candidate.personId})); setError(''); }}
                      className="mt-2 rounded-lg border border-blue-500 px-3 py-2 font-bold text-blue-800 dark:text-blue-200">
                      {identityChoices[player.id] === candidate.personId ? '✓ Same player selected' : 'Yes, same player'}
                    </button>
                  </div>
                ))}
                <button type="button" disabled={saving} aria-pressed={identityChoices[player.id] === 'new'} onClick={() => { setIdentityChoices(current => ({...current, [player.id]:'new'})); setError(''); }}
                  className="mt-3 rounded-lg border border-slate-400 px-3 py-2 font-bold">{identityChoices[player.id] === 'new' ? '✓ Different player selected' : 'No, this is a different player'}</button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={saving || (kind === 'players' ? players.length <= 2 : players.length >= 3)}
                onClick={() => move(kind, player)} className="text-sm font-bold text-blue-700 dark:text-blue-300 disabled:opacity-40">
                {kind === 'players' ? 'Move to substitutes' : 'Make team player'}
              </button>
              {!existing && <button type="button" disabled={saving} className="text-sm font-bold text-rose-700 dark:text-rose-300"
                onClick={() => (kind === 'players' ? setPlayers : setSubs)(current => current.filter(p => p.id !== player.id))}>Remove new player</button>}
            </div>
          </div>
        );
      })}
      <button type="button" disabled={saving || (kind === 'players' ? players.length >= 3 : subs.length >= 50)}
        onClick={() => { (kind === 'players' ? setPlayers : setSubs)(current => [...current, freshPlayer()]); setSuccess(''); }}
        className="rounded-lg border border-blue-300 dark:border-blue-700 px-4 py-2 font-bold text-blue-700 dark:text-blue-300 disabled:opacity-40">
        {kind === 'players' ? 'Add team player' : 'Add substitute'}
      </button>
    </section>
  );

  return (
    <section aria-label="Roster management" className="space-y-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-4 sm:p-6">
      <div><h2 className="text-2xl font-bold text-slate-900 dark:text-white">Rosters</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Manage team players and substitutes for the {season} season. Move existing players between the two lists to keep their game history.</p></div>
      {loading && <p role="status">Loading rosters…</p>}
      {error && <div role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950 p-3 text-rose-800 dark:text-rose-200">{error}
        <button type="button" disabled={saving} className="ml-3 font-bold underline" onClick={() => { if (canLeave()) setReload(value => value + 1); }}>Reload rosters</button>
      </div>}
      {success && <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950 p-3 text-emerald-800 dark:text-emerald-200">{success}</p>}
      {!loading && leagues.length === 0 && !error && <p>Create a league or import its schedule first.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">League
          <select aria-label="League" className={inputClass} value={league} disabled={loading || saving} onChange={e => { if (!canLeave()) return; setLeague(e.target.value); setSelected(null); setSuccess(''); setError(''); }}>
            <option value="">Choose a league</option>{leagues.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Team
          <select aria-label="Team" className={inputClass} value={selected?.id || ''} disabled={!league || loading || saving} onChange={e => selectTeam(e.target.value)}>
            <option value="">Choose a team</option>{teams.filter(t => storage.leaguesMatch(t.league, league)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
      {league && !loading && !teams.some(t => storage.leaguesMatch(t.league, league)) && <p>No teams in this league yet. Import its schedule or add teams from its league page.</p>}
      {selected && <form onSubmit={save} className="space-y-6">
        {section('players', players, 'Team players')}
        {section('subs', subs, 'Substitutes')}
        <div className="flex flex-wrap gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
          <button type="submit" disabled={saving || !dirty || players.length < 2} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-40">{saving ? 'Saving roster…' : 'Save roster'}</button>
          <button type="button" disabled={saving || !dirty} onClick={() => { if (!canLeave()) return; setPlayers(copy(selected.players)); setSubs(copy(selected.subs || [])); setIdentityChoices({}); setError(''); setSuccess(''); }}
            className="rounded-xl border border-slate-300 dark:border-slate-600 px-5 py-3 font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40">Discard changes</button>
        </div>
      </form>}
    </section>
  );
};
