import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Team, Match } from '../types';
import * as storage from '../services/storageService';

interface PracticeSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLeague: string;
  season: string;
  teams: Team[];
  onStartPractice: (match: Match, practiceTeams?: Team[]) => Promise<void>;
}

export const PracticeSetupModal: React.FC<PracticeSetupModalProps> = ({
  isOpen,
  onClose,
  currentLeague,
  season,
  teams,
  onStartPractice
}) => {
  const [teamSource, setTeamSource] = useState<'dummy' | 'real'>('dummy');
  const [dummyAwayName, setDummyAwayName] = useState('Practice Team B');
  const [dummyHomeName, setDummyHomeName] = useState('Practice Team A');
  const [selectedAwayId, setSelectedAwayId] = useState(teams[0]?.id || '');
  const [selectedHomeId, setSelectedHomeId] = useState(teams[1]?.id || teams[0]?.id || '');
  const [rosterFormat, setRosterFormat] = useState<'3v3' | '3v2' | '2v2'>('3v3');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSwapRealTeams = () => {
    const temp = selectedAwayId;
    setSelectedAwayId(selectedHomeId);
    setSelectedHomeId(temp);
  };

  const handleLaunch = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      let homeTeam: Team;
      let awayTeam: Team;
      let createdTeamsToRegister: Team[] | undefined = undefined;

      if (teamSource === 'dummy') {
        const homeId = `practice-home-${storage.generateUUID().substring(0, 6)}`;
        const awayId = `practice-away-${storage.generateUUID().substring(0, 6)}`;

        const awayBattersCount = rosterFormat === '3v2' ? 2 : (rosterFormat === '2v2' ? 2 : 3);
        const homeBattersCount = rosterFormat === '2v2' ? 2 : 3;

        homeTeam = {
          id: homeId,
          name: dummyHomeName.trim() || 'Practice Team A',
          league: currentLeague,
          season,
          players: Array.from({ length: homeBattersCount }, (_, i) => ({
            id: `p-home-${i + 1}-${storage.generateUUID().substring(0, 4)}`,
            name: `Home Batter ${i + 1}`
          })),
          subs: []
        };

        awayTeam = {
          id: awayId,
          name: dummyAwayName.trim() || 'Practice Team B',
          league: currentLeague,
          season,
          players: Array.from({ length: awayBattersCount }, (_, i) => ({
            id: `p-away-${i + 1}-${storage.generateUUID().substring(0, 4)}`,
            name: `Away Batter ${i + 1}`
          })),
          subs: []
        };

        // Save dummy teams locally/in database so Scoreboard can resolve team info
        await Promise.all([
          storage.saveTeam(homeTeam).catch(() => homeTeam),
          storage.saveTeam(awayTeam).catch(() => awayTeam)
        ]);

        createdTeamsToRegister = [homeTeam, awayTeam];
      } else {
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
          setError('Selected teams could not be found.');
          setIsSubmitting(false);
          return;
        }

        homeTeam = foundHome;
        awayTeam = foundAway;
      }

      const homePlayerIds = (homeTeam.players || []).slice(0, 3).map(p => p.id);
      const awayPlayerIds = (awayTeam.players || []).slice(0, rosterFormat === '3v2' ? 2 : 3).map(p => p.id);

      const practiceMatch = await storage.createPracticeMatch({
        league: currentLeague,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homePlayerIds,
        awayPlayerIds,
        season,
        notes: `PRACTICE MATCH (${teamSource === 'dummy' ? 'Dummy Sandbox Teams' : 'League Teams'})`
      });

      await onStartPractice(practiceMatch, createdTeamsToRegister);
      onClose();
    } catch (err: any) {
      console.error('Failed to launch practice match:', err);
      setError(err.message || 'Failed to initialize practice match');
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
                  Practice / Sandbox Mode
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full">
                  Sandbox
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Train on umpire scoring and lineup controls without affecting official standings.
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* Informational Callout */}
        <div className="bg-amber-500/15 border-b border-amber-500/20 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
          <span className="font-bold shrink-0">🛡️ Data Isolation:</span>
          <span>Hits, pitches, and scores will <strong>never</strong> be added to standings, leaderboards, or public fan views.</span>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-xs font-bold">
              {error}
            </div>
          )}

          {/* Team Source Choice */}
          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
              Step 1: Choose Practice Teams
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTeamSource('dummy')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  teamSource === 'dummy'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 shadow-sm ring-2 ring-amber-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-900'
                }`}
              >
                <div className="font-bold text-xs sm:text-sm flex items-center gap-1.5">
                  <span>🤖</span>
                  <span>Dummy Teams</span>
                </div>
                <div className="text-[11px] opacity-75 mt-0.5">
                  Auto-generates Team A vs. Team B with ready-to-score batters
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTeamSource('real')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  teamSource === 'real'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 shadow-sm ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-900'
                }`}
              >
                <div className="font-bold text-xs sm:text-sm flex items-center gap-1.5">
                  <span>⚾</span>
                  <span>League Teams</span>
                </div>
                <div className="text-[11px] opacity-75 mt-0.5">
                  Select real rosters from {currentLeague} without altering their records
                </div>
              </button>
            </div>
          </div>

          {/* Dummy Teams Options */}
          {teamSource === 'dummy' ? (
            <div className="space-y-3 bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <label className="text-[11px] font-bold text-blue-600 dark:text-blue-400 block mb-1">
                  Away Team (Bats 1st)
                </label>
                <input
                  type="text"
                  value={dummyAwayName}
                  onChange={e => setDummyAwayName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm text-slate-900 dark:text-white"
                  placeholder="e.g. Practice Team B"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-red-600 dark:text-red-400 block mb-1">
                  Home Team (Field 1st)
                </label>
                <input
                  type="text"
                  value={dummyHomeName}
                  onChange={e => setDummyHomeName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm text-slate-900 dark:text-white"
                  placeholder="e.g. Practice Team A"
                />
              </div>
            </div>
          ) : (
            /* Real League Teams Options */
            <div className="space-y-3 bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
              {teams.length < 2 ? (
                <div className="text-center py-2 text-xs text-amber-600 dark:text-amber-400 font-semibold">
                  ⚠️ Fewer than 2 teams in this league. Select &ldquo;Dummy Teams&rdquo; to test immediately.
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[11px] font-bold text-blue-600 dark:text-blue-400 block mb-1">
                      Away Team (Bats 1st)
                    </label>
                    <select
                      value={selectedAwayId}
                      onChange={e => setSelectedAwayId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm text-slate-900 dark:text-white"
                    >
                      {teams.map(t => (
                        <option key={t.id} value={t.id} disabled={t.id === selectedHomeId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleSwapRealTeams}
                      className="px-2.5 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition-colors flex items-center gap-1 shadow-xs"
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
                      onChange={e => setSelectedHomeId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm text-slate-900 dark:text-white"
                    >
                      {teams.map(t => (
                        <option key={t.id} value={t.id} disabled={t.id === selectedAwayId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Roster Size / Format Preset */}
          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
              Step 2: Simulation Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRosterFormat('3v3')}
                className={`py-2 px-2.5 rounded-lg border text-center transition-all ${
                  rosterFormat === '3v3'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-medium'
                }`}
              >
                <div className="text-xs font-bold">3v3</div>
                <div className="text-[10px] opacity-75">Standard (10 pitches)</div>
              </button>

              <button
                type="button"
                onClick={() => setRosterFormat('3v2')}
                className={`py-2 px-2.5 rounded-lg border text-center transition-all ${
                  rosterFormat === '3v2'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-medium'
                }`}
              >
                <div className="text-xs font-bold">3v2</div>
                <div className="text-[10px] opacity-75">Ghost Player (15p)</div>
              </button>

              <button
                type="button"
                onClick={() => setRosterFormat('2v2')}
                className={`py-2 px-2.5 rounded-lg border text-center transition-all ${
                  rosterFormat === '2v2'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-medium'
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
            className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={isSubmitting || (teamSource === 'real' && teams.length < 2)}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
