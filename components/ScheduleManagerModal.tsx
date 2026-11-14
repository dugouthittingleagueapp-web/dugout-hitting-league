import React, { useEffect, useMemo, useState } from 'react';
import * as storage from '../services/storageService';
import { League, Team, ScheduledGameRecord } from '../types';
import { combineDateAndTime, isValidScheduleDate, isValidScheduleTime } from '../utils/scheduleImporter';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
  season: string;
  leagues: League[];
};

const dateOnly = (date: string) => String(date || '').slice(0, 10);

export const ScheduleManagerModal: React.FC<Props> = ({ isOpen, onClose, onChanged, season, leagues }) => {
  const [selectedLeague, setSelectedLeague] = useState('');
  const [games, setGames] = useState<storage.AdminScheduledGame[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('6:00 pm');
  const [endTime, setEndTime] = useState('7:00 pm');
  const [location, setLocation] = useState('The Dugout');
  const [homeId, setHomeId] = useState('');
  const [awayId, setAwayId] = useState('');

  const activeLeagues = useMemo(() => leagues.filter(l => !l.season || l.season === season), [leagues, season]);
  const currentTeams = useMemo(
    () => teams.filter(t => selectedLeague && storage.leaguesMatch(t.league, selectedLeague) && t.season === season),
    [teams, selectedLeague, season]
  );

  useEffect(() => {
    if (!isOpen) return;
    setSelectedLeague('');
    setHomeId('');
    setAwayId('');
    setProblem('');
    setMessage('');
    setGames([]);
    setTeams([]);
  }, [isOpen, season]);

  const load = async () => {
    setIsLoading(true);
    setProblem('');
    try {
      // Only the authenticated server endpoint is authoritative for deletions/duplicates.
      const [scheduled, roster] = await Promise.all([
        storage.getScheduledGamesForAdmin(season, selectedLeague || undefined),
        storage.getTeams(null, season),
      ]);
      setGames(scheduled);
      setTeams(roster);
    } catch (error: any) {
      setProblem(error.message || 'Could not load the schedule.');
      setGames([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, season, selectedLeague]);

  const chooseLeague = (league: string) => {
    setSelectedLeague(league);
    setHomeId('');
    setAwayId('');
    setMessage('');
  };

  const create = async () => {
    const home = currentTeams.find(t => t.id === homeId);
    const away = currentTeams.find(t => t.id === awayId);
    if (!selectedLeague || !home || !away || home.id === away.id) {
      setProblem('Select a division and two different existing teams.');
      return;
    }
    if (!isValidScheduleDate(date) || !isValidScheduleTime(startTime) || !isValidScheduleTime(endTime)) {
      setProblem('Enter a valid date and start/end times before scheduling.');
      return;
    }
    const game: ScheduledGameRecord = {
      date,
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      scheduledIsoDate: combineDateAndTime(date, startTime.trim()),
      location: location.trim() || 'The Dugout',
      group: selectedLeague,
      homeTeamName: home.name,
      awayTeamName: away.name,
      homeTeamId: home.id,
      awayTeamId: away.id,
      season,
    };
    setSaving(true);
    setProblem('');
    setMessage('');
    try {
      const result = await storage.createSingleScheduledGame(game);
      if (result.skippedDuplicates) {
        setMessage('That matchup already exists on this date. No duplicate was added.');
      } else {
        setMessage('Game added to ' + selectedLeague + '. All other games were kept.');
      }
      await load();
      onChanged();
    } catch (error: any) {
      setProblem(error.message || 'Could not create the game.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (game: storage.AdminScheduledGame) => {
    if (!game.potentially_editable) return;
    const description = [game.home_name, 'vs', game.away_name, 'on', dateOnly(game.date)].join(' ');
    if (!window.confirm('Delete only this UNSTARTED scheduled game?\n\n' + description +
      '\n\nOther games and team rosters will not be deleted. This cannot be undone.')) return;
    setSaving(true);
    setProblem('');
    setMessage('');
    try {
      await storage.deleteSingleScheduledGame(game.id);
      setMessage('Removed only ' + description + '. You can schedule its replacement below.');
      await load();
      onChanged();
    } catch (error: any) {
      setProblem(error.message || 'The game could not be deleted.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Manage scheduled games"
      className="fixed inset-0 z-[9999] bg-slate-950/80 p-3 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xl text-slate-900 dark:text-white space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-xl">Manage Individual Games</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">Delete one unstarted game or schedule a replacement. The rest of the season stays intact.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 border rounded-lg">Close</button>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/40 rounded-xl p-4 border border-blue-200 dark:border-blue-800 space-y-2">
          <div className="text-sm font-bold">Schedule destination: {season} season</div>
          <label className="block text-sm font-semibold" htmlFor="manage-schedule-league">Choose division</label>
          <select id="manage-schedule-league" value={selectedLeague} onChange={e => chooseLeague(e.target.value)}
            className="w-full rounded-lg border p-3 bg-white text-slate-900 dark:bg-slate-800 dark:text-white">
            <option value="">All divisions (view schedule only)</option>
            {activeLeagues.map(l => <option key={l.id + l.season} value={l.id}>{l.id}</option>)}
          </select>
          <p className="text-xs">Select a division to add a game. The selected division is used for the new game.</p>
        </div>
        {problem && <p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3 text-sm">{problem}</p>}
        {message && <p role="status" className="rounded-lg bg-green-50 text-green-900 p-3 text-sm">{message}</p>}

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold">Existing games ({games.length})</h3>
            <button type="button" onClick={() => void load()} disabled={isLoading || saving}
              className="text-sm border px-3 py-1.5 rounded-lg">Refresh</button>
          </div>
          {isLoading ? <p className="text-sm">Loading the latest schedule…</p> : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {games.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No games found for this selection.</p>}
              {games.map(game => (
                <div key={game.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-sm">
                    <div className="font-semibold">{game.home_name || 'Unknown'} vs {game.away_name || 'Unknown'}</div>
                    <div className="text-slate-600 dark:text-slate-300">{dateOnly(game.date)} · {game.start_time || 'Time TBD'} · {game.league} · {game.location || 'No location'}</div>
                  </div>
                  {game.potentially_editable ? (
                    <button type="button" disabled={saving || isLoading} onClick={() => void remove(game)}
                      className="shrink-0 px-3 py-2 border border-red-300 text-red-700 dark:text-red-300 rounded-lg text-sm font-semibold">
                      Delete this game
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">Started, completed, or protected — cannot delete</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <h3 className="font-bold">Schedule one new game</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Destination: <strong>{selectedLeague || 'Choose a division above'}</strong> · {season}. Existing games are not replaced.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm font-semibold">Home team
              <select value={homeId} onChange={e => setHomeId(e.target.value)}
                className="block w-full mt-1 rounded-lg border p-2.5 bg-white text-slate-900 dark:bg-slate-800 dark:text-white">
                <option value="">Choose home team</option>
                {currentTeams.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">Away team
              <select value={awayId} onChange={e => setAwayId(e.target.value)}
                className="block w-full mt-1 rounded-lg border p-2.5 bg-white text-slate-900 dark:bg-slate-800 dark:text-white">
                <option value="">Choose away team</option>
                {currentTeams.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">Game date
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="block w-full mt-1 rounded-lg border p-2.5 bg-white text-slate-900 dark:bg-slate-800 dark:text-white"/>
            </label>
            <label className="text-sm font-semibold">Location / tunnel
              <input value={location} onChange={e => setLocation(e.target.value)} maxLength={250}
                className="block w-full mt-1 rounded-lg border p-2.5 bg-white text-slate-900 dark:bg-slate-800 dark:text-white"/>
            </label>
            <label className="text-sm font-semibold">Start time (e.g., 6:00 pm)
              <input value={startTime} onChange={e => setStartTime(e.target.value)}
                className="block w-full mt-1 rounded-lg border p-2.5 bg-white text-slate-900 dark:bg-slate-800 dark:text-white"/>
            </label>
            <label className="text-sm font-semibold">End time (e.g., 7:00 pm)
              <input value={endTime} onChange={e => setEndTime(e.target.value)}
                className="block w-full mt-1 rounded-lg border p-2.5 bg-white text-slate-900 dark:bg-slate-800 dark:text-white"/>
            </label>
          </div>
          <button type="button" onClick={() => void create()}
            disabled={saving || isLoading || !selectedLeague || !homeId || !awayId || homeId === awayId}
            className="w-full px-4 py-3 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-40">
            {saving ? 'Saving…' : 'Add game to ' + (selectedLeague || 'selected division')}
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400">Only administrators can change the schedule. Scored, started, finalized, or locked games cannot be deleted.</p>
        </section>
      </div>
    </div>
  );
};
