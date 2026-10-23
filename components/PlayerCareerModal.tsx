import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlayerCareerSummary } from '../types';
import { getPlayerCareerStats } from '../services/storageService';

interface PlayerCareerModalProps {
  isOpen: boolean;
  playerName: string | null;
  onClose: () => void;
}

export const PlayerCareerModal: React.FC<PlayerCareerModalProps> = ({
  isOpen,
  playerName,
  onClose,
}) => {
  const [careerData, setCareerData] = useState<PlayerCareerSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !playerName) {
      setCareerData(null);
      return;
    }

    let isCancelled = false;
    setLoading(true);

    getPlayerCareerStats(playerName)
      .then((data) => {
        if (!isCancelled) {
          setCareerData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load career stats:', err);
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, playerName]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !playerName) return null;

  const displayName = careerData?.playerName || playerName;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-career-title"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/90 flex justify-between items-start gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 font-sans">
                Player Profile & Career Batting
              </span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400">
                Dugout Hitting League
              </span>
            </div>
            <h2
              id="player-career-title"
              className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight"
            >
              {displayName}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close career stats modal"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content body */}
        <div className="overflow-y-auto flex-1 p-4 sm:p-6 space-y-6">
          {loading && (
            <div className="py-16 text-center text-slate-500 space-y-3">
              <div className="inline-block w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-semibold">Compiling career batting statistics across seasons...</p>
            </div>
          )}

          {!loading && careerData && (
            <>
              {/* Career Highlights KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Career Points</div>
                  <div className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                    {careerData.careerTotals.totalPoints}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {careerData.careerTotals.seasonsCount} {careerData.careerTotals.seasonsCount === 1 ? 'season' : 'seasons'}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Games Played</div>
                  <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                    {careerData.careerTotals.gamesPlayed}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    ~{careerData.seasonAverages.gamesPlayed} / yr
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Pitches Faced</div>
                  <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                    {careerData.careerTotals.pitchesSeen}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Total pitches</div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Points / Pitch</div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {careerData.careerTotals.pointsPerPitch.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Efficiency</div>
                </div>

                <div className="col-span-2 sm:col-span-1 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Hit %</div>
                  <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums">
                    {careerData.careerTotals.hitPercentage.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {careerData.careerTotals.hits4 + careerData.careerTotals.hits3 + careerData.careerTotals.hits2 + careerData.careerTotals.hits1} scoring hits
                  </div>
                </div>
              </div>

              {/* Career Table (Baseball Reference Style) */}
              <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Year-by-Year Batting Record
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    Official Dugout Stats
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse min-w-[720px]">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-bold border-b border-slate-200 dark:border-slate-800">
                        <th className="py-2.5 px-3 sticky left-0 bg-slate-50 dark:bg-slate-900/90 z-10">Season</th>
                        <th className="py-2.5 px-3">Div</th>
                        <th className="py-2.5 px-3">Team</th>
                        <th className="py-2.5 px-3 text-right">GP</th>
                        <th className="py-2.5 px-3 text-right font-black text-slate-900 dark:text-white">PTS</th>
                        <th className="py-2.5 px-3 text-right text-rose-600 dark:text-rose-400 font-bold">4s</th>
                        <th className="py-2.5 px-3 text-right text-amber-600 dark:text-amber-400 font-bold">3s</th>
                        <th className="py-2.5 px-3 text-right text-green-600 dark:text-green-400 font-bold">2s</th>
                        <th className="py-2.5 px-3 text-right text-cyan-600 dark:text-cyan-400 font-bold">1s</th>
                        <th className="py-2.5 px-3 text-right text-slate-500">PIT</th>
                        <th className="py-2.5 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">Pts/Pit</th>
                        <th className="py-2.5 px-3 text-right font-semibold text-amber-600 dark:text-amber-400">Hit %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-850 text-slate-700 dark:text-slate-300 text-xs sm:text-sm">
                      {careerData.seasons.map((row, idx) => (
                        <tr
                          key={`${row.season}-${row.leagueId}-${row.teamName}-${idx}`}
                          className="hover:bg-blue-50/40 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white sticky left-0 bg-white dark:bg-slate-950 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                            {row.season}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-medium">
                            {row.leagueId}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-blue-700 dark:text-blue-400">
                            {row.teamName}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                            {row.gamesPlayed}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-black text-slate-900 dark:text-white text-sm sm:text-base">
                            {row.totalPoints}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400 font-semibold">
                            {row.hits4}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                            {row.hits3}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-green-600 dark:text-green-400 font-semibold">
                            {row.hits2}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-cyan-600 dark:text-cyan-400 font-semibold">
                            {row.hits1}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-500">
                            {row.pitchesSeen}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            {row.pointsPerPitch.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                            {row.hitPercentage.toFixed(1)}%
                          </td>
                        </tr>
                      ))}

                      {careerData.seasons.length === 0 && (
                        <tr>
                          <td colSpan={12} className="py-8 text-center text-slate-400 italic">
                            No completed season matches recorded for {displayName} yet.
                          </td>
                        </tr>
                      )}
                    </tbody>

                    {careerData.seasons.length > 0 && (
                      <tfoot className="border-t-2 border-slate-300 dark:border-slate-700 font-bold text-xs sm:text-sm">
                        {/* Career Totals Row */}
                        <tr className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white">
                          <td className="py-3 px-3 font-black uppercase tracking-wider sticky left-0 bg-slate-100 dark:bg-slate-900 z-10">
                            Career ({careerData.careerTotals.seasonsCount} {careerData.careerTotals.seasonsCount === 1 ? 'yr' : 'yrs'})
                          </td>
                          <td className="py-3 px-3 text-slate-400">—</td>
                          <td className="py-3 px-3 text-slate-400">—</td>
                          <td className="py-3 px-3 text-right tabular-nums font-black">
                            {careerData.careerTotals.gamesPlayed}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-black text-sm sm:text-base text-blue-600 dark:text-blue-400">
                            {careerData.careerTotals.totalPoints}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                            {careerData.careerTotals.hits4}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                            {careerData.careerTotals.hits3}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-green-600 dark:text-green-400">
                            {careerData.careerTotals.hits2}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-cyan-600 dark:text-cyan-400">
                            {careerData.careerTotals.hits1}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                            {careerData.careerTotals.pitchesSeen}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-black text-emerald-600 dark:text-emerald-400">
                            {careerData.careerTotals.pointsPerPitch.toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-black text-amber-600 dark:text-amber-400">
                            {careerData.careerTotals.hitPercentage.toFixed(1)}%
                          </td>
                        </tr>

                        {/* Season Averages Row */}
                        <tr className="bg-slate-50/80 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800">
                          <td className="py-2.5 px-3 font-semibold uppercase tracking-wider sticky left-0 bg-slate-50 dark:bg-slate-950 z-10 text-[11px]">
                            Season Avg
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">—</td>
                          <td className="py-2.5 px-3 text-slate-400">—</td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                            {careerData.seasonAverages.gamesPlayed}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                            {careerData.seasonAverages.totalPoints}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                            {careerData.seasonAverages.hits4}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                            {careerData.seasonAverages.hits3}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                            {careerData.seasonAverages.hits2}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                            {careerData.seasonAverages.hits1}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                            {careerData.seasonAverages.pitchesSeen}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            {careerData.careerTotals.pointsPerPitch.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                            {careerData.careerTotals.hitPercentage.toFixed(1)}%
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center">
          <span className="text-xs text-slate-400">
            Click any player across the app to view their career batting history.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
