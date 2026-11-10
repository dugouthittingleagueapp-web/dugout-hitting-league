import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Team, Match } from '../types';
import * as storage from '../services/storageService';

interface PracticeSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLeague: string;
  season: string;
  teams: Team[];
  onStartPractice: (match: Match) => Promise<void>;
}

export const PracticeSetupModal: React.FC<PracticeSetupModalProps> = ({
  isOpen,
  onClose,
  currentLeague,
  season,
  teams,
  onStartPractice
}) => {
  const [selectedAwayId, setSelectedAwayId] = useState('');
  const [selectedHomeId, setSelectedHomeId] = useState('');
  const [rosterFormat, setRosterFormat] = useState<'3v3' | '3v2' | '2v2'>('3v3');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronize dropdown selections whenever modal opens or teams change
  // Ensures Home and Away default to two distinct teams
  useEffect(() => {
    if (isOpen && teams.length > 0) {
      const awayId = teams[0]?.id || '';
      const homeId = teams.length > 1 ? teams[1]?.id : teams[0]?.id || '';
      setSelectedAwayId(awayId);
      setSelectedHomeId(homeId);
      setError(null);
    }
  }, [isOpen, teams]);

  if (!isOpen) return null;

  const handleAwayChange = (newAwayId: string) => {
    setSelectedAwayId(newAwayId);
    setError(null);
    // If the user selects the team that is currently Home, automatically shift Home to another team
    if (newAwayId === selectedHomeId) {
      const altHome = teams.find(t => t.id !== newAwayId);
      if (altHome) {
        setSelectedHomeId(altHome.id);
      }
    }
  };

  const handleHomeChange = (newHomeId: string) => {
    setSelectedHomeId(newHomeId);
    setError(null);
    // If the user selects the team that is currently Away, automatically shift Away to another team
    if (newHomeId === selectedAwayId) {
      const altAway = teams.find(t => t.id !== newHomeId);
      if (altAway) {
        setSelectedAwayId(altAway.id);
      }
    }
  };

  const handleSwapTeams = () => {
    const temp = selectedAwayId;
    setSelectedAwayId(selectedHomeId);
    setSelectedHomeId(temp);
    setError(null);
  };

  const handleLaunch = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (teams.length < 2) {
        setError(`Please add another team to this league before starting a practice game.`);
        setIsSubmitting(false);
        return;
      }

      if (!selectedAwayId || !selectedHomeId) {
        setError('Please select both Home and Away teams.');
        setIsSubmitting(false);
        return;
      }

      if (selectedAwayId === selectedHomeId) {
        setError('Home and Away teams must be different.');
        setIsSubmitting(false);
        return;
      }

      const foundHome = teams.find(t => t.id === selectedHomeId);
      const foundAway = teams.find(t => t.id === selectedAwayId);
      if (!foundHome || !foundAway) {
        setError('We couldn't find one of those teams. Please pick teams from the list.');
        setIsSubmitting(false);
        return;
      }

      const homePlayerIds = (foundHome.players || []).slice(0, rosterFormat === '2v2' ? 2 : 3).map(p => p.id);
      const awayPlayerIds = (foundAway.players || []).slice(0, rosterFormat === '3v2' || rosterFormat === '2v2' ? 2 : 3).map(p => p.id);

      const practiceMatch = await storage.createPracticeMatch({
        league: currentLeague,
        homeTeamId: foundHome.id,
        awayTeamId: foundAway.id,
        homePlayerIds,
        awayPlayerIds,
        season,
        notes: `PRACTICE MATCH (${foundAway.name} vs ${foundHome.name})`
      });

      await onStartPractice(practiceMatch);
      onClose();
    } catch (err: any) {
      console.error('Failed to launch practice match:', err);
      setError('The practice game could not start yet. Please try again or ask for help.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div 
      className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200 font-sans"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-amber-500/10 dark:bg-amber-500/5 flex justify-between items-start">
          <div className="flex items-start gap-2.5">
            <span className="text-2xl sm:text-3xl p-1 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl">🧪</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Practice Match Setup
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full">
                  Practice Mode
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Full-featured match simulation for training umpires. Auto-deletes upon exit.
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Informational Callout */}
        <div className="bg-amber-500/15 border-b border-amber-500/20 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
          <span className="font-bold shrink-0">🛡️ Auto-Cleanup:</span>
          <span>Practice matches behave identically to real games, but are automatically deleted on exit so league records stay 100% clean.</span>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-xs font-bold">
              {error}
            </div>
          )}

          {/* Team Selection Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Step 1: Select League Teams ({currentLeague})
              </label>
              <span className="text-[11px] font-bold text-slate-400">
                {teams.length} teams available
              </span>
            </div>

            {teams.length < 2 ? (
              <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-center text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <div className="text-lg">⚠️</div>
                <div className="font-bold">Fewer than 2 teams in the {currentLeague} league.</div>
                <div className="text-slate-500 dark:text-slate-400">
                  Please add or import teams to this league first so you can simulate matches with real rosters.
                </div>
              </div>
            ) : (
              <div className="space-y-3 bg-slate-50 dark:bg-slate-950 p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                <div>
                  <label className="text-[11px] font-bold text-blue-600 dark:text-blue-400 block mb-1">
                    Away Team (Bats 1st)
                  </label>
                  <select
                    value={selectedAwayId}
                    onChange={e => handleAwayChange(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={handleSwapTeams}
                    className="px-3 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                  >
                    <span>⇅</span>
                    <span>Swap Home / Away</span>
                  </button>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-red-600 dark:text-red-400 block mb-1">
                    Home Team (Field 1st)
                  </label>
                  <select
                    value={selectedHomeId}
                    onChange={e => handleHomeChange(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
                  >
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Roster Size / Format Preset */}
          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
              Step 2: Simulation Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRosterFormat('3v3')}
                className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                  rosterFormat === '3v3'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs font-bold">3v3</div>
                <div className="text-[10px] opacity-75">Standard (10 pitches)</div>
              </button>

              <button
                type="button"
                onClick={() => setRosterFormat('3v2')}
                className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                  rosterFormat === '3v2'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs font-bold">3v2</div>
                <div className="text-[10px] opacity-75">Ghost Player (15p)</div>
              </button>

              <button
                type="button"
                onClick={() => setRosterFormat('2v2')}
                className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                  rosterFormat === '2v2'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs font-bold">2v2</div>
                <div className="text-[10px] opacity-75">2-Batter match</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={isSubmitting || teams.length < 2 || !selectedAwayId || !selectedHomeId || selectedAwayId === selectedHomeId}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer active:scale-95"
          >
            <span>{isSubmitting ? 'Starting...' : 'Launch Practice Game'}</span>
            <span>⚾</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
