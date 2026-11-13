
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as storage from '../services/storageService';
import { Team, League } from '../types';
import { UserGuide } from './UserGuide';
import { ScheduleImportModal } from './ScheduleImportModal';

export const AdminDashboard: React.FC<{ 
  onBack: () => void; 
  onBrowseArchive?: (season: string) => void;
  onSeasonUpdated?: () => void;
  onStartPractice?: () => void;
}> = ({ onBack, onBrowseArchive, onSeasonUpdated, onStartPractice }) => {
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(false);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [creatingLeague, setCreatingLeague] = useState(false);
  const [showScheduleImportModal, setShowScheduleImportModal] = useState(false);
  
  // Settings State
  const [currentSeason, setCurrentSeason] = useState<string>(() => {
    try {
      return localStorage.getItem('dugout_current_season') || String(new Date().getFullYear());
    } catch {
      return String(new Date().getFullYear());
    }
  });
  const [selectedSeason, setSelectedSeason] = useState<string>(() => {
    try {
      return localStorage.getItem('dugout_current_season') || String(new Date().getFullYear());
    } catch {
      return String(new Date().getFullYear());
    }
  });
  const [allSeasons, setAllSeasons] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem('dugout_available_seasons');
      if (s) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set([...parsed, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        }
      }
    } catch {}
    return ['2026', '2025'];
  });
  const [newSeasonInput, setNewSeasonInput] = useState('');
  
  // Password State
  const [newAdminPw, setNewAdminPw] = useState('');
  const [newUmpirePw, setNewUmpirePw] = useState('');

  // Team Moving State
  const [leagues, setLeagues] = useState<League[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [targetLeagueForMove, setTargetLeagueForMove] = useState('');
  const [movingTeams, setMovingTeams] = useState(false);

  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => { 
        setLoading(true);
        try {
            const season = await storage.getCurrentSeason();
            const fetchedSeasons = await storage.getAvailableSeasons();
            const seasons = Array.from(new Set([...fetchedSeasons, season, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            if (isMounted) {
                setCurrentSeason(season);
                setSelectedSeason(season);
                setAllSeasons(seasons);
            }
            const [d, ls, ts] = await Promise.all([
                storage.exportData().catch(() => '{}'),
                storage.getLeagues(season).catch(() => []),
                storage.getTeams(null, season).catch(() => [])
            ]);
            if (isMounted) {
                setData(d); 
                setLeagues(ls);
                setAllTeams(ts);
            }
        } catch (e) {
            console.error("Error loading admin dashboard data", e);
        } finally {
            if (isMounted) setLoading(false);
        }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const handleSwitchViewSeason = async (seasonToView: string) => {
    setSelectedSeason(seasonToView);
    setLoading(true);
    try {
        const [ls, ts] = await Promise.all([
            storage.getLeagues(seasonToView).catch(() => []),
            storage.getTeams(null, seasonToView).catch(() => [])
        ]);
        setLeagues(ls);
        setAllTeams(ts);
    } catch (e) {
        console.error("Error switching viewed season", e);
    } finally {
        setLoading(false);
    }
  };

  const handleMakeActiveSeason = async (targetSeason: string) => {
    if (confirm(`Set ${targetSeason} as the live active season for all umpires and spectators?`)) {
        setLoading(true);
        try {
            await storage.updateCurrentSeason(targetSeason);
            setCurrentSeason(targetSeason);
            setSelectedSeason(targetSeason);
            const [newLeagues, fetchedSeasons] = await Promise.all([
                storage.getLeagues(targetSeason),
                storage.getAvailableSeasons()
            ]);
            const seasons = Array.from(new Set([...fetchedSeasons, targetSeason, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            setLeagues(newLeagues);
            setAllSeasons(seasons);
            if (onSeasonUpdated) onSeasonUpdated();
            alert(`Season ${targetSeason} is now active.`);
        } catch (e: any) {
            alert('Failed to set active season: ' + (e?.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }
  };

  const handleExport = () => {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dugout_hitting_league_data.json`;
    a.click();
  };

  const handleCreateLeague = async () => {
    if (!newLeagueName.trim()) return;
    setCreatingLeague(true);
    try {
      await storage.createLeague(newLeagueName.trim(), selectedSeason);
      const newLeagues = await storage.getLeagues(selectedSeason);
      setLeagues(newLeagues);
      alert(`League created for ${selectedSeason}!`);
      setNewLeagueName('');
    } catch (e: any) {
      alert('Failed to create league: ' + (e.message || 'Unknown error'));
    } finally {
      setCreatingLeague(false);
    }
  };

  const handleDeleteLeague = async (leagueId: string) => {
    if (confirm(`Are you sure you want to delete the "${leagueId}" league in ${selectedSeason}? WARNING: All teams and matches associated with this league will be permanently deleted.`)) {
        setLoading(true);
        try {
            await storage.deleteLeague(leagueId, selectedSeason);
            // Refresh
            const newLeagues = await storage.getLeagues(selectedSeason);
            setLeagues(newLeagues);
            alert('League deleted.');
        } catch (e) {
            alert('Failed to delete league.');
        } finally {
            setLoading(false);
        }
    }
  };

  const handleUpdateSeason = async () => {
      if(!newSeasonInput.trim()) return;
      const targetSeason = newSeasonInput.trim();
      if(confirm(`Set active season to ${targetSeason}? Previous season data will be preserved in the archive, and league divisions will carry over as clean blank brackets.`)) {
          setLoading(true);
          try {
              await storage.updateCurrentSeason(targetSeason);
              setCurrentSeason(targetSeason);
              const [newLeagues, fetchedSeasons] = await Promise.all([
                  storage.getLeagues(targetSeason),
                  storage.getAvailableSeasons()
              ]);
              const seasons = Array.from(new Set([...fetchedSeasons, targetSeason, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
              setLeagues(newLeagues);
              setAllSeasons(seasons);
              setNewSeasonInput('');
              if (onSeasonUpdated) onSeasonUpdated();
              alert(`Season ${targetSeason} is now active with clean league divisions ready for teams.`);
          } catch (e: any) {
              alert('Failed to update season: ' + (e?.message || 'Unknown error'));
          } finally {
              setLoading(false);
          }
      }
  };

  const handleUpdateAdminPw = async () => {
      if(!newAdminPw.trim()) return;
      try {
          await storage.updateAdminPassword(newAdminPw.trim());
          setNewAdminPw('');
          alert("Admin password updated.");
      } catch(e) {
          alert("Failed to update admin password.");
      }
  };

  const handleUpdateUmpirePw = async () => {
      if(!newUmpirePw.trim()) return;
      try {
          await storage.updateUmpirePassword(newUmpirePw.trim());
          setNewUmpirePw('');
          alert("Umpire password updated.");
      } catch(e) {
          alert("Failed to update umpire password.");
      }
  };

  const toggleTeamSelection = (teamId: string) => {
      const newSet = new Set(selectedTeamIds);
      if (newSet.has(teamId)) newSet.delete(teamId);
      else newSet.add(teamId);
      setSelectedTeamIds(newSet);
  };

  const handleBulkMove = async () => {
      if (selectedTeamIds.size === 0 || !targetLeagueForMove) return;
      if (!confirm(`Move ${selectedTeamIds.size} team(s) and their matches to the ${targetLeagueForMove} league?`)) return;

      setMovingTeams(true);
      try {
          await storage.moveTeams(Array.from(selectedTeamIds), targetLeagueForMove);
          alert("Teams Moved Successfully!");
          // Refresh data
          const ts = await storage.getAllTeams();
          setAllTeams(ts);
          setSelectedTeamIds(new Set());
          setTargetLeagueForMove('');
      } catch (e) {
          alert("Failed to move teams.");
      } finally {
          setMovingTeams(false);
      }
  };

  // Group teams by league
  const teamsByLeague: Record<string, Team[]> = {};
  allTeams.forEach(t => {
      if (!teamsByLeague[t.league]) teamsByLeague[t.league] = [];
      teamsByLeague[t.league].push(t);
  });
  
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24 w-full font-sans">
      {/* Top Header */}
      <div className="relative z-[1200] flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 sm:mb-8 pointer-events-auto">
          <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-sans tracking-tight">Admin Dashboard</h2>
                {loading && (
                  <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-bold px-2 py-0.5 rounded-full animate-pulse">
                    Syncing...
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-0.5">Manage divisions, seasons, rosters, and system security</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
              {onStartPractice && (
                  <button 
                      onClick={onStartPractice} 
                      className="px-3 py-1.5 sm:px-4 sm:py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs sm:text-sm font-bold font-sans transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                      <span>🧪</span>
                      <span>Start Practice Match</span>
                  </button>
              )}
              <button 
                  type="button"
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowGuide(true); }} 
                  className="relative z-[1201] pointer-events-auto px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg text-xs sm:text-sm font-bold font-sans transition-colors cursor-pointer"
              >
                  Guide
              </button>
              <button 
                  type="button"
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); onBack(); }} 
                  className="relative z-[1201] pointer-events-auto px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold font-sans transition-colors cursor-pointer"
              >
                  ← Exit Admin
              </button>
          </div>
      </div>

      <div className="space-y-4 sm:space-y-6">
        
        {/* 1. League Year Selector & Division Configuration (Exclusive to Admin) */}
        <section className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 font-sans">
                            League Year Selector
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">•</span>
                        <span className="text-xs text-slate-500 font-sans">
                            Current Active: <strong className="text-slate-900 dark:text-white font-bold">{currentSeason}</strong>
                        </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-sans">
                        Managing Season: <span className="text-blue-600 dark:text-blue-400 font-extrabold">{selectedSeason}</span> {selectedSeason === currentSeason ? '(Active Live)' : '(Archive)'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                        Umpires and spectators only see the active season ({currentSeason}). Use the pulldown below to go back to all years to inspect divisions, teams, or historical matches.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    <div className="relative">
                        <select
                            value={selectedSeason}
                            onChange={(e) => handleSwitchViewSeason(e.target.value)}
                            className="relative z-10 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-bold py-2.5 px-4 pr-5 rounded-xl shadow-sm text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer font-sans"
                            aria-label="Select League Year"
                        >
                            {Array.from(new Set([...allSeasons, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(s => (
                                <option key={s} value={s}>
                                    Season {s} {s === currentSeason ? '★ (Active)' : '(Archive)'}
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedSeason !== currentSeason && (
                        <button
                            type="button"
                            onClick={() => handleMakeActiveSeason(selectedSeason)}
                            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold font-sans transition-all shadow-sm cursor-pointer whitespace-nowrap"
                            title={`Make ${selectedSeason} the live active season for all users`}
                        >
                            Set as Live Active Season
                        </button>
                    )}

                    {onBrowseArchive && (
                        <button
                            type="button"
                            onClick={() => onBrowseArchive(selectedSeason)}
                            className="px-3.5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold font-sans transition-all shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            title={`Browse ${selectedSeason} in App`}
                        >
                            <span>Browse {selectedSeason} in App</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Division Configuration for selectedSeason */}
            <div className="pt-5">
                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-3 font-sans">
                    Division Configuration ({selectedSeason} Season)
                </h4>
                
                <div className="mb-5">
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 font-sans">
                        Create New League Division (in {selectedSeason})
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                        <input 
                            type="text" 
                            value={newLeagueName} 
                            onChange={e => setNewLeagueName(e.target.value)} 
                            placeholder="e.g. 10u, 12u, Varsity" 
                            className="flex-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-xl px-3.5 py-2 sm:py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans" 
                        />
                        <button 
                            onClick={handleCreateLeague} 
                            disabled={creatingLeague || !newLeagueName.trim()} 
                            className="bg-green-600 text-white px-5 py-2 sm:py-2.5 rounded-xl hover:bg-green-700 font-bold text-xs sm:text-sm disabled:opacity-50 font-sans transition-colors cursor-pointer"
                        >
                            {creatingLeague ? 'Creating...' : `+ Create Division in ${selectedSeason}`}
                        </button>
                    </div>
                </div>

                <div className="mt-5 border-t border-slate-100 dark:border-slate-800 pt-4">
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 font-sans">
                        Existing Divisions ({selectedSeason} Season)
                    </label>
                    <div className="flex flex-col gap-2.5 w-full">
                        {leagues.map(l => {
                            const len = l.id.length;
                            const dynamicFontClass = 
                                len <= 8 ? 'text-sm sm:text-base' :
                                len <= 16 ? 'text-xs sm:text-sm' :
                                'text-[11px] sm:text-xs';

                            return (
                                <div key={l.id} className="flex justify-between items-center p-3 sm:p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 gap-3 shadow-xs">
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 shadow-[0_0_6px_#3b82f6]"></span>
                                        <span className={`font-bold text-slate-800 dark:text-white font-sans ${dynamicFontClass} break-words leading-snug`}>
                                            {l.id}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteLeague(l.id)}
                                        className="text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-lg transition-colors cursor-pointer shrink-0"
                                        title={`Delete ${l.id} Division`}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                    </button>
                                </div>
                            );
                        })}
                        {leagues.length === 0 && <div className="text-xs text-slate-400 italic font-sans py-2">No divisions found for {selectedSeason}. Create one above or import rosters.</div>}
                    </div>
                </div>
            </div>

            {/* Historical Archives & Season Rollover Tool */}
            <div className="pt-5 border-t border-slate-100 dark:border-slate-800 mt-5 space-y-4 sm:space-y-5">
                <div>
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Live Active Season (Public & Umpires)</label>
                    <div className="flex items-center gap-2">
                        <span className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 font-sans">{currentSeason}</span>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">Live Active</span>
                    </div>
                </div>

                {/* Dynamic Season Archives Grid */}
                {(() => {
                    const archivedSeasons = allSeasons.filter(s => s !== currentSeason);
                    if (archivedSeasons.length === 0) return null;
                    return (
                        <div className="space-y-2.5">
                            <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase font-sans">
                                Historical Archives ({archivedSeasons.length})
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {archivedSeasons.map(archSeason => (
                                    <div key={archSeason} className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2.5">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-white font-sans">{archSeason} Season</h4>
                                                <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Archive</span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-sans truncate">Preserved leagues, rosters & scores.</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button 
                                                onClick={() => handleSwitchViewSeason(archSeason)} 
                                                className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold font-sans transition-colors cursor-pointer"
                                                title={`Manage ${archSeason} in admin`}
                                            >
                                                Manage
                                            </button>
                                            {onBrowseArchive && (
                                                <button 
                                                    onClick={() => onBrowseArchive(archSeason)} 
                                                    className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold font-sans transition-colors shadow-sm cursor-pointer"
                                                    title={`Browse ${archSeason} in app`}
                                                >
                                                    Browse
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}

                <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Create & Switch to New Active Season</label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2.5 font-sans leading-relaxed">
                        Moving to next year? Activating a new year archives the current season with full history and carries over divisions as clean brackets.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                        <input 
                            type="text" 
                            value={newSeasonInput} 
                            onChange={e => setNewSeasonInput(e.target.value)} 
                            placeholder={`e.g. ${Number(currentSeason) ? Number(currentSeason) + 1 : new Date().getFullYear() + 1}`} 
                            className="w-full sm:w-44 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-xl px-3.5 py-2 sm:py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans" 
                        />
                        <button 
                            onClick={handleUpdateSeason} 
                            disabled={!newSeasonInput.trim()}
                            className="w-full sm:w-auto bg-slate-700 dark:bg-slate-600 text-white px-5 py-2 sm:py-2.5 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-500 disabled:opacity-50 font-bold text-xs sm:text-sm font-sans transition-colors cursor-pointer"
                        >
                            Activate New Season
                        </button>
                    </div>
                </div>
            </div>
        </section>

        {/* 2. Bulk Move Teams */}
        <section className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-1.5 font-sans">Bulk Move Teams</h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4 font-sans leading-relaxed">Select teams to move them to a different league division. Match history and player stats will transfer automatically.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4 max-h-60 sm:max-h-72 overflow-y-auto pr-1">
                {Object.keys(teamsByLeague).map(league => (
                    <div key={league} className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-blue-600 dark:text-blue-400 uppercase text-[11px] mb-2 border-b border-slate-200 dark:border-slate-800 pb-1.5">{league} Division</h4>
                        <div className="space-y-1.5">
                            {teamsByLeague[league].map(team => (
                                <label key={team.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 p-1 rounded-lg transition-colors">
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 text-blue-600 rounded" 
                                        checked={selectedTeamIds.has(team.id)} 
                                        onChange={() => toggleTeamSelection(team.id)} 
                                    />
                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 font-sans truncate">{team.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
                {allTeams.length === 0 && (
                    <div className="col-span-full text-xs text-slate-400 italic py-2">No teams registered yet.</div>
                )}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 items-stretch sm:items-end border-t border-slate-200 dark:border-slate-800 pt-3.5">
                <div className="w-full sm:flex-1">
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Destination Division</label>
                    <select 
                        className="w-full p-2 sm:p-2.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-xl font-bold text-xs sm:text-sm text-slate-800 dark:text-white font-sans"
                        value={targetLeagueForMove}
                        onChange={e => setTargetLeagueForMove(e.target.value)}
                    >
                        <option value="">Select Destination Division...</option>
                        {leagues.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
                    </select>
                </div>
                <button 
                    onClick={handleBulkMove} 
                    disabled={selectedTeamIds.size === 0 || !targetLeagueForMove || movingTeams}
                    className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md hover:bg-blue-500 disabled:opacity-50 transition-all font-sans cursor-pointer"
                >
                    {movingTeams ? 'Moving...' : `Move ${selectedTeamIds.size} Selected Team(s)`}
                </button>
            </div>
        </section>

        {/* 3. Passwords */}
        <section className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-1.5 font-sans">Access Control Passwords</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 font-sans">Update administrator and umpire passwords anytime.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <div>
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">New Admin Password</label>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            value={newAdminPw} 
                            onChange={e => setNewAdminPw(e.target.value)} 
                            placeholder="Enter new admin password" 
                            className="flex-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans" 
                        />
                        <button 
                            onClick={handleUpdateAdminPw} 
                            disabled={!newAdminPw.trim()}
                            className="bg-slate-700 dark:bg-slate-600 text-white px-4 py-2 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-500 disabled:opacity-50 font-bold text-xs font-sans transition-colors cursor-pointer"
                        >
                            Update
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">New Umpire Password</label>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            value={newUmpirePw} 
                            onChange={e => setNewUmpirePw(e.target.value)} 
                            placeholder="Enter new umpire password" 
                            className="flex-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans" 
                        />
                        <button 
                            onClick={handleUpdateUmpirePw} 
                            disabled={!newUmpirePw.trim()}
                            className="bg-amber-600 text-white px-4 py-2 rounded-xl hover:bg-amber-700 disabled:opacity-50 font-bold text-xs font-sans transition-colors cursor-pointer"
                        >
                            Update
                        </button>
                    </div>
                </div>
            </div>
        </section>

        {/* 4. Schedule & Data Management */}
        <section className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 dark:border-slate-800 pb-4">
                <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-sans">Season Schedule Importer (CSV)</h3>
                      <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">Automated</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                      Upload or load any season schedule CSV to provision games, match dates, start/end times, and tunnel assignments instantly with duplicate protection.
                    </p>
                </div>
                <button 
                    onClick={() => setShowScheduleImportModal(true)} 
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all font-sans cursor-pointer self-start sm:self-auto shrink-0"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <span>Import CSV Schedule</span>
                </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 font-sans">Full Database Backup</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-0.5">Download a complete JSON export of all leagues, teams, rosters, and completed matches.</p>
                </div>
                <button 
                    onClick={handleExport} 
                    className="flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-colors font-sans cursor-pointer self-start sm:self-auto"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span>Export JSON Database</span>
                </button>
            </div>
        </section>
      </div>

      {showGuide && createPortal(<UserGuide onClose={() => setShowGuide(false)} />, document.body)}
      
      {showScheduleImportModal && (
        <ScheduleImportModal 
          isOpen={showScheduleImportModal}
          onClose={() => setShowScheduleImportModal(false)}
          onSuccess={async (summary) => {
            const [ls, ts, d] = await Promise.all([
              storage.getLeagues(selectedSeason),
              storage.getTeams(null, selectedSeason),
              storage.exportData().catch(() => '{}')
            ]);
            setLeagues(ls);
            setAllTeams(ts);
            setData(d);
            if (onSeasonUpdated) onSeasonUpdated();
            alert(`Schedule Import Complete!\n• ${summary.createdMatches} matches scheduled\n• ${summary.skippedDuplicates} duplicates avoided\n• ${summary.createdTeams.length} teams created\n• ${summary.createdLeagues.length} divisions created`);
            setShowScheduleImportModal(false);
          }}
          currentSeason={selectedSeason}
          availableSeasons={allSeasons}
          availableLeagues={leagues}
        />
      )}
    </div>
  );
};
