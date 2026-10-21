import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AgeGroup, AppState, Match, Team, Player, League, PlayerStats, Inning, TieBreakerRound } from './types';
import { Navbar } from './components/Navbar';
import { TeamManagement } from './components/TeamManagement';
import { Scoreboard } from './components/Scoreboard';
import { AdminDashboard } from './components/AdminDashboard';
import { MatchSetup } from './components/MatchSetup';
import { RosterImportModal } from './components/RosterImportModal';
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

// Helper to get ISO Week Key (YYYY-Www) to group matches chronologically
const getWeekKey = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(( ( (d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${weekNo}`;
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
            // If in scoring and currentMatchId is missing, check activeMatchId
            if (parsed.view === 'scoring' && !parsed.currentMatchId) {
                const activeId = safeStorage.getItem('dugout_active_match_id');
                if (activeId) parsed.currentMatchId = activeId;
                else parsed.view = 'dashboard';
            }
            // Ensure dashboardTab exists
            if (!parsed.dashboardTab) parsed.dashboardTab = 'matches';
            
            return parsed;
        } catch (e) {
            console.error("Error parsing app state", e);
        }
    }
    return { view: 'league_select', currentLeague: null, currentMatchId: null, season: '2026', dashboardTab: 'matches' };
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
  const [showDashboardImport, setShowDashboardImport] = useState(false);
  
  // In-Progress Match Recovery State
  const [resumeMatch, setResumeMatch] = useState<{ id: string; league: string; season: string; homeTeamName: string; awayTeamName: string; inningNumber: number } | null>(null);
  const [dismissedResumeId, setDismissedResumeId] = useState<string | null>(null);

  // Weekly State
  const [matchListWeek, setMatchListWeek] = useState<string>('');
  const [leaderboardWeek, setLeaderboardWeek] = useState<string>('');

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
  const [seasonSort, setSeasonSort] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });
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

  // Scroll Locking for Modals and Menu
  useEffect(() => {
      if (isMenuOpen || showLoginModal || moveMatchModal || statsModalMatch) {
          // No-op
      }
  }, [isMenuOpen, showLoginModal, moveMatchModal, statsModalMatch]);

  // Browser History & Role-Guarded Back Navigation
  useEffect(() => {
    try {
        window.history.pushState({ view: state.view, matchId: state.currentMatchId, league: state.currentLeague }, document.title, window.location.href);
    } catch (e) {}

    const handlePopState = (event: PopStateEvent) => {
        // Guard umpires/admins from accidentally exiting during active scoring
        if (state.view === 'scoring' && userRole !== 'fan') {
            try {
                window.history.pushState({ view: state.view, matchId: state.currentMatchId, league: state.currentLeague }, document.title, window.location.href);
            } catch (e) {}
            window.dispatchEvent(new CustomEvent('dugout:umpire-back-attempt'));
            return;
        }

        // Allow parents, fans, and non-scoring views to navigate backward naturally
        if (state.view === 'scoring') {
            setState(s => ({ ...s, view: 'dashboard', currentMatchId: null }));
        } else if (state.view === 'match_setup' || state.view === 'team_management') {
            setState(s => ({ ...s, view: 'dashboard' }));
        } else if (state.view === 'dashboard' || state.view === 'admin') {
            setState(s => ({ ...s, view: 'league_select', currentLeague: null }));
        }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
        window.removeEventListener('popstate', handlePopState);
    };
  }, [state.view, state.currentMatchId, state.currentLeague, userRole]);

  useEffect(() => {
    const init = async () => {
        const currentSeason = await storage.getCurrentSeason();
        const activeSeason = currentSeason || '2026';
        const ls = await storage.getLeagues(activeSeason);
        setLeagues(ls);
        
        setState(s => {
            if (s.view === 'league_select' && !s.currentLeague) {
                 return { ...s, season: activeSeason };
            }
            return s;
        });
    };
    init();
  }, []);

  // Sync leagues whenever the active season changes (e.g. browsing 2025 archive)
  useEffect(() => {
    if (state.season) {
      storage.getLeagues(state.season).then(setLeagues).catch(console.error);
    }
  }, [state.season]);

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
    storage.syncOfflineData();
    const handleOnline = () => storage.syncOfflineData();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

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

  // Active Match Recovery Detection (Prompt to resume if device refreshed or returned)
  useEffect(() => {
      if (state.view === 'scoring') {
          return;
      }
      const storedActiveId = safeStorage.getItem('dugout_active_match_id');
      if (!storedActiveId || storedActiveId === dismissedResumeId) {
          setResumeMatch(null);
          return;
      }

      // Check loaded matches first
      const existing = matches.find(m => m.id === storedActiveId);
      if (existing) {
          if (existing.isComplete) {
              safeStorage.removeItem('dugout_active_match_id');
              setResumeMatch(null);
          } else {
              const home = teams.find(t => t.id === existing.homeTeamId);
              const away = teams.find(t => t.id === existing.awayTeamId);
              let activeInning = 1;
              for (let i = 0; i < existing.innings.length; i++) {
                  const ing = existing.innings[i];
                  const homeDone = ing.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
                  const awayDone = ing.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
                  if (!homeDone || !awayDone) { activeInning = ing.number; break; }
              }
              setResumeMatch({
                  id: existing.id,
                  league: existing.league,
                  season: existing.season,
                  homeTeamName: home ? home.name : 'Home Team',
                  awayTeamName: away ? away.name : 'Away Team',
                  inningNumber: activeInning
              });
          }
      } else {
          let isCurrent = true;
          storage.getMatch(storedActiveId).then(m => {
              if (!isCurrent) return;
              if (m && !m.isComplete) {
                  storage.getAllTeams().then(allTeams => {
                      if (!isCurrent) return;
                      const home = allTeams.find(t => t.id === m.homeTeamId);
                      const away = allTeams.find(t => t.id === m.awayTeamId);
                      let activeInning = 1;
                      for (let i = 0; i < (m.innings || []).length; i++) {
                          const ing = m.innings[i];
                          const homeDone = ing?.home?.playerScores?.every(p => p.pitches?.every(pt => pt.points !== null));
                          const awayDone = ing?.away?.playerScores?.every(p => p.pitches?.every(pt => pt.points !== null));
                          if (!homeDone || !awayDone) { activeInning = ing.number; break; }
                      }
                      setResumeMatch({
                          id: m.id,
                          league: m.league,
                          season: m.season,
                          homeTeamName: home ? home.name : 'Home Team',
                          awayTeamName: away ? away.name : 'Away Team',
                          inningNumber: activeInning
                      });
                  });
              } else if (m && m.isComplete) {
                  safeStorage.removeItem('dugout_active_match_id');
                  setResumeMatch(null);
              }
          }).catch(() => {});
          return () => { isCurrent = false; };
      }
  }, [matches, teams, dismissedResumeId, state.view]);

  const handleResumeActiveMatch = () => {
      if (!resumeMatch) return;
      setState(s => ({
          ...s,
          view: 'scoring',
          currentLeague: resumeMatch.league,
          currentMatchId: resumeMatch.id,
          season: resumeMatch.season
      }));
  };

  const handleDismissResumeMatch = () => {
      if (resumeMatch) {
          setDismissedResumeId(resumeMatch.id);
      }
  };

  // --- Week Calculation Logic ---
  const activeWeeks = useMemo(() => {
      if (!state.currentLeague) return [];
      
      const weeksMap = new Map<string, Match[]>();
      matches.forEach(m => {
          const key = getWeekKey(m.date);
          if (!weeksMap.has(key)) weeksMap.set(key, []);
          weeksMap.get(key)!.push(m);
      });

      // Sort weeks chronologically by ID (YYYY-Www sorts naturally)
      const sortedKeys = Array.from(weeksMap.keys()).sort();
      
      return sortedKeys.map((key, index) => ({
          id: key,
          label: `Week ${index + 1}`,
          matches: weeksMap.get(key)!
      }));
  }, [matches, state.currentLeague]);

  // Determine current week on load/update
  useEffect(() => {
      if (activeWeeks.length > 0) {
          const currentKey = getWeekKey(new Date().toISOString());
          
          // Helper to safely set state if not set or if invalid
          const resolveWeek = (currentVal: string, setter: (v: string) => void) => {
             // If currently selected week is valid, keep it.
             if (currentVal && activeWeeks.find(w => w.id === currentVal)) return;

             // Otherwise, try to select "Current Week" (Today)
             const matchToday = activeWeeks.find(w => w.id === currentKey);
             if (matchToday) {
                 setter(currentKey);
             } else {
                 // Fallback to the latest week
                 setter(activeWeeks[activeWeeks.length - 1].id);
             }
          };

          resolveWeek(matchListWeek, setMatchListWeek);
          resolveWeek(leaderboardWeek, setLeaderboardWeek);
      }
  }, [activeWeeks]); // Intentionally exclude matchListWeek/leaderboardWeek from deps to avoid reset loops

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
        safeStorage.setItem('dugout_active_match_id', newMatch.id);
        
        setSelectedHomeId(''); setSelectedAwayId(''); setLoading(false);
        setState({ ...state, view: 'scoring', currentMatchId: newMatch.id });
    } catch (e) { alert("Error starting match: " + e); setLoading(false); }
  };

  const handleDeleteMatch = async (matchId: string) => {
    if (!confirm("Are you sure you want to delete this match? This cannot be undone.")) return;
    try {
        setLoading(true);
        if (safeStorage.getItem('dugout_active_match_id') === matchId) {
            safeStorage.removeItem('dugout_active_match_id');
        }
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

  const handleOpenMatchStats = async (match: Match) => {
      let home = teams.find(t => t.id === match.homeTeamId);
      let away = teams.find(t => t.id === match.awayTeamId);
      if (!home || !away) {
          try {
              const allTeams = await storage.getAllTeams();
              if (!home) home = allTeams.find(t => t.id === match.homeTeamId);
              if (!away) away = allTeams.find(t => t.id === match.awayTeamId);
          } catch (e) {}
      }
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
      // Removed automatic redirection to Admin Dashboard for Admins
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
        className={`px-1 sm:px-4 py-2 sm:py-3 cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors select-none ${align} ${colorClass} text-[10px] sm:text-xs`}
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
      // Find the selected week object, or default to nothing
      const targetWeek = activeWeeks.find(w => w.id === leaderboardWeek);
      const targetMatches = targetWeek ? targetWeek.matches : [];
      
      const relevantMatches = targetMatches.filter(m => m.isComplete);

      // Track unique players by ID to ensure they only appear once with their best score
      const uniqueTotals = new Map<string, { name: string, team: string, score: number }>();
      const uniqueInnings = new Map<string, { name: string, team: string, score: number }>();

      relevantMatches.forEach(m => {
          const home = teams.find(t => t.id === m.homeTeamId);
          const away = teams.find(t => t.id === m.awayTeamId);
          if (!home || !away) return;

          // 1. Calculate Match Totals Manually (Strict 10-pitch limit for Ghost Mode)
          const matchPlayerTotals = new Map<string, number>();

          // Process Innings
          (m.innings || []).forEach(ing => {
              [ing.home, ing.away].forEach(side => {
                   if (!side?.playerScores) return;
                   const isGhostMode = side.playerScores.length === 2 && (side.playerScores[0]?.pitches?.length || 0) >= 15;
                   side.playerScores.forEach(ps => {
                       if (!ps || ps.playerId.startsWith('ghost-')) return;
                       
                       let pitchesToCount = ps.pitches || [];
                       // Strictly slice first 10 for individual stats in Ghost Mode
                       if (isGhostMode && pitchesToCount.length > 10) {
                           pitchesToCount = pitchesToCount.slice(0, 10);
                       }
                       
                       const pts = pitchesToCount.reduce((sum, p) => sum + (p?.points || 0), 0);
                       matchPlayerTotals.set(ps.playerId, (matchPlayerTotals.get(ps.playerId) || 0) + pts);
                   });
              });
          });

          // Process Tie Breakers (No ghost mode in tie breakers usually, but standard addition)
          if (m.tieBreaker && Array.isArray(m.tieBreaker)) {
              m.tieBreaker.forEach(tb => {
                  const addTbScore = (pid: string, scores: (number|null)[]) => {
                      if (!Array.isArray(scores)) return;
                      const pts = scores.reduce((sum, s) => sum + (s || 0), 0);
                      matchPlayerTotals.set(pid, (matchPlayerTotals.get(pid) || 0) + pts);
                  };
                  if (tb.homePlayerId) addTbScore(tb.homePlayerId, tb.homeScores);
                  if (tb.awayPlayerId) addTbScore(tb.awayPlayerId, tb.awayScores);
              });
          }

          // Update Leaderboard with this Match's Totals
          matchPlayerTotals.forEach((totalScore, playerId) => {
               // Find player info
               let player = [...(home.players || []), ...(home.subs || [])].find(p => p.id === playerId);
               let teamName = home.name;
               if (!player) {
                   player = [...(away.players || []), ...(away.subs || [])].find(p => p.id === playerId);
                   teamName = away.name;
               }

               if (player) {
                   const fullName = `${player.name}${player.lastName ? ' ' + player.lastName[0] + '.' : ''}`;
                   // Check if this is the best score for this player so far
                   const existing = uniqueTotals.get(playerId);
                   if (!existing || totalScore > existing.score) {
                       uniqueTotals.set(playerId, { name: fullName, team: teamName, score: totalScore });
                   }
               }
          });

          // 2. Best Inning (Existing Logic - ensure consistency)
          (m.innings || []).forEach(ing => {
              [ing.home, ing.away].forEach((side, sideIdx) => {
                  if (!side?.playerScores) return;
                  const team = sideIdx === 0 ? home : away;
                  const isGhostMode = side.playerScores.length === 2 && (side.playerScores[0]?.pitches?.length || 0) >= 15;

                  side.playerScores.forEach(ps => {
                      if (!ps || ps.playerId.startsWith('ghost-')) return;

                      const p = [...(team.players || []), ...(team.subs || [])].find(x => x.id === ps.playerId);
                      if (p) {
                          let pitchesToCount = ps.pitches || [];
                          if (isGhostMode && pitchesToCount.length > 10) {
                              pitchesToCount = pitchesToCount.slice(0, 10);
                          }
                          const score = pitchesToCount.reduce((sum, v) => sum + (v?.points || 0), 0);
                          
                          const existing = uniqueInnings.get(p.id);
                          if (!existing || score > existing.score) {
                              const fullName = `${p.name}${p.lastName ? ' ' + p.lastName[0] + '.' : ''}`;
                              uniqueInnings.set(p.id, { name: fullName, team: team.name, score });
                          }
                      }
                  });
              });
          });
      });

      return {
          topTotals: Array.from(uniqueTotals.values()).sort((a, b) => b.score - a.score).slice(0, 5),
          topInnings: Array.from(uniqueInnings.values()).sort((a, b) => b.score - a.score).slice(0, 5)
      };
  }, [matches, teams, leaderboardWeek, activeWeeks]);

  const weeklyStats = useMemo(() => calculateWeeklyLeaders(), [calculateWeeklyLeaders]);
  const visibleMatches = useMemo(() => {
      const w = activeWeeks.find(w => w.id === matchListWeek);
      return w ? w.matches : [];
  }, [activeWeeks, matchListWeek]);

  const leagueTeams = teams.filter(t => t.league === state.currentLeague);

  // --- NEW: Standings Calculation ---
  const standings = useMemo(() => {
    if (!state.currentLeague) return [];
    
    // Initialize stats for all teams in the current league
    const stats = new Map<string, { id: string, name: string, gp: number, w: number, l: number, t: number, pf: number, pa: number }>();
    leagueTeams.forEach(t => {
      stats.set(t.id, { id: t.id, name: t.name, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    });

    matches.forEach(m => {
      if (!m.isComplete) return;
      
      const getScore = (innings: Inning[], side: 'home' | 'away', tb?: TieBreakerRound[]) => {
         let score = (innings || []).reduce((acc, ing) => {
             const team = side === 'home' ? ing?.home : ing?.away;
             if (!team?.playerScores) return acc;
             return acc + team.playerScores.reduce((pAcc, p) => pAcc + (p?.pitches || []).reduce((piAcc, pi) => piAcc + (pi?.points || 0), 0), 0);
         }, 0);
         if(tb && Array.isArray(tb)) {
             tb.forEach(r => {
                 const rScore = side === 'home' ? r?.homeScores : r?.awayScores;
                 if (Array.isArray(rScore)) {
                     score += rScore.reduce((a,b) => a + (b||0), 0);
                 }
             });
         }
         return score;
      };

      const hScore = getScore(m.innings, 'home', m.tieBreaker);
      const aScore = getScore(m.innings, 'away', m.tieBreaker);

      const update = (id: string, s: number, os: number) => {
          if (!stats.has(id)) return;
          const rec = stats.get(id)!;
          rec.gp++;
          rec.pf += s;
          rec.pa += os;
          if (s > os) rec.w++;
          else if (s < os) rec.l++;
          else rec.t++;
      };
      
      update(m.homeTeamId, hScore, aScore);
      update(m.awayTeamId, aScore, hScore);
    });

    return Array.from(stats.values()).sort((a, b) => {
        if (a.w !== b.w) return b.w - a.w;
        if (a.t !== b.t) return b.t - a.t;
        if (a.pf !== b.pf) return b.pf - a.pf;
        return a.pa - b.pa;
    });
  }, [matches, leagueTeams, state.currentLeague]);

  // --- NEW: Season Stats Calculation ---
  const seasonStats = useMemo(() => {
      if (!state.currentLeague) return [];
      const aggStats = new Map<string, PlayerStats>();
      
      matches.forEach(m => {
          if (!m.isComplete) return;
          const home = teams.find(t => t.id === m.homeTeamId);
          const away = teams.find(t => t.id === m.awayTeamId);
          if (!home || !away) return;
          
          const mStats = storage.calculateMatchStats(m, home, away);
          mStats.forEach(s => {
              if (s.playerId.startsWith('ghost-')) return;
              if (!aggStats.has(s.playerId)) {
                  aggStats.set(s.playerId, { ...s });
              } else {
                  const curr = aggStats.get(s.playerId)!;
                  curr.totalPoints += s.totalPoints;
                  curr.hits4 += s.hits4;
                  curr.hits3 += s.hits3;
                  curr.hits2 += s.hits2;
                  curr.hits1 += s.hits1;
                  curr.pitchesSeen += s.pitchesSeen;
              }
          });
      });
      return Array.from(aggStats.values());
  }, [matches, teams, state.currentLeague]);


  const navbarProps = {
      currentLeague: state.currentLeague,
      currentSeason: state.season,
      leagues: leagues,
      userRole: userRole,
      showLeagueHomeButton: state.view !== 'dashboard' && !!state.currentLeague,
      onGoHome: () => setState({ ...state, view: 'league_select', currentLeague: null, currentMatchId: null }),
      onSwitchLeague: () => setState({ ...state, view: 'league_select', currentLeague: null, currentMatchId: null }),
      onSelectLeague: handleSelectLeague,
      onLogin: openLoginModal,
      onLogout: handleLogout,
      onAdminDashboard: openAdminDashboard,
      onSeasonChange: handleSeasonChange,
      isDarkMode: isDarkMode,
      toggleTheme: () => setIsDarkMode(!isDarkMode),
      isMenuOpen: isMenuOpen,
      setMenuOpen: setIsMenuOpen,
  };
  
  // Helper to get total scores for display
  const getMatchScores = (m: Match) => {
      const getSideScore = (side: 'home' | 'away') => {
          let total = 0;
          (m.innings || []).forEach(ing => {
              const teamData = side === 'home' ? ing?.home : ing?.away;
              if (teamData?.playerScores) {
                  teamData.playerScores.forEach(p => {
                      (p.pitches || []).forEach(pt => {
                          if (pt && pt.points !== null) total += pt.points;
                      });
                  });
              }
          });
          if (m.tieBreaker && Array.isArray(m.tieBreaker)) {
              m.tieBreaker.forEach(tb => {
                  const scores = side === 'home' ? tb?.homeScores : tb?.awayScores;
                  if (Array.isArray(scores)) {
                      scores.forEach(s => { if(s !== null) total += s; });
                  }
              });
          }
          return total;
      };
      return { home: getSideScore('home'), away: getSideScore('away') };
  };

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-200 flex flex-col font-sans relative transition-colors duration-500">
        {/* Background Texture */}
        <div className="absolute inset-0 opacity-[0.4] dark:opacity-[0.03] pointer-events-none z-0 mix-blend-overlay dark:mix-blend-normal h-full w-full" 
             style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 20l20 20M20 20L0 40M20 20L40 0M20 20L0 0' stroke='%23888888' stroke-width='1' fill='none'/%3E%3C/svg%3E")` }}>
        </div>

        {/* Active Match In-Progress Resume Prompt Banner */}
        {resumeMatch && state.view !== 'scoring' && (
            <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between text-xs font-bold font-sans z-[1100] relative shadow-md">
                <div className="flex items-center gap-2 truncate pr-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                    <span className="truncate">Active Match in Progress: {resumeMatch.awayTeamName} vs {resumeMatch.homeTeamName} (Inning {resumeMatch.inningNumber})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button 
                        onClick={handleResumeActiveMatch} 
                        className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                    >
                        Resume Match
                    </button>
                    <button 
                        onClick={handleDismissResumeMatch} 
                        className="px-2 py-1 bg-blue-700/60 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                        title="Dismiss banner"
                        aria-label="Dismiss banner"
                    >
                        ✕
                    </button>
                </div>
            </div>
        )}

        {/* Archive Banner (Shown when viewing 2025 Historical Records) */}
        {state.season !== '2026' && (
            <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 flex items-center justify-between text-xs font-bold font-sans z-[1100] relative">
                <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                    <span>ARCHIVE MODE: Viewing {state.season} Season History (Historical Data)</span>
                </div>
                <button 
                    onClick={() => setState(s => ({ ...s, season: '2026', currentLeague: null, view: 'league_select' }))} 
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
                >
                    Return to 2026 Season
                </button>
            </div>
        )}
        
        {/* Scrollable Main Content Area */}
        <main className="relative flex-1 w-full overflow-y-auto overflow-x-hidden scroll-touch">
            {/* Fixed Header / Navbar - moved inside scrollable area so it scrolls away */}
            {state.view !== 'league_select' && <Navbar {...navbarProps} />}

            {/* LEAGUE SELECTION VIEW */}
            {state.view === 'league_select' && (
                <>
                    <Navbar {...navbarProps} />
                    <div className="flex-1 flex flex-col items-center justify-center p-4 z-10 min-h-[calc(100dvh-80px)]">
                        <div className="text-center mb-16">
                            <h2 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white mb-4 font-sans tracking-tight drop-shadow-xl">SELECT A LEAGUE</h2>
                            <div className="h-1.5 w-24 bg-blue-600 mx-auto rounded-full mb-6 shadow-[0_0_15px_rgba(37,99,235,0.8)]"></div>
                            {userRole !== 'fan' && (
                                <span className="inline-block bg-white/50 dark:bg-slate-800/80 backdrop-blur text-blue-600 dark:text-blue-300 border border-slate-200 dark:border-slate-700 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg">
                                    Logged in as {userRole}
                                </span>
                            )}
                        </div>
                        
                        {leagues.length === 0 ? (
                            <div className="text-center bg-white/80 dark:bg-slate-900/80 backdrop-blur p-8 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full shadow-2xl">
                                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <svg className="w-8 h-8 text-slate-400 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                </div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">No 2026 Leagues Found</h3>
                                <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">The 2026 season is ready. Create your first league category to begin.</p>
                                {userRole === 'admin' ? (
                                    <button onClick={() => setState(s => ({ ...s, view: 'admin' }))} className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">Go to Admin to Create Leagues</button>
                                ) : (
                                    <button onClick={openLoginModal} className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">Log In to Admin</button>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-wrap justify-center gap-4 w-full max-w-5xl px-4 pb-8">
                            {leagues.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })).map(league => (
                                <button key={league.id} onClick={() => handleSelectLeague(league.id)} className="group relative bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 p-0.5 rounded-xl shadow-xl dark:shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-blue-500/20 dark:hover:shadow-blue-900/20 text-left w-32 sm:w-36 flex flex-col border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500/50">
                                    <div className="absolute inset-0 bg-gradient-to-b from-blue-400/0 to-blue-600/0 dark:from-blue-600/0 dark:to-blue-900/0 group-hover:to-blue-100/50 dark:group-hover:to-blue-900/20 rounded-xl transition-all duration-500"></div>
                                    
                                    <div className="h-full w-full rounded-lg p-3 flex flex-col justify-between relative overflow-hidden min-h-[100px]">
                                        <div className="absolute -top-2 -right-2 text-slate-200 dark:text-slate-800/40 group-hover:text-blue-100 dark:group-hover:text-blue-600/10 transition-all duration-700 rotate-[15deg] scale-125">
                                            <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10" />
                                                <path d="M6 4.5C8.5 7.5 9 10.5 9 12s-.5 4.5-3 7.5" />
                                                <path d="M18 4.5C15.5 7.5 15 10.5 15 12s.5 4.5 3 7.5" />
                                            </svg>
                                        </div>
                                        
                                        <div className="relative z-10">
                                            <div className="flex justify-between items-start">
                                                <span className="inline-block px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 text-[8px] font-bold uppercase tracking-wider border border-slate-200 dark:border-slate-800 group-hover:border-blue-400 group-hover:text-blue-500 transition-colors">{state.season}</span>
                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></span>
                                            </div>
                                        </div>
                                        
                                        <div className="relative z-10 mt-4 text-center">
                                            <h3 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white uppercase italic leading-none mb-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors drop-shadow-sm truncate">{league.id}</h3>
                                        </div>
                                    </div>
                                </button>
                            ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ADMIN VIEW */}
            {state.view === 'admin' && (
                <div className="flex-1 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-full">
                    <AdminDashboard 
                        onBack={() => setState({ ...state, view: 'league_select' })} 
                        onBrowseArchive={(archiveSeason) => setState(s => ({ ...s, season: archiveSeason, view: 'league_select', currentLeague: null }))} 
                    />
                </div>
            )}

            {/* MATCH SETUP VIEW */}
            {state.view === 'match_setup' && state.currentLeague && (() => {
                const homeTeam = teams.find(t => t.id === selectedHomeId);
                const awayTeam = teams.find(t => t.id === selectedAwayId);
                if (!homeTeam || !awayTeam) {
                    return (
                        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center font-sans">
                            <p className="text-slate-600 dark:text-slate-300 font-bold mb-4">Teams not found or still loading.</p>
                            <button onClick={() => setState({ ...state, view: 'dashboard' })} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
                                Return to Dashboard
                            </button>
                        </div>
                    );
                }
                return (
                    <div className="flex-1 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-full">
                        <MatchSetup homeTeam={homeTeam} awayTeam={awayTeam} onStart={handleStartGame} onCancel={() => setState({ ...state, view: 'dashboard' })} />
                    </div>
                );
            })()}

            {/* SCORING VIEW */}
            {state.view === 'scoring' && state.currentMatchId && (
                <div className="flex-1 bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-full overflow-hidden">
                    <Scoreboard matchId={state.currentMatchId} onExit={() => setState({ ...state, view: 'dashboard', currentMatchId: null })} isReadOnly={userRole === 'fan'} userRole={userRole} />
                </div>
            )}

            {/* TEAM MANAGEMENT VIEW - Admin Only */}
            {state.view === 'team_management' && state.currentLeague && (
                <div className="flex-1 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-full">
                    {userRole === 'admin' ? (
                        <TeamManagement league={state.currentLeague} season={state.season} onBack={() => setState({ ...state, view: 'dashboard' })} />
                    ) : (
                        <div className="p-8 text-center font-sans max-w-md mx-auto my-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Admin Only Access</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Team management and rosters are restricted to league administrators.</p>
                            <button onClick={() => setState({ ...state, view: 'dashboard' })} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-md shadow-blue-900/20 text-sm">Return to Dashboard</button>
                        </div>
                    )}
                </div>
            )}

            {/* MAIN DASHBOARD VIEW */}
            {state.view === 'dashboard' && (
                <div className="max-w-7xl mx-auto p-2 sm:p-6 w-full pb-20">
                    <div className={`grid grid-cols-1 ${userRole !== 'fan' ? 'lg:grid-cols-3' : ''} gap-4 sm:gap-8`}>
                        
                        {userRole !== 'fan' && (
                        <div className="space-y-4 sm:space-y-6">
                            {/* Manage Teams Box - Admin Only */}
                            {userRole === 'admin' && (
                                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-2 sm:p-4 rounded-xl shadow-lg border border-white/20 dark:border-slate-800">
                                    <h2 className="text-sm sm:text-base font-bold text-slate-600 dark:text-slate-300 mb-2 font-sans">League Status ({state.season})</h2>
                                    <div className="flex justify-between text-center"><div><div className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white font-sans tabular-nums">{leagueTeams.length}</div><div className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold font-sans">Teams</div></div></div>
                                    <div className="flex gap-2 mt-3">
                                        <button onClick={() => setState({ ...state, view: 'team_management' })} className="flex-1 py-1.5 sm:py-2 px-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-bold rounded-lg transition-colors font-sans border border-slate-300 dark:border-slate-700 text-xs sm:text-sm">Manage Rosters</button>
                                        <button onClick={() => setShowDashboardImport(true)} className="py-1.5 sm:py-2 px-3 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-bold rounded-lg transition-colors font-sans border border-blue-200 dark:border-blue-800 text-xs sm:text-sm flex items-center gap-1">⚡ Import</button>
                                    </div>
                                </div>
                            )}

                            {/* Start New Match Box - Shows action card if < 2 teams */}
                            {leagueTeams.length >= 2 ? (
                                <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-4 sm:p-8 rounded-xl shadow-xl text-white border border-blue-500/30">
                                    <h2 className="text-base sm:text-2xl font-bold mb-2 sm:mb-6 font-sans">Start New Match</h2>
                                    <div className="space-y-2 sm:space-y-4">
                                        <select className="w-full p-2.5 sm:p-4 rounded-lg text-slate-900 bg-white font-bold font-sans text-xs sm:text-base border border-slate-200" value={selectedAwayId} onChange={(e) => setSelectedAwayId(e.target.value)}>
                                            <option value="">Select Away Team...</option>
                                            {leagueTeams.map(t => <option key={t.id} value={t.id} disabled={t.id === selectedHomeId}>{t.name}</option>)}
                                        </select>
                                        <select className="w-full p-2.5 sm:p-4 rounded-lg text-slate-900 bg-white font-bold font-sans text-xs sm:text-base border border-slate-200" value={selectedHomeId} onChange={(e) => setSelectedHomeId(e.target.value)}>
                                            <option value="">Select Home Team...</option>
                                            {leagueTeams.map(t => <option key={t.id} value={t.id} disabled={t.id === selectedAwayId}>{t.name}</option>)}
                                        </select>
                                        <button disabled={!selectedHomeId || !selectedAwayId} onClick={() => setState({ ...state, view: 'match_setup' })} className="w-full bg-white text-blue-700 font-bold py-2.5 sm:py-5 rounded-xl mt-2 sm:mt-6 hover:bg-blue-50 disabled:opacity-50 transition-all font-sans shadow-lg text-sm sm:text-xl transform active:scale-95">Next: Set Lineup</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-5 sm:p-6 rounded-xl shadow-lg border border-white/20 dark:border-slate-800 text-center">
                                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                    </div>
                                    <h3 className="text-base font-bold text-slate-800 dark:text-white mb-1 font-sans">{userRole === 'admin' ? 'Ready for Teams' : 'Awaiting Teams'}</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 font-sans">
                                        {userRole === 'admin' 
                                            ? `You need at least 2 teams in ${state.currentLeague} to start matches.` 
                                            : `The league administrator must register teams in ${state.currentLeague} before matches can begin.`}
                                    </p>
                                    {userRole === 'admin' ? (
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <button onClick={() => setState({ ...state, view: 'team_management' })} className="flex-1 py-3 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-md shadow-blue-900/20 text-xs sm:text-sm font-sans">
                                                + Add Teams
                                            </button>
                                            <button onClick={() => setShowDashboardImport(true)} className="py-3 px-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold rounded-xl transition-all text-xs sm:text-sm font-sans flex items-center justify-center gap-1.5">
                                                <span>⚡ Import</span>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-[11px] text-slate-400 dark:text-slate-500 italic font-sans py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
                                            Teams will appear here once configured by the admin.
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="text-center">
                                <span className="bg-white/50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider font-sans border border-slate-200 dark:border-slate-700">Role: {userRole}</span>
                                <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-400 ml-2 underline font-sans">Log Out</button>
                            </div>
                        </div>
                        )}

                        <div className={`${userRole !== 'fan' ? 'lg:col-span-2' : 'col-span-1'}`}>
                            <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-xl shadow-xl p-3 sm:p-6 mb-6 sm:mb-8 text-white border border-indigo-500/30 relative overflow-hidden">
                                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-center mb-3 sm:mb-4 border-b border-white/20 pb-2">
                                        <h3 className="font-bold text-white/90 uppercase tracking-wider text-xs sm:text-sm font-sans flex items-center gap-2">
                                            <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
                                            Weekly Leaders ({state.currentLeague})
                                        </h3>
                                        <select 
                                            value={leaderboardWeek} 
                                            onChange={(e) => setLeaderboardWeek(e.target.value)}
                                            className="bg-black/30 text-white text-[10px] sm:text-xs font-bold rounded px-2 py-1 border border-white/20 outline-none hover:bg-black/50 transition-colors"
                                        >
                                            {activeWeeks.length > 0 ? activeWeeks.map(w => <option key={w.id} value={w.id}>{w.label}</option>) : <option>No Data</option>}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
                                        <div>
                                            <h4 className="font-bold text-sm sm:text-lg mb-2 font-sans text-indigo-100">Best Total Score</h4>
                                            {weeklyStats.topTotals.length > 0 ? (
                                                <ul className="space-y-1 sm:space-y-2">
                                                    {weeklyStats.topTotals.map((s, idx) => (
                                                        <li key={idx} className="flex justify-between items-center bg-black/20 p-1 sm:p-2 rounded border border-white/5 hover:bg-black/30 transition-colors">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold bg-white text-indigo-600 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-sans shadow tabular-nums">{idx+1}</span>
                                                                <span className="font-semibold font-sans text-xs sm:text-base">{s.name}</span>
                                                                <span className="text-[10px] sm:text-xs text-white/60 font-sans">({s.team})</span>
                                                            </div>
                                                            <span className="font-sans tabular-nums font-bold text-base sm:text-xl">{s.score}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : <p className="text-white/40 italic text-sm font-sans">No matches in selected week.</p>}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-sm sm:text-lg mb-2 font-sans text-purple-100">Best Single Inning</h4>
                                            {weeklyStats.topInnings.length > 0 ? (
                                                <ul className="space-y-1 sm:space-y-2">
                                                    {weeklyStats.topInnings.map((s, idx) => (
                                                        <li key={idx} className="flex justify-between items-center bg-black/20 p-1 sm:p-2 rounded border border-white/5 hover:bg-black/30 transition-colors">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold bg-white text-purple-600 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-sans shadow tabular-nums">{idx+1}</span>
                                                                <span className="font-semibold font-sans text-xs sm:text-base">{s.name}</span>
                                                                <span className="text-[10px] sm:text-xs text-white/60 font-sans">({s.team})</span>
                                                            </div>
                                                            <span className="font-sans tabular-nums font-bold text-base sm:text-xl">{s.score}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : <p className="text-white/40 italic text-sm font-sans">No matches in selected week.</p>}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 sm:gap-6 mb-4 sm:mb-6 border-b border-slate-200 dark:border-slate-800 pb-1 overflow-x-auto touch-auto">
                                <button onClick={() => setState(prev => ({ ...prev, dashboardTab: 'matches' }))} className={`text-base sm:text-xl font-bold pb-2 px-2 transition-all border-b-2 whitespace-nowrap font-sans ${state.dashboardTab === 'matches' ? 'text-blue-600 dark:text-blue-400 border-blue-500 drop-shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'text-slate-500 border-transparent hover:text-slate-800 dark:hover:text-slate-300 hover:border-slate-400 dark:hover:border-slate-700'}`}>Matches</button>
                                <button onClick={() => setState(prev => ({ ...prev, dashboardTab: 'standings' }))} className={`text-base sm:text-xl font-bold pb-2 px-2 transition-all border-b-2 whitespace-nowrap font-sans ${state.dashboardTab === 'standings' ? 'text-blue-600 dark:text-blue-400 border-blue-500 drop-shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'text-slate-500 border-transparent hover:text-slate-800 dark:hover:text-slate-300 hover:border-slate-400 dark:hover:border-slate-700'}`}>Standings</button>
                                <button onClick={() => setState(prev => ({ ...prev, dashboardTab: 'season_stats' }))} className={`text-base sm:text-xl font-bold pb-2 px-2 transition-all border-b-2 whitespace-nowrap font-sans ${state.dashboardTab === 'season_stats' ? 'text-blue-600 dark:text-blue-400 border-blue-500 drop-shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'text-slate-500 border-transparent hover:text-slate-800 dark:hover:text-slate-300 hover:border-slate-400 dark:hover:border-slate-700'}`}>Season Stats</button>
                            </div>

                            {state.dashboardTab === 'matches' && (
                                <div className="space-y-3 sm:space-y-4">
                                    {/* Weekly Dropdown for Matches */}
                                    {activeWeeks.length > 0 && (
                                        <div className="mb-4">
                                            <div className="relative inline-block w-full sm:w-64">
                                                <select
                                                    value={matchListWeek}
                                                    onChange={(e) => setMatchListWeek(e.target.value)}
                                                    className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold py-2.5 pl-4 pr-10 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans cursor-pointer text-sm sm:text-base transition-colors"
                                                >
                                                    {activeWeeks.map(week => (
                                                        <option key={week.id} value={week.id}>{week.label}</option>
                                                    ))}
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 dark:text-slate-400">
                                                    <svg className="fill-current h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {visibleMatches.map(match => {
                                        const home = teams.find(t => t.id === match.homeTeamId);
                                        const away = teams.find(t => t.id === match.awayTeamId);
                                        const homeName = home?.name || 'Home Team';
                                        const awayName = away?.name || 'Away Team';
                                        
                                        const { home: homeScore, away: awayScore } = getMatchScores(match);

                                        return (
                                            <div key={match.id} className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-2.5 sm:p-5 rounded-xl shadow-md dark:shadow-sm border border-white/20 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4 hover:bg-white/80 dark:hover:bg-slate-800/50 transition-colors group">
                                                <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto min-w-0">
                                                    <div className="shrink-0"><div className={`text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded font-sans border ${match.isComplete ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-500/30 animate-pulse'}`}>{match.isComplete ? 'FINAL' : 'LIVE'}</div></div>
                                                    
                                                    <div className="flex flex-1 sm:flex-auto items-center justify-between sm:justify-start sm:gap-6 w-full sm:w-auto min-w-0">
                                                        {/* Away Team (Left) */}
                                                        <div className="flex-1 sm:flex-none sm:w-32 text-right sm:text-left min-w-0">
                                                            <div className="text-[9px] sm:text-lg font-bold text-blue-700 dark:text-blue-400 font-sans break-words whitespace-normal leading-tight">{awayName}</div>
                                                            <div className="text-[8px] sm:text-[10px] font-bold uppercase text-slate-400">Away</div>
                                                        </div>
                                                        
                                                        {/* Score Center */}
                                                        <div className="shrink-0 flex items-center justify-center gap-2 px-2 min-w-[60px]">
                                                            <span className="text-xl sm:text-3xl font-black text-slate-800 dark:text-white tabular-nums tracking-tight">{awayScore}</span>
                                                            <span className="text-slate-300 dark:text-slate-600 text-lg font-light">-</span>
                                                            <span className="text-xl sm:text-3xl font-black text-slate-800 dark:text-white tabular-nums tracking-tight">{homeScore}</span>
                                                        </div>

                                                        {/* Home Team (Right) */}
                                                        <div className="flex-1 sm:flex-none sm:w-32 text-left sm:text-right min-w-0">
                                                            <div className="text-[9px] sm:text-lg font-bold text-red-700 dark:text-red-400 font-sans break-words whitespace-normal leading-tight">{homeName}</div>
                                                            <div className="text-[8px] sm:text-[10px] font-bold uppercase text-slate-400">Home</div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 w-full sm:w-auto justify-end shrink-0">
                                                <button onClick={() => handleOpenMatchStats(match)} className="flex-1 sm:flex-none text-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500/50 font-bold text-xs sm:text-sm transition-all font-sans">Stats</button>
                                                
                                                <button onClick={() => {
                                                    if (!match.isComplete && userRole !== 'fan') {
                                                        safeStorage.setItem('dugout_active_match_id', match.id);
                                                    }
                                                    setState({ ...state, view: 'scoring', currentMatchId: match.id });
                                                }} className="flex-1 sm:flex-none text-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white font-bold text-xs sm:text-sm transition-all font-sans">
                                                    {userRole === 'fan' ? (match.isComplete ? 'View' : 'Watch Live') : (match.isComplete ? 'View' : 'Score')}
                                                </button>
                                                
                                                {userRole === 'admin' && (
                                                    <div className="flex gap-2">
                                                        <button onClick={() => setMoveMatchModal({ matchId: match.id, currentLeague: match.league })} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-transparent text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 font-bold text-xs sm:text-sm transition-all font-sans" title="Move to another league">Move</button>
                                                        <button onClick={() => handleDeleteMatch(match.id)} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-transparent text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-400 dark:hover:border-red-500/50 font-bold text-xs sm:text-sm transition-all font-sans">Del</button>
                                                    </div>
                                                )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {visibleMatches.length === 0 && <div className="text-center py-12 text-slate-500 bg-white/40 dark:bg-slate-900/30 rounded-xl border border-slate-300 dark:border-slate-800 border-dashed font-sans">No matches found for this week.</div>}
                                </div>
                            )}

                            {state.dashboardTab === 'standings' && (
                                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-xl shadow-md border border-white/20 dark:border-slate-800 overflow-hidden">
                                  <div className="overflow-x-auto">
                                      <table className="w-full text-left text-sm">
                                          <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase border-b border-slate-200 dark:border-slate-800">
                                              <tr>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center w-8 sm:w-12 text-[10px] sm:text-xs">#</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-xs">Team</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-xs">GP</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-xs">W</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-xs">L</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-xs">T</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-xs">PF</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-xs">PA</th>
                                                  <th className="px-1 sm:px-4 py-2 sm:py-3 text-center hidden sm:table-cell text-[10px] sm:text-xs">Diff</th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                              {standings.map((t, i) => (
                                                  <tr key={t.id} className="hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center font-bold text-slate-400 dark:text-slate-500 text-xs sm:text-sm">{i + 1}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 font-bold text-slate-900 dark:text-white text-xs sm:text-base">{t.name}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center text-slate-600 dark:text-slate-300 font-bold text-xs sm:text-sm">{t.gp}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center font-bold text-green-600 dark:text-green-500 bg-green-50 dark:bg-green-900/10 text-xs sm:text-sm">{t.w}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center text-slate-500 dark:text-slate-400 text-xs sm:text-sm">{t.l}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center text-slate-500 dark:text-slate-400 text-xs sm:text-sm">{t.t}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center font-bold text-blue-600 dark:text-blue-400 tabular-nums text-xs sm:text-sm">{t.pf}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center text-slate-500 dark:text-slate-400 tabular-nums text-xs sm:text-sm">{t.pa}</td>
                                                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center hidden sm:table-cell font-bold tabular-nums text-slate-500 text-xs sm:text-sm">{t.pf - t.pa}</td>
                                                  </tr>
                                              ))}
                                              {standings.length === 0 && (
                                                  <tr><td colSpan={9} className="p-8 text-center text-slate-500 italic">No standings available yet.</td></tr>
                                              )}
                                          </tbody>
                                      </table>
                                  </div>
                                </div>
                            )}

                            {state.dashboardTab === 'season_stats' && (
                                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-xl shadow-md border border-white/20 dark:border-slate-800 overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
                                                <tr>
                                                    {renderSortHeader('Player', 'name', seasonSort, setSeasonSort, 'text-left', 'px-2 sm:px-6')}
                                                    {renderSortHeader('Pts', 'totalPoints', seasonSort, setSeasonSort)}
                                                    {renderSortHeader('4s', 'hits4', seasonSort, setSeasonSort, 'text-right', 'text-rose-600 dark:text-rose-500')}
                                                    {renderSortHeader('3s', 'hits3', seasonSort, setSeasonSort, 'text-right', 'text-amber-600 dark:text-amber-500')}
                                                    {renderSortHeader('2s', 'hits2', seasonSort, setSeasonSort, 'text-right', 'text-green-600 dark:text-green-500')}
                                                    {renderSortHeader('1s', 'hits1', seasonSort, setSeasonSort, 'text-right', 'text-cyan-600 dark:text-cyan-500')}
                                                    {renderSortHeader('Pit', 'pitchesSeen', seasonSort, setSeasonSort, 'text-right', 'text-slate-500')}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                                                {performSort(seasonStats, seasonSort).map(stat => (
                                                    <tr key={stat.playerId} className="hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                                                        <td className="px-2 sm:px-6 py-2 sm:py-3 font-bold text-slate-900 dark:text-white font-sans text-xs sm:text-base">{stat.name}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums font-bold text-sm sm:text-lg text-slate-900 dark:text-white">{stat.totalPoints}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits4}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits3}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits2}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits1}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-slate-500 text-[10px] sm:text-sm">{stat.pitchesSeen}</td>
                                                    </tr>
                                                ))}
                                                {seasonStats.length === 0 && (
                                                  <tr><td colSpan={7} className="p-8 text-center text-slate-500 italic">No player stats recorded yet.</td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </main>
        {/* Modals (Login, Move Match, Stats) rendered here - Code unchanged */}
        {showLoginModal && createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowLoginModal(false)}>
            <div className="bg-slate-900 p-8 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-700" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-white mb-4 text-center font-sans">Access Control</h3>
              <p className="text-sm text-slate-400 mb-4 text-center font-sans">Enter password for Umpire or Admin access.</p>
              <form onSubmit={handleLoginSubmit}>
                <div className="mb-4">
                  <input type="password" autoFocus className={`w-full bg-slate-950 border rounded-lg px-4 py-3 text-lg outline-none focus:ring-2 text-white placeholder-slate-600 font-sans ${loginError ? 'border-red-500 focus:ring-red-900' : 'border-slate-700 focus:ring-blue-900'}`} value={passwordInput} onChange={e => setPasswordInput(e.target.value)} placeholder="Password" />
                  {loginError && <p className="text-red-500 text-xs mt-2 font-bold font-sans">{loginError}</p>}
                </div>
                <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-500 transition-colors font-sans shadow-lg shadow-blue-900/20">{loading ? 'Verifying...' : 'Log In'}</button>
              </form>
            </div>
          </div>,
          document.body
        )}

        {moveMatchModal && createPortal(
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setMoveMatchModal(null)}>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-md transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2 text-center font-sans">Move Match to Another League</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 text-center font-sans">Select the destination league. Stats will transfer automatically.</p>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Destination League</label>
                            <select 
                                className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 rounded-lg font-bold text-slate-800 dark:text-white font-sans"
                                value={targetLeague}
                                onChange={e => setTargetLeague(e.target.value)}
                            >
                                <option value="">Select League...</option>
                                {leagues.filter(l => l.id !== moveMatchModal.currentLeague).map(l => (
                                    <option key={l.id} value={l.id}>{l.id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setMoveMatchModal(null)} className="flex-1 py-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold font-sans hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleMoveMatch} disabled={!targetLeague} className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold font-sans hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-lg shadow-blue-900/20">Move Match</button>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {statsModalMatch && createPortal(
            <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setStatsModalMatch(null)}>
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white font-sans">Match Statistics</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">{new Date(statsModalMatch.date).toLocaleDateString()}</p>
                        </div>
                        <button onClick={() => setStatsModalMatch(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white font-bold text-xl transition-colors">&times;</button>
                    </div>
                    <div className="overflow-y-auto p-0 bg-white dark:bg-slate-900">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase font-bold text-xs sticky top-0 z-10 shadow-sm border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    {renderSortHeader('Player', 'name', matchSort, setMatchSort, 'text-left', 'px-2 sm:px-6')}
                                    {renderSortHeader('Pts', 'totalPoints', matchSort, setMatchSort)}
                                    {renderSortHeader('4s', 'hits4', matchSort, setMatchSort, 'text-right', 'text-rose-600 dark:text-rose-500')}
                                    {renderSortHeader('3s', 'hits3', matchSort, setMatchSort, 'text-right', 'text-amber-600 dark:text-amber-500')}
                                    {renderSortHeader('2s', 'hits2', matchSort, setMatchSort, 'text-right', 'text-green-600 dark:text-green-500')}
                                    {renderSortHeader('1s', 'hits1', matchSort, setMatchSort, 'text-right', 'text-cyan-600 dark:text-cyan-500')}
                                    {renderSortHeader('Pit', 'pitchesSeen', matchSort, setMatchSort, 'text-right', 'text-slate-500')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                                {performSort(statsModalData, matchSort).map(stat => (
                                    <tr key={stat.playerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-2 sm:px-6 py-2 sm:py-3 font-bold text-slate-900 dark:text-white font-sans text-xs sm:text-base">{stat.name}</td>
                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums font-bold text-sm sm:text-lg text-slate-900 dark:text-white">{stat.totalPoints}</td>
                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits4}</td>
                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits3}</td>
                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits2}</td>
                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits1}</td>
                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-slate-500 text-[10px] sm:text-sm">{stat.pitchesSeen}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-end">
                        <button onClick={() => setStatsModalMatch(null)} className="px-6 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white font-sans transition-colors">Close</button>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {showDashboardImport && state.currentLeague && (
            <RosterImportModal
                isOpen={showDashboardImport}
                onClose={() => setShowDashboardImport(false)}
                onSuccess={() => {
                    if (state.currentLeague) refreshDashboard(state.currentLeague, state.season);
                }}
                currentLeague={state.currentLeague}
                currentSeason={state.season}
                availableLeagues={leagues.map(l => l.id)}
            />
        )}
    </div>
  );
};

export default App;
