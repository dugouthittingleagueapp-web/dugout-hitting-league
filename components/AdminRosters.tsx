import React, { useEffect, useState } from 'react';
import type { League, Player, Team } from '../types';
import * as storage from '../services/storageService';

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
  const dirty = !!selected && JSON.stringify({ players, subs }) !== JSON.stringify({ players: selected.players, subs: selected.subs || [] });

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(saving); }, [saving, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSuccess(''); setSelected(null); setLeague(''); setTeams([]); setLeagues([]);
    storage.getAdminRosterData(season).then(data => {
      if (!active) return;
      setTeams(data.teams); setLeagues(data.leagues);
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
    setSelected(team); setPlayers(copy(team?.players || [])); setSubs(copy(team?.subs || [])); setError(''); setSuccess('');
  };
  const edit = (kind: 'players' | 'subs', id: string, field: 'name' | 'lastName', value: string) => {
    const update = (list: Player[]) => list.map(p => p.id === id ? { ...p, [field]: value } : p);
    (kind === 'players' ? setPlayers : setSubs)(update); setSuccess('');
  };
  const move = (kind: 'players' | 'subs', player: Player) => {
    if (kind === 'players') { setPlayers(players.filter(p => p.id !== player.id)); setSubs([...subs, player]); }
    else { setSubs(subs.filter(p => p.id !== player.id)); setPlayers([...players, player]); }
    setSuccess('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const saved = await storage.saveAdminRoster(selected, players, subs);
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
        return (
          <div key={player.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
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
          <button type="button" disabled={saving || !dirty} onClick={() => { if (!canLeave()) return; setPlayers(copy(selected.players)); setSubs(copy(selected.subs || [])); setError(''); setSuccess(''); }}
            className="rounded-xl border border-slate-300 dark:border-slate-600 px-5 py-3 font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40">Discard changes</button>
        </div>
      </form>}
    </section>
  );
};
