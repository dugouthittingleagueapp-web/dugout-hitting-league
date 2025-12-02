
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AgeGroup, AppState, Match, Team, Player, League, PlayerStats } from './types';
import { Navbar } from './components/Navbar';
import { TeamManagement } from './components/TeamManagement';
import { Scoreboard } from './components/Scoreboard';
import { AdminDashboard } from './components/AdminDashboard';
import { MatchSetup } from './components/MatchSetup';
import * as storage from './services/storageService';

const INACTIVITY_LIMIT = 3 * 60 * 60 * 1000; // 3 hours

// Helper for safe local storage access (prevents SecurityError in restricted iframes/settings)
const safeStorage = {
    getItem: (key: string): string | null => {
        try {
            if (typeof window !== 'undefined') return localStorage.getItem(key);
            return null;
        } catch (e) {
            return null;
        }
    },
    setItem: (key: string, value: string): void => {
        try {
            if (typeof window !== 'undefined') localStorage.setItem(key, value);
        } catch (e) {
            // ignore
        }
    },
    removeItem: (key: string): void => {
        try {
            if (typeof window !== 'undefined') localStorage.removeItem(key);
        } catch (e) {
            // ignore
        }
    }
};

const App: React.FC = () => {
  // Initialize state from localStorage if available to support "refresh current page"
  const [state, setState] = useState<AppState>(() => {
    const saved = safeStorage.getItem('dugout_app_state');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Fallback: If we were in match_setup, revert to dashboard because setup state (ids) isn't persisted
            if (parsed.view === 'match_setup') {
                parsed.view = 'dashboard';
            }
            // Ensure dashboardTab exists
            if (!parsed.dashboardTab) parsed.dashboardTab = 'matches';
            
            return parsed;
        } catch (e) {
            console.error("Error parsing app state", e);
        }
    }
    return { view: 'league_select', currentLeague: null, currentMatchId: null, season: '2025', dashboardTab: 'matches' };
  });

  // Persist App State
  useEffect(() => {
      safeStorage.setItem('dugout_app_state', JSON.stringify(state));
  }, [state]);

  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHomeId, setSelectedHomeId] = useState('');
  const [selectedAwayId, setSelectedAwayId] = useState('');
  
  // Theme State - Persisted
  const [isDarkMode, setIsDarkMode] = useState(() => {
      const savedTheme = safeStorage.getItem('dugout_theme');
      return savedTheme ? JSON.parse(savedTheme) : true;
  });

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Role / Auth State - Initialize from localStorage with Inactivity Check
  const [userRole, setUserRole] = useState<'fan' | 'umpire' | 'admin'>(() => {
    const stored = safeStorage.getItem('userRole');
    const lastActivity = safeStorage.getItem('lastActivity');

    if (stored === 'admin' || stored === 'umpire') {
        // Check for expiration
        if (lastActivity) {
            const diff = Date.now() - parseInt(lastActivity, 10);
            if (diff > INACTIVITY_LIMIT) {
                safeStorage.removeItem('userRole');
                safeStorage.removeItem('lastActivity');
                return 'fan';
            }
        }
        // Update activity on load if valid
        safeStorage.setItem('lastActivity', Date.now().toString());
        return stored as 'fan' | 'umpire' | 'admin';
    }
    return 'fan';
  });

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  // Match Stats Modal
  const [statsModalMatch, setStatsModalMatch] = useState<Match | null>(null);
  const [statsModalData, setStatsModalData] = useState<PlayerStats[]>([]);

  // Move Match Modal
  const [moveMatchModal, setMoveMatchModal] = useState<{ matchId: string, currentLeague: string } | null>(null);
  const [targetLeague, setTargetLeague] = useState('');

  // Sorting State
  const [matchSort, setMatchSort] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });

  // Handle Theme Toggle & Persistence
  useEffect(() => {
    const html = document.documentElement;
    if (isDarkMode) {
        html.classList.add('dark');
    } else {
        html.classList.remove('dark');
    }
    safeStorage.setItem('dugout_theme', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  // Prevent Back Button
  useEffect(() => {
    try {
        window.history.pushState(null, document.title, window.location.href);
        const handlePopState = (event: PopStateEvent) => {
            try {
                window.history.pushState(null, document.title, window.location.href);
            } catch(e) {}
        };
        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    } catch (e) {
        // Ignore security errors
    }
  }, []);

  // Strict Zoom Prevention for iOS/Tablets
  useEffect(() => {
    // Prevent pinch zoom events (iOS)
    const preventGesture = (e: Event) => {
        e.preventDefault();
    };
    
    // Prevent double-tap zoom or multi-touch zoom
    const preventTouchZoom = (e: TouchEvent) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    };

    // Prevent Wheel zoom (trackpads)
    const preventWheelZoom = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    };

    // Add non-passive listeners
    document.addEventListener('gesturestart', preventGesture);
    document.addEventListener('gesturechange', preventGesture);
    document.addEventListener('gestureend', preventGesture);
    document.addEventListener('touchmove', preventTouchZoom, { passive: false });
    document.addEventListener('wheel', preventWheelZoom, { passive: false });

    return () => {
        document.removeEventListener('gesturestart', preventGesture);
        document.removeEventListener('gesturechange', preventGesture);
        document.removeEventListener('gestureend', preventGesture);
        document.removeEventListener('touchmove', preventTouchZoom);
        document.removeEventListener('wheel', preventWheelZoom);
    };
  }, []);

  useEffect(() => {
    const init = async () => {
        const [ls, currentSeason] = await Promise.all([storage.getLeagues(), storage.getCurrentSeason()]);
        setLeagues(ls);
        
        // Only override season if we are on the landing page (view='league_select') and have no league selected.
        setState(s => {
            if (s.view === 'league_select' && !s.currentLeague) {
                 return { ...s, season: currentSeason };
            }
            return s;
        });
    };
    init();
  }, []);

  const refreshDashboard = useCallback(async (league: AgeGroup, season: string, silent = false) => {
    if (!silent) setLoading(true);
    try { 
        const [m, t] = await Promise.all([
            storage.getMatches(league, season),
            storage.getTeams(null, season)
        ]);
        setMatches(m); 
        setTeams(t); 
    } 
    catch (e) { console.error(e); } finally { if (!silent) setLoading(false); }
  }, []);

  // Initial Load & View Change
  useEffect(() => {
    if (state.currentLeague && state.view === 'dashboard') {
        refreshDashboard(state.currentLeague, state.season);
    }
  }, [state.currentLeague, state.view, state.season, refreshDashboard]);

  // Live Polling
  useEffect(() => {
    if (state.view !== 'dashboard' || !state.currentLeague) return;
    const interval = setInterval(() => {
        refreshDashboard(state.currentLeague!, state.season, true);
    }, 5000);
    return () => clearInterval(interval);
  }, [state.view, state.currentLeague, state.season, refreshDashboard]);

  const handleLogout = useCallback(() => {
      setUserRole('fan');
      safeStorage.removeItem('userRole');
      safeStorage.removeItem('lastActivity');
      safeStorage.removeItem('dugout_app_state'); 
      setState(s => ({...s, view: 'league_select', currentLeague: null, currentMatchId: null, dashboardTab: 'matches'})); 
      setIsMenuOpen(false);
  }, []);

  // Session Inactivity
  useEffect(() => {
      if (userRole === 'fan') return;

      const updateActivity = () => {
          safeStorage.setItem('lastActivity', Date.now().toString());
      };

      const checkInactivity = () => {
          const lastActivity = safeStorage.getItem('lastActivity');
          if (lastActivity) {
              const diff = Date.now() - parseInt(lastActivity, 10);
              if (diff > INACTIVITY_LIMIT) {
                  handleLogout();
                  alert("Session expired due to inactivity.");
              }
          }
      };

      const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
      events.forEach(evt => window.addEventListener(evt, updateActivity));
      
      const interval = setInterval(checkInactivity, 60 * 1000);

      return () => {
          events.forEach(evt => window.removeEventListener(evt, updateActivity));
          clearInterval(interval);
      };
  }, [userRole, handleLogout]);

  const handleStartGame = async (finalHomeId: string, finalAwayId: string, homeLineup: Player[], awayLineup: Player[]) => {
    if (!state.currentLeague) return;
    try {
        setLoading(true);

        const syncSubs = async (teamId: string, lineup: Player[]) => {
            const team = teams.find(t => t.id === teamId);
            if (!team) return;
            
            const potentialSubs = lineup.filter(p => !team.players.find(tp => tp.id === p.id));
            
            if (potentialSubs.length > 0) {
                const existingSubIds = (team.subs || []).map(s => s.id);
                const newSubs = potentialSubs.filter(p => !existingSubIds.includes(p.id));
                
                if (newSubs.length > 0) {
                    const updatedSubs = [...(team.subs || []), ...newSubs];
                    const updatedTeam = { ...team, subs: updatedSubs };
                    
                    await storage.updateTeam(updatedTeam);
                    setTeams(prev => prev.map(t => t.id === teamId ? updatedTeam : t));
                }
            }
        };

        await Promise.all([
            syncSubs(finalHomeId, homeLineup),
            syncSubs(finalAwayId, awayLineup)
        ]);

        const homeIds = homeLineup.map(p => p.id);
        const awayIds = awayLineup.map(p => p.id);
        
        const newMatch = await storage.createMatch(state.currentLeague, finalHomeId, finalAwayId, homeIds, awayIds, state.season);
        
        setSelectedHomeId(''); setSelectedAwayId(''); setLoading(false);
        setState({ ...state, view: 'scoring', currentMatchId: newMatch.id });
    } catch (e) { alert("Error starting match: " + e); setLoading(false); }
  };

  const handleDeleteMatch = async (matchId: string) => {
    if (!confirm("Are you sure you want to delete this match? This cannot be undone.")) return;
    try {
        setLoading(true);
        await storage.deleteMatch(matchId);
        if (state.currentLeague) await refreshDashboard(state.currentLeague, state.season);
        else setLoading(false);
    } catch (e) {
        alert("Failed to delete match");
        setLoading(false);
    }
  };

  const handleMoveMatch = async () => {
    if (!moveMatchModal || !targetLeague) return;
    try {
        setLoading(true);
        const match = matches.find(m => m.id === moveMatchModal.matchId);
        if (match) {
            const updatedMatch = { ...match, league: targetLeague };
            await storage.updateMatch(updatedMatch);
            
            alert("Match moved successfully! Stats will now appear in the " + targetLeague + " league.");
            setMoveMatchModal(null);
            setTargetLeague('');
            if (state.currentLeague) await refreshDashboard(state.currentLeague, state.season);
        }
    } catch (e) {
        alert("Failed to move match.");
    } finally {
        setLoading(false);
    }
  };

  const handleOpenMatchStats = (match: Match) => {
      const home = teams.find(t => t.id === match.homeTeamId);
      const away = teams.find(t => t.id === match.awayTeamId);
      if (home && away) {
          const stats = storage.calculateMatchStats(match, home, away);
          setStatsModalData(stats);
          setStatsModalMatch(match);
      }
  };

  const handleSeasonChange = (newSeason: string) => {
      setState({ ...state, season: newSeason, view: state.currentLeague ? 'dashboard' : 'league_select' });
  };

  const handleSelectLeague = (leagueId: string) => {
      setState({ ...state, view: 'dashboard', currentLeague: leagueId, currentMatchId: null });
  };

  const openLoginModal = () => {
      setShowLoginModal(true);
      setPasswordInput('');
      setLoginError('');
      setIsMenuOpen(false);
  };
  
  const openAdminDashboard = () => {
      if (userRole === 'admin') {
          setState({ ...state, view: 'admin' });
          setIsMenuOpen(false);
      }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await storage.verifyPassword(passwordInput);
    setLoading(false);
    
    if (result.success && result.role) {
      setUserRole(result.role);
      safeStorage.setItem('userRole', result.role);
      safeStorage.setItem('lastActivity', Date.now().toString());
      setShowLoginModal(false);
      if (result.role === 'admin') setState(prev => ({...prev, view: 'admin'})); 
    } else {
      setLoginError('Incorrect password.');
    }
  };

  const performSort = (data: PlayerStats[], config: { key: keyof PlayerStats; direction: 'asc' | 'desc' }) => {
      return [...data].sort((a, b) => {
        const valA = a[config.key];
        const valB = b[config.key];
        
        if (typeof valA === 'string' && typeof valB === 'string') {
            return config.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        if (valA < valB) return config.direction === 'asc' ? -1 : 1;
        if (valA > valB) return config.direction === 'asc' ? 1 : -1;
        return 0;
      });
  };

  const renderSortHeader = (label: string, key: keyof PlayerStats, config: { key: keyof PlayerStats; direction: 'asc' | 'desc' }, setConfig: any, align: string = 'text-right', colorClass: string = '') => (
    <th 
        className={`px-2 sm:px-4 py-2 sm:py-3 cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors select-none ${align} ${colorClass}`}
        onClick={() => setConfig({ key, direction: config.key === key && config.direction === 'desc' ? 'asc' : 'desc' })}
        title="Click to sort"
    >
        <div className={`flex items-center gap-1 ${align === 'text-right' ? 'justify-end' : 'justify-start'}`}>
            {label}
            {config.key === key && (
                <span className="text-[10px] text-slate-400">{config.direction === 'asc' ? '▲' : '▼'}</span>
            )}
        </div>
    </th>
  );

  const calculateWeeklyLeaders = useCallback(() => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentMatches = matches.filter(m => {
          if (!m.isComplete) return false;
          const d = new Date(m.date);
          return d >= oneWeekAgo;
      });

      const totals: { name: string, team: string, score: number }[] = [];
      const bestInnings: { name: string, team: string, score: number }[] = [];

      recentMatches.forEach(m => {
          const home = teams.find(t => t.id === m.homeTeamId);
          const away = teams.find(t => t.id === m.awayTeamId);
          if (!home || !away) return;

          const stats = storage.calculateMatchStats(m, home, away);
          stats.forEach(s => {
              if (s.playerId.startsWith('ghost-')) return;
              let tName = 'Unknown';
              if ([...home.players, ...(home.subs || [])].some(p => p.id === s.playerId)) tName = home.name;
              else if ([...away.players, ...(away.subs || [])].some(p => p.id === s.playerId)) tName = away.name;

              totals.push({ name: s.name, team: tName, score: s.totalPoints });
          });

          m.innings.forEach(ing => {
              const check = (side: any, t: Team) => {
                  side.playerScores.forEach((ps: any) => {
                      if (ps.playerId.startsWith('ghost-')) return;
                      const p = [...t.players, ...(t.subs || [])].find(x => x.id === ps.playerId);
                      if (p) {
                          const score = ps.pitches.reduce((acc: number, v: any) => acc + (v.points || 0), 0);
                          bestInnings.push({
                              name: `${p.name}${p.lastName ? ' ' + p.lastName[0] + '.' : ''}`,
                              team: t.name,
                              score
                          });
                      }
                  });
              };
              check(ing.home, home);
              check(ing.away, away);
          });
      });

      return {
          topTotals: totals.sort((a, b) => b.score - a.score).slice(0, 5),
          topInnings: bestInnings.sort((a, b) => b.score - a.score).slice(0, 5)
      };
  }, [matches, teams]);

  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-black font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300 ${isMenuOpen ? 'overflow-hidden' : ''}`}>
      <Navbar 
        currentLeague={state.currentLeague} 
        currentSeason={state.season}
        leagues={leagues}
        userRole={userRole}
        onGoHome={() => setState(s => ({ ...s, view: 'league_select', currentLeague: null, currentMatchId: null }))}
        onSwitchLeague={() => setState(s => ({ ...s, view: 'league_select', currentLeague: null, currentMatchId: null }))}
        onSelectLeague={handleSelectLeague}
        onLogin={openLoginModal}
        onLogout={handleLogout}
        onAdminDashboard={openAdminDashboard}
        onSeasonChange={handleSeasonChange}
        isDarkMode={isDarkMode}
        toggleTheme={() => setIsDarkMode(!isDarkMode)}
        isMenuOpen={isMenuOpen}
        setMenuOpen={setIsMenuOpen}
      />

      {/* 1. Landing / League Selection */}
      {state.view === 'league_select' && (
          <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 animate-in fade-in duration-500">
             <div className="text-center mb-10 max-w-2xl">
                 <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-slate-800 dark:text-white font-sans">Select a League</h2>
                 <p className="text-slate-500 dark:text-slate-400 font-sans">Choose your division to view standings, matches, and stats for the {state.season} season.</p>
             </div>
             
             {loading ? (
                 <div className="text-slate-400 font-bold animate-pulse font-sans">Loading Leagues...</div>
             ) : (
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-4xl">
                     {leagues.map(league => (
                         <button 
                            key={league.id} 
                            onClick={() => handleSelectLeague(league.id)}
                            className="bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all group text-left"
                         >
                             <div className="flex justify-between items-center">
                                 <span className="text-2xl font-black italic uppercase text-slate-800 dark:text-white font-sans">{league.id}</span>
                                 <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 group-hover:bg-blue-600 group-hover:text-white px-3 py-1 rounded-full text-xs font-bold transition-colors font-sans">Enter &rarr;</span>
                             </div>
                             <p className="text-sm text-slate-400 mt-2 font-sans font-medium">View Stats & Matches</p>
                         </button>
                     ))}
                 </div>
             )}
             {leagues.length === 0 && !loading && (
                 <p className="text-slate-500 italic font-sans">No leagues found. Admin must create a league.</p>
             )}
          </div>
      )}

      {/* 2. Dashboard */}
      {state.view === 'dashboard' && state.currentLeague && (
        <main className="max-w-7xl mx-auto px-2 sm:px-6 py-3 sm:py-8 space-y-3 sm:space-y-6">
           {/* Weekly Leaders Marquee */}
           <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-sm overflow-hidden relative">
               <div className="absolute top-0 left-0 bottom-0 bg-blue-600 w-1"></div>
               <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2 font-sans">Last 7 Days Top Performers</h3>
               <div className="flex gap-6 overflow-x-auto scrollbar-hide pb-1">
                   {(() => {
                       const { topTotals, topInnings } = calculateWeeklyLeaders();
                       if (topTotals.length === 0) return <span className="text-xs text-slate-400 italic">No recent activity.</span>;
                       return (
                           <>
                               <div className="shrink-0">
                                   <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Total Points</span>
                                   <div className="flex gap-3">
                                       {topTotals.map((p, i) => (
                                           <div key={i} className="bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-slate-700">
                                               <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-white whitespace-nowrap">{p.name}</div>
                                               <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                                                   <span>{p.team}</span>
                                                   <span className="font-bold text-blue-600 dark:text-blue-400">{p.score} pts</span>
                                               </div>
                                           </div>
                                       ))}
                                   </div>
                               </div>
                               <div className="w-px bg-slate-200 dark:bg-slate-700 shrink-0"></div>
                               <div className="shrink-0">
                                   <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Best Single Inning</span>
                                   <div className="flex gap-3">
                                       {topInnings.map((p, i) => (
                                           <div key={i} className="bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-slate-700">
                                               <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-white whitespace-nowrap">{p.name}</div>
                                               <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                                                   <span>{p.team}</span>
                                                   <span className="font-bold text-green-600 dark:text-green-400">{p.score} pts</span>
                                               </div>
                                           </div>
                                       ))}
                                   </div>
                               </div>
                           </>
                       );
                   })()}
               </div>
           </div>

           {/* Mobile Tabs */}
           <div className="flex space-x-1 bg-slate-200/50 dark:bg-slate-900/50 p-1 rounded-xl mb-3 sm:mb-6">
              {(['matches', 'standings', 'season_stats'] as const).map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setState(s => ({ ...s, dashboardTab: tab }))}
                    className={`flex-1 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wide transition-all font-sans ${state.dashboardTab === tab ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                  >
                      {tab.replace('_', ' ')}
                  </button>
              ))}
           </div>
           
           {/* Tab Content */}
           {state.dashboardTab === 'matches' && (
               <div className="space-y-4 sm:space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                   {/* Create Match Area */}
                   {(userRole === 'umpire' || userRole === 'admin') && (
                       <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-slate-100 dark:border-slate-800/50">
                           <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 font-sans flex items-center gap-2">
                               <span className="w-2 h-6 bg-blue-500 rounded-full"></span>
                               Start New Match
                           </h3>
                           <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                               <select className="flex-1 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-sans" value={selectedAwayId} onChange={e => setSelectedAwayId(e.target.value)}>
                                   <option value="">Select Away Team...</option>
                                   {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                               </select>
                               <div className="flex items-center justify-center text-slate-400 font-bold font-sans">@</div>
                               <select className="flex-1 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-sans" value={selectedHomeId} onChange={e => setSelectedHomeId(e.target.value)}>
                                   <option value="">Select Home Team...</option>
                                   {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                               </select>
                           </div>
                           <button 
                                disabled={!selectedHomeId || !selectedAwayId || selectedHomeId === selectedAwayId}
                                onClick={() => setState({ ...state, view: 'match_setup' })}
                                className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-900/20 transition-all font-sans active:scale-[0.99]"
                           >
                               Next: Set Lineup &rarr;
                           </button>
                       </div>
                   )}

                   {/* Active Matches List */}
                   <div>
                       <div className="flex justify-between items-center mb-2 sm:mb-4 px-1">
                           <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider font-sans">Recent Matches</h3>
                           {loading && <span className="text-xs text-blue-500 animate-pulse font-bold font-sans">Live Updating...</span>}
                       </div>
                       {matches.length === 0 ? (
                           <div className="text-center py-12 bg-white/50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800">
                               <p className="text-slate-400 font-bold font-sans">No matches played yet in {state.season}.</p>
                           </div>
                       ) : (
                           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
                               {matches.map(match => {
                                   const home = teams.find(t => t.id === match.homeTeamId);
                                   const away = teams.find(t => t.id === match.awayTeamId);
                                   if (!home || !away) return null;

                                   const homeScore = storage.calculateTeamGameTotal(match, home, away, 'home');
                                   const awayScore = storage.calculateTeamGameTotal(match, home, away, 'away');

                                   return (
                                       <div key={match.id} className="bg-white dark:bg-slate-900 p-3 sm:p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-all group relative">
                                           {/* Match Status Badge */}
                                           <div className="flex justify-between items-start mb-3 sm:mb-4">
                                               <span className={`px-2 py-0.5 sm:py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${match.isComplete ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900/30 animate-pulse'}`}>
                                                   {match.isComplete ? 'Final' : 'Live'}
                                               </span>
                                               <span className="text-[10px] text-slate-400 font-medium font-sans">{new Date(match.date).toLocaleDateString()}</span>
                                           </div>

                                           {/* Teams & Scores */}
                                           <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                                               <div className="flex justify-between items-center">
                                                   <div className="flex items-center gap-2">
                                                       <span className="text-[10px] font-bold text-slate-400 w-8">AWAY</span>
                                                       <span className={`text-base sm:text-lg font-bold font-sans truncate max-w-[120px] sm:max-w-[150px] ${awayScore > homeScore && match.isComplete ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{away.name}</span>
                                                   </div>
                                                   <span className={`text-xl sm:text-2xl font-black font-sans tabular-nums ${awayScore > homeScore ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`}>{awayScore}</span>
                                               </div>
                                               <div className="flex justify-between items-center">
                                                   <div className="flex items-center gap-2">
                                                       <span className="text-[10px] font-bold text-slate-400 w-8">HOME</span>
                                                       <span className={`text-base sm:text-lg font-bold font-sans truncate max-w-[120px] sm:max-w-[150px] ${homeScore > awayScore && match.isComplete ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{home.name}</span>
                                                   </div>
                                                   <span className={`text-xl sm:text-2xl font-black font-sans tabular-nums ${homeScore > awayScore ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>{homeScore}</span>
                                               </div>
                                           </div>

                                           {/* Actions */}
                                           <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                               {(userRole === 'umpire' || userRole === 'admin') ? (
                                                   <div className="flex gap-2">
                                                        <button 
                                                            onClick={() => setState({ ...state, view: 'scoring', currentMatchId: match.id })}
                                                            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-sans"
                                                        >
                                                            {match.isComplete ? 'Edit Score' : 'Continue Scoring'}
                                                        </button>
                                                        {userRole === 'admin' && (
                                                            <>
                                                                <button onClick={() => handleDeleteMatch(match.id)} className="text-xs font-bold text-red-400 hover:text-red-600 ml-2 font-sans">Delete</button>
                                                                <button onClick={() => setMoveMatchModal({ matchId: match.id, currentLeague: match.league })} className="text-xs font-bold text-amber-500 hover:text-amber-600 ml-2 font-sans">Move</button>
                                                            </>
                                                        )}
                                                   </div>
                                               ) : (
                                                   <button 
                                                       onClick={() => setState({ ...state, view: 'scoring', currentMatchId: match.id })}
                                                       className="text-xs font-bold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 font-sans flex items-center gap-1"
                                                   >
                                                       View Details &rarr;
                                                   </button>
                                               )}
                                               <button onClick={() => handleOpenMatchStats(match)} className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-bold font-sans">Box Score</button>
                                           </div>
                                       </div>
                                   );
                               })}
                           </div>
                       )}
                   </div>
               </div>
           )}

           {/* Tab Content: Standings */}
           {state.dashboardTab === 'standings' && (
               <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
                    <div className="overflow-x-auto touch-auto">
                       <table className="w-full text-left text-xs sm:text-sm">
                           <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold text-[10px] sm:text-xs border-b border-slate-200 dark:border-slate-800">
                               <tr>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3">Team</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-center">GP</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-center">W</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-center">L</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-center">T</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-right">PF</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-right hidden sm:table-cell">PA</th>
                                   <th className="px-2 sm:px-4 py-2 sm:py-3 text-right">Diff</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                               {(() => {
                                   const stats = teams.map(team => {
                                       const teamMatches = matches.filter(m => (m.homeTeamId === team.id || m.awayTeamId === team.id) && m.isComplete);
                                       let wins = 0, losses = 0, ties = 0, pf = 0, pa = 0;
                                       teamMatches.forEach(m => {
                                           const isHome = m.homeTeamId === team.id;
                                           const home = teams.find(t=>t.id===m.homeTeamId)!;
                                           const away = teams.find(t=>t.id===m.awayTeamId)!;
                                           const homeScore = storage.calculateTeamGameTotal(m, home, away, 'home');
                                           const awayScore = storage.calculateTeamGameTotal(m, home, away, 'away');
                                           
                                           const myScore = isHome ? homeScore : awayScore;
                                           const oppScore = isHome ? awayScore : homeScore;
                                           
                                           pf += myScore;
                                           pa += oppScore;
                                           
                                           if (myScore > oppScore) wins++;
                                           else if (myScore < oppScore) losses++;
                                           else ties++;
                                       });
                                       return { team, gp: teamMatches.length, wins, losses, ties, pf, pa, diff: pf - pa };
                                   }).sort((a, b) => b.wins - a.wins || b.diff - a.diff);

                                   return stats.map((s, idx) => (
                                       <tr key={s.team.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 font-bold text-slate-800 dark:text-white font-sans flex items-center gap-2">
                                               <span className="text-slate-400 w-4">{idx + 1}</span>
                                               {s.team.name}
                                           </td>
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 text-center font-sans tabular-nums text-slate-600 dark:text-slate-400">{s.gp}</td>
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 text-center font-bold text-green-600 dark:text-green-500 font-sans tabular-nums">{s.wins}</td>
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-red-500 font-sans tabular-nums">{s.losses}</td>
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 text-center text-slate-400 font-sans tabular-nums">{s.ties}</td>
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-bold text-slate-800 dark:text-slate-200 font-sans tabular-nums">{s.pf}</td>
                                           <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-slate-500 hidden sm:table-cell font-sans tabular-nums">{s.pa}</td>
                                           <td className={`px-2 sm:px-4 py-2 sm:py-3 text-right font-bold font-sans tabular-nums ${s.diff > 0 ? 'text-green-600' : s.diff < 0 ? 'text-red-500' : 'text-slate-400'}`}>{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
                                       </tr>
                                   ));
                               })()}
                           </tbody>
                       </table>
                   </div>
                   {(userRole === 'umpire' || userRole === 'admin') && (
                       <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                           <button onClick={() => setState({ ...state, view: 'team_management' })} className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm font-sans">Manage Team Rosters</button>
                       </div>
                   )}
               </div>
           )}

           {/* Tab Content: Season Stats */}
           {state.dashboardTab === 'season_stats' && (
               <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
                    <div className="overflow-x-auto touch-auto">
                        <table className="w-full text-left text-xs sm:text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold text-[10px] sm:text-xs border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    {renderSortHeader('Player', 'name', matchSort, setMatchSort, 'text-left')}
                                    {renderSortHeader('Points', 'totalPoints', matchSort, setMatchSort)}
                                    {renderSortHeader('4s', 'hits4', matchSort, setMatchSort, 'text-right', 'text-rose-600 dark:text-rose-500')}
                                    {renderSortHeader('3s', 'hits3', matchSort, setMatchSort, 'text-right', 'text-amber-600 dark:text-amber-500')}
                                    {renderSortHeader('2s', 'hits2', matchSort, setMatchSort, 'text-right', 'text-green-600 dark:text-green-500')}
                                    {renderSortHeader('1s', 'hits1', matchSort, setMatchSort, 'text-right', 'text-cyan-600 dark:text-cyan-500')}
                                    {renderSortHeader('Pitches', 'pitchesSeen', matchSort, setMatchSort, 'text-right', 'text-slate-400')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {(() => {
                                    // Aggregate all stats
                                    const allStats = new Map<string, PlayerStats>();
                                    matches.filter(m => m.isComplete).forEach(m => {
                                        const h = teams.find(t=>t.id===m.homeTeamId);
                                        const a = teams.find(t=>t.id===m.awayTeamId);
                                        if(h && a) {
                                            const s = storage.calculateMatchStats(m, h, a);
                                            s.forEach(stat => {
                                                if(stat.playerId.startsWith('ghost-')) return;
                                                // Check for name match in rosters to add team info if needed? 
                                                // For now just ID aggregation.
                                                if(!allStats.has(stat.playerId)) allStats.set(stat.playerId, {...stat});
                                                else {
                                                    const ex = allStats.get(stat.playerId)!;
                                                    ex.totalPoints += stat.totalPoints;
                                                    ex.hits4 += stat.hits4;
                                                    ex.hits3 += stat.hits3;
                                                    ex.hits2 += stat.hits2;
                                                    ex.hits1 += stat.hits1;
                                                    ex.pitchesSeen += stat.pitchesSeen;
                                                }
                                            });
                                        }
                                    });
                                    const sorted = performSort(Array.from(allStats.values()), matchSort);
                                    
                                    if(sorted.length === 0) return <tr><td colSpan={7} className="p-4 text-center text-slate-400 italic">No stats recorded yet.</td></tr>;

                                    return sorted.map(s => (
                                        <tr key={s.playerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 font-bold text-slate-800 dark:text-white font-sans">{s.name}</td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-bold text-lg text-slate-900 dark:text-white font-sans tabular-nums">{s.totalPoints}</td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-slate-600 dark:text-slate-400 font-sans tabular-nums">{s.hits4}</td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-slate-600 dark:text-slate-400 font-sans tabular-nums">{s.hits3}</td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-slate-600 dark:text-slate-400 font-sans tabular-nums">{s.hits2}</td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-slate-600 dark:text-slate-400 font-sans tabular-nums">{s.hits1}</td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-slate-400 font-sans tabular-nums">{s.pitchesSeen}</td>
                                        </tr>
                                    ));
                                })()}
                            </tbody>
                        </table>
                    </div>
               </div>
           )}
        </main>
      )}

      {/* 3. Sub-Views */}
      {state.view === 'team_management' && state.currentLeague && (
        <TeamManagement 
          league={state.currentLeague} 
          season={state.season}
          onBack={() => setState({ ...state, view: 'dashboard' })} 
        />
      )}
      {state.view === 'match_setup' && selectedHomeId && selectedAwayId && (
        <MatchSetup 
            homeTeam={teams.find(t => t.id === selectedHomeId)!}
            awayTeam={teams.find(t => t.id === selectedAwayId)!}
            onStart={handleStartGame}
            onCancel={() => setState({ ...state, view: 'dashboard' })}
        />
      )}
      {state.view === 'scoring' && state.currentMatchId && (
        <Scoreboard 
            matchId={state.currentMatchId} 
            onExit={() => setState({ ...state, view: 'dashboard', currentMatchId: null })} 
            isReadOnly={userRole === 'fan'}
        />
      )}
      {state.view === 'admin' && (
        <AdminDashboard onBack={() => setState({ ...state, view: state.currentLeague ? 'dashboard' : 'league_select' })} />
      )}

      {/* Modals */}
      {showLoginModal && createPortal(
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm font-sans border border-slate-200 dark:border-slate-700">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-bold text-slate-800 dark:text-white">Umpire/Admin Login</h3>
                      <button onClick={() => setShowLoginModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                  </div>
                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                          <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-sans dark:text-white" autoFocus />
                      </div>
                      {loginError && <p className="text-red-500 text-sm font-bold">{loginError}</p>}
                      <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors">{loading ? 'Verifying...' : 'Log In'}</button>
                  </form>
              </div>
          </div>,
          document.body
      )}

      {/* Match Stats Modal */}
      {statsModalMatch && createPortal(
          <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200 p-2 sm:p-4" onClick={() => setStatsModalMatch(null)}>
              <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] font-sans border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                      <div>
                          <h3 className="font-black uppercase text-slate-400 text-xs tracking-widest">Match Report</h3>
                          <p className="font-bold text-slate-800 dark:text-white">{new Date(statsModalMatch.date).toLocaleDateString()}</p>
                      </div>
                      <button onClick={() => setStatsModalMatch(null)} className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300">Close</button>
                  </div>
                  <div className="overflow-y-auto p-0">
                      <table className="w-full text-left text-xs sm:text-sm">
                          <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold sticky top-0">
                              <tr>
                                  <th className="px-4 py-3">Player</th>
                                  <th className="px-4 py-3 text-right">Pts</th>
                                  <th className="px-4 py-3 text-right">4s</th>
                                  <th className="px-4 py-3 text-right">3s</th>
                                  <th className="px-4 py-3 text-right">2s</th>
                                  <th className="px-4 py-3 text-right">1s</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {statsModalData.sort((a,b) => b.totalPoints - a.totalPoints).map(s => (
                                  <tr key={s.playerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-3 font-bold text-slate-800 dark:text-white">{s.name}</td>
                                      <td className="px-4 py-3 text-right font-bold text-lg">{s.totalPoints}</td>
                                      <td className="px-4 py-3 text-right text-rose-500 font-bold">{s.hits4}</td>
                                      <td className="px-4 py-3 text-right text-amber-500 font-bold">{s.hits3}</td>
                                      <td className="px-4 py-3 text-right text-green-500 font-bold">{s.hits2}</td>
                                      <td className="px-4 py-3 text-right text-cyan-500 font-bold">{s.hits1}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>,
          document.body
      )}

      {/* Move Match Modal */}
      {moveMatchModal && createPortal(
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm font-sans border border-slate-200 dark:border-slate-700">
                   <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Move Match to League</h3>
                   <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Current League: <strong>{moveMatchModal.currentLeague}</strong></p>
                   
                   <div className="mb-4">
                       <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Target League</label>
                       <select className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold outline-none" value={targetLeague} onChange={e => setTargetLeague(e.target.value)}>
                           <option value="">Select...</option>
                           {leagues.filter(l => l.id !== moveMatchModal.currentLeague).map(l => (
                               <option key={l.id} value={l.id}>{l.id}</option>
                           ))}
                       </select>
                   </div>
                   
                   <div className="flex gap-2">
                       <button onClick={() => setMoveMatchModal(null)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-lg">Cancel</button>
                       <button onClick={handleMoveMatch} disabled={!targetLeague} className="flex-1 py-2 bg-amber-500 text-white font-bold rounded-lg disabled:opacity-50">Move</button>
                   </div>
              </div>
          </div>,
          document.body
      )}

    </div>
  );
};

export default App;
