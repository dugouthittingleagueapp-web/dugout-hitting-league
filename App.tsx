import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AgeGroup, AppState, Match, Team, Player, League, PlayerStats } from './types';
import { Navbar } from './components/Navbar';
import { TeamManagement } from './components/TeamManagement';
import { Scoreboard } from './components/Scoreboard';
import { AdminDashboard } from './components/AdminDashboard';
import { MatchSetup } from './components/MatchSetup';
import { RosterImportModal } from './components/RosterImportModal';
import { PlayerCareerModal } from './components/PlayerCareerModal';
import { SetLineupModal } from './components/SetLineupModal';
import { PracticeSetupModal } from './components/PracticeSetupModal';
import { MatchStatsEditorModal } from './components/MatchStatsEditorModal';
import * as storage from './services/storageService';
import { getMatchStatus, findCurrentOrUpcomingWeekId } from './utils/lineupHelper';
import { detectForfeit } from './services/matchHelpers';
import { calculateLeagueStandings } from './utils/leagueStandings';
import { calculateWeeklyLeaders } from './utils/weeklyLeaders';
import { getMatchScores } from './utils/scoreTotals';
import { getWeekKey, groupMatchesByWeek } from './utils/scheduleWeeks';
import { calculateSeasonStats, attachSeasonTeamNames } from './utils/seasonStats';

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
    const defaultInitialSeason = safeStorage.getItem('dugout_current_season') || String(new Date().getFullYear());
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
            if (!parsed.season) parsed.season = defaultInitialSeason;
            
            return parsed;
        } catch (e) {
            console.error("Error parsing app state", e);
        }
    }
    return { view: 'league_select', currentLeague: null, currentMatchId: null, season: defaultInitialSeason, dashboardTab: 'matches' };
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
  
  // Dynamic Season Management State
  const [activeSeason, setActiveSeason] = useState<string>(() => safeStorage.getItem('dugout_current_season') || '2026');
  const [availableSeasons, setAvailableSeasons] = useState<string[]>(() => {
    try {
      const s = safeStorage.getItem('dugout_available_seasons');
      if (s) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set([...parsed, '2026', '2025'])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        }
      }
    } catch {}
    return ['2026', '2025'];
  });

  // In-Progress Match Recovery State
  const [resumeMatch, setResumeMatch] = useState<{ id: string; league: string; season: string; homeTeamName: string; awayTeamName: string; inningNumber: number; isPractice?: boolean; is_practice?: boolean } | null>(null);
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
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Match Stats Modal
  const [statsModalMatch, setStatsModalMatch] = useState<Match | null>(null);
  const [statsModalData, setStatsModalData] = useState<PlayerStats[]>([]);

  // Set Lineup Modal
  const [lineupModalMatch, setLineupModalMatch] = useState<Match | null>(null);

  // Practice Mode Modal
  const [showPracticeModal, setShowPracticeModal] = useState(false);

  // Match Stats Re-assignment Editor Modal
  const [statEditorMatch, setStatEditorMatch] = useState<Match | null>(null);

  // Success / Info Notification Toast Banner on Dashboard
  const [dashboardToast, setDashboardToast] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  // Move Match Modal
  const [moveMatchModal, setMoveMatchModal] = useState<{ matchId: string, currentLeague: string } | null>(null);
  const [targetLeague, setTargetLeague] = useState('');

  // Sorting State
  const [seasonSort, setSeasonSort] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });
  const [matchSort, setMatchSort] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });

  // Player Career Stats Modal State
  const [selectedCareerPlayer, setSelectedCareerPlayer] = useState<string | null>(null);

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
        const curSeason = await storage.getCurrentSeason();
        const seasonsList = await storage.getAvailableSeasons();
        const liveSeason = curSeason || '2026';
        const mergedList = Array.from(new Set([...seasonsList, '2026', '2025', liveSeason])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        setActiveSeason(liveSeason);
        setAvailableSeasons(mergedList);
        const ls = await storage.getLeagues(liveSeason);
        setLeagues(ls);
        
        setState(s => {
            if (s.view === 'league_select' && !s.currentLeague) {
                 return { ...s, season: liveSeason };
            }
            return s;
        });
    };
    init();
  }, []);

  // Sync leagues whenever the selected season changes (active season or any past archive)
  useEffect(() => {
    if (state.season) {
      storage.getLeagues(state.season).then(setLeagues).catch(console.error);
    }
  }, [state.season]);

  // Umpires and spectators are only concerned with the current year (strictly locked to activeSeason)
  useEffect(() => {
    if (userRole !== 'admin' && activeSeason && state.season !== activeSeason) {
      setState(s => ({ ...s, season: activeSeason }));
    }
  }, [userRole, activeSeason, state.season]);

  const refreshDashboard = useCallback(async (league: AgeGroup, season: string, silent = false, refreshTeams = true) => {
    if (!silent) setLoading(true);
    try {
        // Team rosters rarely change: omit them from ordinary scoreboard refreshes.
        const [m, t] = await Promise.all([
            storage.getMatches(league, season),
            refreshTeams ? storage.getTeams(null, season) : Promise.resolve(null)
        ]);
        setMatches(m);
        if (t) setTeams(t);
    }
    catch (e) { console.error(e); } finally { if (!silent) setLoading(false); }
  }, []);

  // Initial Load & View Change
  // The storage service owns the reconnect listener; the app only kicks off
  // one initial queue flush to prevent multiple duplicate synchronization runs.
  useEffect(() => {
    void storage.syncOfflineData();
  }, []);

  useEffect(() => {
    if (state.currentLeague && state.view === 'dashboard') {
        refreshDashboard(state.currentLeague, state.season);
    }
  }, [state.currentLeague, state.view, state.season, refreshDashboard]);

  // Reduce unnecessary database egress when viewing the dashboard.
  useEffect(() => {
    if (state.view !== 'dashboard' || !state.currentLeague || lineupModalMatch) return;
    let inFlight = false;
    let ticks = 0;
    const poll = async () => {
        if (document.visibilityState === 'hidden' || inFlight) return;
        inFlight = true;
        try {
            ticks++;
            await refreshDashboard(state.currentLeague!, state.season, true, ticks % 10 === 0);
        } finally {
            inFlight = false;
        }
    };
    const interval = setInterval(() => { void poll(); }, 30000);
    const onVisibility = () => {
        if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state.view, state.currentLeague, state.season, refreshDashboard, lineupModalMatch]);

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
                  inningNumber: activeInning,
                  isPractice: !!(existing.isPractice || existing.is_practice)
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
                          inningNumber: activeInning,
                          isPractice: !!(m.isPractice || m.is_practice)
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

  const handleScoreboardExit = async (options?: { endedPractice?: boolean; deletedPractice?: boolean; matchId?: string; savedPractice?: boolean; finalizedMatch?: boolean; message?: string }) => {
      const targetMatchId = options?.matchId || state.currentMatchId;
      // Finished-game admin corrections use a real scoring lock. Release it
      // when returning to the schedule so another admin isn't blocked.
      if (userRole === 'admin' && targetMatchId &&
          matches.some(m => m.id === targetMatchId && (m.isComplete || m.status === 'FINAL'))) {
          await storage.requestScoringLock(targetMatchId, 'release').catch(() => {});
      }
      safeStorage.removeItem('dugout_active_match_id');
      setResumeMatch(null);

      // Priority 4 & 5: Practice matches must NEVER be automatically deleted on exit, completion, or finalization.
      // They persist on the dashboard with the PRACTICE badge until manually deleted.
      if (options?.finalizedMatch) {
          const targetId = options?.matchId || state.currentMatchId;
          if (targetId) {
              setMatches(prev => prev.map(m => m.id === targetId ? { ...m, isComplete: true, status: 'FINAL' as const } : m));
          }
      }
      if (state.currentLeague) {
          await refreshDashboard(state.currentLeague, state.season, true);
      }
      if (options?.message) {
          setDashboardToast({ text: options.message, type: 'success' });
          setTimeout(() => setDashboardToast(null), 6000);
      }
      setState(s => ({ ...s, view: 'dashboard', currentMatchId: null }));
  };

  const handleEndPracticeBannerMatch = async () => {
      if (!resumeMatch) return;
      // Frontend Action Safety Guard: Ensure banner is strictly an active practice match
      if (!resumeMatch.isPractice && !resumeMatch.is_practice) {
          console.warn('[Banner] Blocked attempt to end non-practice match.');
          return;
      }
      const matchId = resumeMatch.id;

      safeStorage.removeItem('dugout_active_match_id');
      setResumeMatch(null);

      try {
          const matchToFinalize = await storage.getMatch(matchId);
          if (matchToFinalize) {
              const finalized: Match = {
                  ...matchToFinalize,
                  isComplete: true,
                  status: 'FINAL'
              };
              await storage.updateMatch(finalized);
              setMatches(prev => prev.map(m => m.id === matchId ? finalized : m));
          } else {
              setMatches(prev => prev.map(m => m.id === matchId ? { ...m, isComplete: true, status: 'FINAL' as const } : m));
          }
          setDashboardToast({ text: 'Practice match completed and saved to schedule.', type: 'success' });
          setTimeout(() => setDashboardToast(null), 5000);
          if (state.currentLeague) await refreshDashboard(state.currentLeague, state.season, true);
      } catch (e) {
          console.error("Failed to finalize practice match from banner", e);
      }
  };

  // Week grouping is shared with schedule tests and independent of React rendering.
  const activeWeeks = useMemo(
    () => groupMatchesByWeek(matches, state.currentLeague, storage.leaguesMatch),
    [matches, state.currentLeague]
  );

  // Track league changes so schedule view auto-advances when switching leagues or on initial mount
  const lastLeagueRef = useRef<string | null>(null);

  // Auto-advance schedule and leaderboard week based on system date and active games
  useEffect(() => {
      if (activeWeeks.length > 0) {
          const autoWeekId = findCurrentOrUpcomingWeekId(activeWeeks);
          const leagueChanged = lastLeagueRef.current !== state.currentLeague;
          lastLeagueRef.current = state.currentLeague;

          // Helper to safely select week: auto-advance if league changed, or if current selection is invalid / unset
          const resolveWeek = (currentVal: string, setter: (v: string) => void) => {
              if (!leagueChanged && currentVal && activeWeeks.find(w => w.id === currentVal)) {
                  return;
              }

              if (autoWeekId) {
                  setter(autoWeekId);
              } else if (activeWeeks[0]) {
                  setter(activeWeeks[0].id);
              }
          };

          resolveWeek(matchListWeek, setMatchListWeek);
          resolveWeek(leaderboardWeek, setLeaderboardWeek);
      }
  }, [activeWeeks, state.currentLeague]); // Auto-advances when weeks load or when switching leagues

  const handleLogout = useCallback(() => {
      setUserRole('fan');
      safeStorage.removeItem('userRole');
      safeStorage.removeItem('lastActivity');
      safeStorage.removeItem('dugout_app_state'); 
      safeStorage.removeItem('dugout_auth_token');
      storage.logout().catch(() => {});
      setState(s => ({
          ...s, 
          season: activeSeason, 
          view: 'league_select', 
          currentLeague: null, 
          currentMatchId: null, 
          dashboardTab: 'matches'
      })); 
      setIsMenuOpen(false);
  }, [activeSeason]);

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
        
        const homeTeamObj = teams.find(t => t.id === finalHomeId);
        const awayTeamObj = teams.find(t => t.id === finalAwayId);
        const forfeitEval = detectForfeit(homeTeamObj, awayTeamObj, homeIds, awayIds);

        const newMatch = await storage.createMatch(
            state.currentLeague, 
            finalHomeId, 
            finalAwayId, 
            homeIds, 
            awayIds, 
            state.season,
            forfeitEval.isForfeit ? {
                is_forfeit: true,
                forfeiting_team_id: forfeitEval.forfeitingTeamId,
                winning_team_id: forfeitEval.winningTeamId,
                forfeit_reason: forfeitEval.forfeitReason,
            } : undefined
        );
        safeStorage.setItem('dugout_active_match_id', newMatch.id);
        
        setSelectedHomeId(''); setSelectedAwayId(''); setLoading(false);
        setState({ ...state, view: 'scoring', currentMatchId: newMatch.id });
    } catch (e) { alert("Error starting match: " + e); setLoading(false); }
  };

  const handleStartPractice = async (practiceMatch: Match) => {
      setMatches(prev => storage.sortMatchesChronologically([practiceMatch, ...prev.filter(m => m.id !== practiceMatch.id)]));
      safeStorage.setItem('dugout_active_match_id', practiceMatch.id);
      setShowPracticeModal(false);
      // Route generated practice match to dashboard/schedule flow just like a regular game
      const weekKey = getWeekKey(practiceMatch.date);
      setMatchListWeek(weekKey);
      setState(s => ({
          ...s,
          view: 'dashboard',
          currentLeague: practiceMatch.league || s.currentLeague,
          dashboardTab: 'matches',
          currentMatchId: null
      }));
      setDashboardToast({ text: 'Practice match ready on schedule! You can set lineups or start scoring now.', type: 'info' });
      setTimeout(() => setDashboardToast(null), 6000);
  };

  const handleDeleteMatch = async (matchId: string) => {
    const rawId = matchId.trim();
    const strippedId = rawId.startsWith('practice-') ? rawId.slice('practice-'.length).trim() : rawId;
    const prefixedId = `practice-${strippedId}`;

    const target = matches.find(m => {
        const mId = String(m.id || '').trim();
        return mId === rawId || mId === strippedId || mId === prefixedId;
    });

    if (target && !target.isPractice && !target.is_practice) {
        alert("Protected Game: Official league matches cannot be deleted. Only practice sessions can be removed.");
        return;
    }

    if (!confirm("Are you sure you want to delete this practice match? This cannot be undone.")) return;
    try {
        setLoading(true);
        await storage.deleteMatch(matchId);
        
        // Remove match from local matches state array only upon successful deletion
        setMatches(prev => prev.filter(m => {
            const mId = String(m.id || '').trim();
            return mId !== rawId && mId !== strippedId && mId !== prefixedId;
        }));

        const activeId = safeStorage.getItem('dugout_active_match_id');
        if (activeId === rawId || activeId === strippedId || activeId === prefixedId) {
            safeStorage.removeItem('dugout_active_match_id');
        }

        setLoading(false);
        if (state.currentLeague) await refreshDashboard(state.currentLeague, state.season, true);
    } catch (e: any) {
        setLoading(false);
        alert(e?.message || "Failed to delete match");
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
      setShowPassword(false);
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
    const cleanPw = passwordInput.trim();
    if (!cleanPw) {
      setLoginError('Please enter a password.');
      return;
    }
    setLoading(true);
    setLoginError('');
    try {
      const result = await storage.verifyPassword(cleanPw);
      setLoading(false);
      
      if (result.success && result.role) {
        setUserRole(result.role);
        safeStorage.setItem('userRole', result.role);
        safeStorage.setItem('lastActivity', Date.now().toString());
        setShowLoginModal(false);
        setPasswordInput('');
        setLoginError('');
        
        // When logging in as Admin, navigate directly to Admin Dashboard
        if (result.role === 'admin') {
          setState(s => ({ ...s, view: 'admin' }));
        }
      } else {
        setLoginError(result.error || 'Incorrect password.');
      }
    } catch (err: any) {
      setLoading(false);
      setLoginError(err?.message || 'Login verification failed. Please check connection and try again.');
    }
  };

  const performSort = <T extends PlayerStats>(data: T[], config: { key: keyof PlayerStats; direction: 'asc' | 'desc' }): T[] => {
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

  const weeklyStats = useMemo(() => {
    const targetWeek = activeWeeks.find(w => w.id === leaderboardWeek);
    return calculateWeeklyLeaders(targetWeek ? targetWeek.matches : [], teams);
  }, [teams, leaderboardWeek, activeWeeks]);

  const visibleMatches = useMemo(() => {
      const w = activeWeeks.find(w => w.id === matchListWeek);
      return w ? storage.sortMatchesChronologically(w.matches) : [];
  }, [activeWeeks, matchListWeek]);

  const leagueTeams = teams.filter(t => storage.leaguesMatch(t.league, state.currentLeague));

  const standings = useMemo(
    () => calculateLeagueStandings(matches, leagueTeams, state.currentLeague),
    [matches, leagueTeams, state.currentLeague]
  );

  const seasonStats = useMemo(
    () => calculateSeasonStats(matches, teams, state.currentLeague, storage.calculateMatchStats, storage.leaguesMatch),
    [matches, teams, state.currentLeague]
  );

  const seasonStatsWithTeam = useMemo(
    () => attachSeasonTeamNames(seasonStats, teams),
    [seasonStats, teams]
  );

  const navbarProps = {
      currentLeague: state.currentLeague,
      currentSeason: state.season,
      activeSeason: activeSeason,
      availableSeasons: availableSeasons,
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
  
  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-200 flex flex-col font-sans relative transition-colors duration-500">
        {/* Background Texture */}
        <div className="absolute inset-0 opacity-[0.4] dark:opacity-[0.03] pointer-events-none z-0 mix-blend-overlay dark:mix-blend-normal h-full w-full" 
             style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 20l20 20M20 20L0 40M20 20L40 0M20 20L0 0' stroke='%23888888' stroke-width='1' fill='none'/%3E%3C/svg%3E")` }}>
        </div>

        {/* Active Match In-Progress Resume Prompt Banner */}
        {resumeMatch && state.view !== 'scoring' && (
            <div className={`${resumeMatch.isPractice ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'} px-4 py-2.5 flex items-center justify-between text-xs font-bold font-sans z-[1100] relative shadow-md transition-colors`}>
                <div className="flex items-center gap-2 truncate pr-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${resumeMatch.isPractice ? 'bg-amber-200' : 'bg-amber-400'} animate-pulse shrink-0`}></span>
                    <span className="truncate">
                        {resumeMatch.isPractice ? (
                            <>🧪 Paused Practice Match: {resumeMatch.awayTeamName} vs {resumeMatch.homeTeamName} (Inning {resumeMatch.inningNumber})</>
                        ) : (
                            <>Active Match in Progress: {resumeMatch.awayTeamName} vs {resumeMatch.homeTeamName} (Inning {resumeMatch.inningNumber})</>
                        )}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button 
                        onClick={handleResumeActiveMatch} 
                        className={`px-3 py-1 bg-white ${resumeMatch.isPractice ? 'hover:bg-amber-50 text-amber-800' : 'hover:bg-blue-50 text-blue-700'} rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer`}
                    >
                        {resumeMatch.isPractice ? 'Resume Practice' : 'Resume Match'}
                    </button>
                    {resumeMatch.isPractice && (
                        <button 
                            onClick={handleEndPracticeBannerMatch} 
                            className="px-2.5 py-1 bg-amber-700/80 hover:bg-amber-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                            title="End and complete this practice match"
                        >
                            End Match
                        </button>
                    )}
                    <button 
                        onClick={handleDismissResumeMatch} 
                        className={`px-2 py-1 ${resumeMatch.isPractice ? 'bg-amber-700/60 hover:bg-amber-700' : 'bg-blue-700/60 hover:bg-blue-700'} text-white rounded-lg text-xs font-bold transition-colors cursor-pointer`}
                        title="Dismiss banner"
                        aria-label="Dismiss banner"
                    >
                        ✕
                    </button>
                </div>
            </div>
        )}

        {/* Archive Banner (Shown ONLY to admins viewing any historical archived season) */}
        {userRole === 'admin' && state.season !== activeSeason && (
            <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 flex items-center justify-between text-xs font-bold font-sans z-[1100] relative">
                <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                    <span>ARCHIVE MODE: Viewing {state.season} Season History (Historical Data)</span>
                </div>
                <button 
                    onClick={() => setState(s => ({ ...s, season: activeSeason, currentLeague: null, view: 'league_select' }))} 
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm cursor-pointer"
                >
                    Return to {activeSeason} Season
                </button>
            </div>
        )}
        
        {/* Scrollable Main Content Area */}
        <main className="relative flex-1 w-full overflow-y-auto overflow-x-hidden scroll-touch">
            {/* Dashboard Toast / Finalize Success Notification */}
            {dashboardToast && (
                <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between shadow-lg z-[1150] sticky top-0 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2.5 font-bold text-xs sm:text-sm font-sans max-w-4xl mx-auto w-full">
                        <span className="text-base sm:text-lg">✅</span>
                        <span className="flex-1">{dashboardToast.text}</span>
                        <button 
                            type="button"
                            onClick={() => setDashboardToast(null)}
                            className="text-emerald-100 hover:text-white p-1 rounded-lg text-xs font-bold shrink-0 cursor-pointer"
                            title="Dismiss notification"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

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
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">No {state.season} Leagues Found</h3>
                                <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">The {state.season} season is ready. Create your first league category to begin.</p>
                                {userRole === 'admin' ? (
                                    <button onClick={() => setState(s => ({ ...s, view: 'admin' }))} className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">Go to Admin to Create Leagues</button>
                                ) : (
                                    <button onClick={openLoginModal} className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">Log In to Admin</button>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 sm:gap-4 w-full max-w-sm sm:max-w-md mx-auto px-4 pb-8">
                            {leagues.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })).map(league => {
                                const len = league.id.length;
                                const titleSizeClass = 
                                    len <= 6 ? 'text-2xl sm:text-3xl' :
                                    len <= 12 ? 'text-xl sm:text-2xl' :
                                    len <= 18 ? 'text-lg sm:text-xl' :
                                    'text-base sm:text-lg';

                                return (
                                    <button 
                                        key={league.id} 
                                        type="button"
                                        onClick={() => handleSelectLeague(league.id)} 
                                        className="group relative bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/90 p-1 rounded-2xl shadow-lg dark:shadow-2xl transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99] hover:shadow-blue-500/20 dark:hover:shadow-blue-900/20 text-left w-full border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500/50 cursor-pointer overflow-hidden"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-blue-600/0 to-blue-100/30 dark:to-blue-900/20 group-hover:to-blue-100/50 dark:group-hover:to-blue-900/30 rounded-2xl transition-all duration-500 pointer-events-none"></div>
                                        
                                        <div className="relative z-10 w-full p-4 sm:p-5 flex items-center justify-between gap-3 min-h-[72px] sm:min-h-[80px]">
                                            {/* Decorative baseball watermark */}
                                            <div className="absolute -top-3 right-10 text-slate-100 dark:text-slate-800/30 group-hover:text-blue-100 dark:group-hover:text-blue-600/10 transition-all duration-700 rotate-[15deg] scale-125 pointer-events-none">
                                                <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <path d="M6 4.5C8.5 7.5 9 10.5 9 12s-.5 4.5-3 7.5" />
                                                    <path d="M18 4.5C15.5 7.5 15 10.5 15 12s.5 4.5 3 7.5" />
                                                </svg>
                                            </div>
                                            
                                            {/* Left Column: Tag and dynamically sized League Name */}
                                            <div className="flex-1 min-w-0 pr-2">
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border border-slate-200 dark:border-slate-800 group-hover:border-blue-400 group-hover:text-blue-500 transition-colors">
                                                        {state.season} Season
                                                    </span>
                                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></span>
                                                </div>
                                                <h3 className={`${titleSizeClass} font-black text-slate-900 dark:text-white uppercase italic leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors drop-shadow-sm break-words`}>
                                                    {league.id}
                                                </h3>
                                            </div>

                                            {/* Right Action Arrow Indicator */}
                                            <div className="shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
                                                <svg className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                                                </svg>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                            </div>
                        )}

                        {/* Admin / Umpire Quick Access on Home Screen */}
                        {userRole === 'admin' && (
                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <button 
                                    onClick={() => setState(s => ({ ...s, view: 'admin' }))}
                                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-900/20 transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                    <span>Open Admin Dashboard</span>
                                </button>
                            </div>
                        )}
                        {userRole === 'umpire' && (
                            <div className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                                ⚾ Umpire Active: Select any division above to score live pitches and manage innings.
                            </div>
                        )}
                        {userRole === 'fan' && (
                            <div className="mt-6 text-center">
                                <button 
                                    onClick={openLoginModal}
                                    className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 underline transition-colors cursor-pointer"
                                >
                                    Umpire or Admin Log In
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ADMIN VIEW */}
            {state.view === 'admin' && (
                <div className="flex-1 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-full">
                    <AdminDashboard 
                        onBack={() => { setIsMenuOpen(false); setState(previous => ({ ...previous, view: 'league_select', currentLeague: null, currentMatchId: null })); }} 
                        onBrowseArchive={(archiveSeason) => setState(s => ({ ...s, season: archiveSeason, view: 'league_select', currentLeague: null }))}
                        onStartPractice={() => setShowPracticeModal(true)}
                        onSeasonUpdated={async () => {
                            const newActive = await storage.getCurrentSeason();
                            const seasonsList = await storage.getAvailableSeasons();
                            const merged = Array.from(new Set([...seasonsList, '2026', '2025', newActive])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                            setActiveSeason(newActive);
                            setAvailableSeasons(merged);
                            setState(s => ({ ...s, season: newActive, currentLeague: null }));
                        }}
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
                    <Scoreboard matchId={state.currentMatchId} onExit={handleScoreboardExit} isReadOnly={userRole === 'fan' || (userRole === 'umpire' && matches.some(m => m.id === state.currentMatchId && (m.isComplete || m.status === 'FINAL')))} userRole={userRole} onPlayerClick={setSelectedCareerPlayer} />
                </div>
            )}

            {/* TEAM MANAGEMENT VIEW - Admin Only */}
            {state.view === 'team_management' && state.currentLeague && (
                <div className="flex-1 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-full">
                    {userRole === 'admin' ? (
                        <TeamManagement league={state.currentLeague} season={state.season} onBack={() => setState({ ...state, view: 'dashboard' })} onPlayerClick={setSelectedCareerPlayer} />
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

                            {/* Practice Mode Box - Umpires & Admins */}
                            <div className="bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30 rounded-xl p-3 sm:p-4 shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-lg">🧪</span>
                                    <div>
                                        <h3 className="text-xs sm:text-sm font-black text-amber-700 dark:text-amber-400 font-sans uppercase tracking-wider">Practice Mode</h3>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">Test scoring and game setups without altering official stats</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowPracticeModal(true)}
                                    className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold rounded-lg transition-all font-sans text-xs sm:text-sm shadow flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                    <span>🧪 Start Practice Match</span>
                                </button>
                            </div>

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
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="font-bold bg-white text-indigo-600 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-sans shadow tabular-nums shrink-0">{idx+1}</span>
                                                                <button 
                                                                    type="button"
                                                                    onClick={() => setSelectedCareerPlayer(s.name)} 
                                                                    className="font-semibold font-sans text-xs sm:text-base hover:underline hover:text-yellow-300 text-left cursor-pointer transition-colors truncate"
                                                                    title="View career batting record"
                                                                >
                                                                    {s.name}
                                                                </button>
                                                                <span className="text-[10px] sm:text-xs text-white/60 font-sans shrink-0">({s.team})</span>
                                                            </div>
                                                            <span className="font-sans tabular-nums font-bold text-base sm:text-xl shrink-0">{s.score}</span>
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
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="font-bold bg-white text-purple-600 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-sans shadow tabular-nums shrink-0">{idx+1}</span>
                                                                <button 
                                                                    type="button"
                                                                    onClick={() => setSelectedCareerPlayer(s.name)} 
                                                                    className="font-semibold font-sans text-xs sm:text-base hover:underline hover:text-yellow-300 text-left cursor-pointer transition-colors truncate"
                                                                    title="View career batting record"
                                                                >
                                                                    {s.name}
                                                                </button>
                                                                <span className="text-[10px] sm:text-xs text-white/60 font-sans shrink-0">({s.team})</span>
                                                            </div>
                                                            <span className="font-sans tabular-nums font-bold text-base sm:text-xl shrink-0">{s.score}</span>
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
                                        const matchStatus = getMatchStatus(match);

                                        return (
                                            <div key={match.id} className={`backdrop-blur-xl p-3.5 sm:p-5 rounded-xl shadow-md dark:shadow-sm border flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3 sm:gap-4 transition-all group ${
                                                (match.isPractice || match.is_practice) 
                                                    ? 'bg-amber-500/[0.04] dark:bg-amber-500/[0.03] border-amber-400/50 dark:border-amber-500/40 hover:bg-amber-500/[0.07] ring-1 ring-amber-500/20' 
                                                    : 'bg-white/60 dark:bg-slate-900/60 border-white/20 dark:border-slate-800 hover:bg-white/80 dark:hover:bg-slate-800/50'
                                            }`}>
                                                {/* Left Section: Match Info, Status & Matchup (Home v Away) */}
                                                <div className="flex flex-col gap-2 min-w-0 flex-1">
                                                    {/* Top subheader: Status Badge & Scheduled Time/Tunnel */}
                                                    <div className="flex items-center gap-2.5 flex-wrap">
                                                        {matchStatus === 'FINAL' && (
                                                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded font-sans border shrink-0 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700">
                                                                FINAL
                                                            </span>
                                                        )}
                                                        {matchStatus === 'IN_PROGRESS' && (
                                                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded font-sans border shrink-0 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-500/30 animate-pulse">
                                                                LIVE
                                                            </span>
                                                        )}
                                                        {(match.isPractice || match.is_practice) && (
                                                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded font-sans border shrink-0 bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/50 shadow-xs flex items-center gap-1 font-bold">
                                                                <span>🧪</span>
                                                                <span>PRACTICE</span>
                                                            </span>
                                                        )}
                                                        {(match.isForfeit || match.is_forfeit) && (
                                                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded font-sans border shrink-0 bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/50 shadow-xs flex items-center gap-1 font-bold">
                                                                <span>⚠️</span>
                                                                <span>FORFEIT</span>
                                                            </span>
                                                        )}
                                                        {matchStatus === 'SCHEDULED' && (
                                                            <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded font-sans border shrink-0 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800/50">
                                                                SCHEDULED
                                                            </span>
                                                        )}

                                                        {(match.startTime || match.location) && (
                                                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-sans flex-wrap">
                                                                {match.startTime && (
                                                                    <span className="inline-flex items-center gap-1 font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md">
                                                                        <svg className="w-3 h-3 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                        {match.startTime}{match.endTime ? ` - ${match.endTime}` : ''}
                                                                    </span>
                                                                )}
                                                                {match.location && (
                                                                    <span className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-slate-400">
                                                                        <svg className="w-3 h-3 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                                        {match.location}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Home vs Away Matchup with centered score */}
                                                    <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-4 min-w-0">
                                                        {/* Home Team (Left) */}
                                                        <div className="flex-1 text-right min-w-[110px] sm:min-w-[130px]">
                                                            <div className="text-sm sm:text-base md:text-lg font-bold text-red-700 dark:text-red-400 font-sans break-normal whitespace-normal leading-snug">
                                                                {homeName}
                                                            </div>
                                                            <div className="text-[8px] sm:text-[10px] font-bold uppercase tracking-wider text-red-500/80">Home</div>
                                                        </div>
                                                        
                                                        {/* Score Center (Home - Away) */}
                                                        <div className="shrink-0 flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 py-1 rounded-lg bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 min-w-[64px] sm:min-w-[80px]">
                                                            <span className="text-base sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums tracking-tight">{homeScore}</span>
                                                            <span className="text-slate-400 dark:text-slate-500 text-sm font-semibold">-</span>
                                                            <span className="text-base sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums tracking-tight">{awayScore}</span>
                                                        </div>

                                                        {/* Away Team (Right) */}
                                                        <div className="flex-1 text-left min-w-[110px] sm:min-w-[130px]">
                                                            <div className="text-sm sm:text-base md:text-lg font-bold text-blue-700 dark:text-blue-400 font-sans break-normal whitespace-normal leading-snug">
                                                                {awayName}
                                                            </div>
                                                            <div className="text-[8px] sm:text-[10px] font-bold uppercase tracking-wider text-blue-500/80">Away</div>
                                                        </div>
                                                    </div>

                                                    {(match.isForfeit || match.is_forfeit) && (() => {
                                                        const forfeitingId = match.forfeitingTeamId || match.forfeiting_team_id;
                                                        const forfeitTeamName = forfeitingId === match.homeTeamId ? homeName : (forfeitingId === match.awayTeamId ? awayName : null);
                                                        const winningTeamName = forfeitingId === match.homeTeamId ? awayName : (forfeitingId === match.awayTeamId ? homeName : null);
                                                        return (
                                                            <div className="mt-1 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-800 dark:text-rose-200 font-sans flex items-start gap-1.5 leading-snug">
                                                                <span className="font-bold shrink-0">⚠️ FORFEIT:</span>
                                                                <div>
                                                                    <span>{forfeitTeamName ? `${forfeitTeamName} forfeited (≤1 main player fielded)` : 'Forfeit match'}. </span>
                                                                    <span className="font-bold text-green-700 dark:text-green-400">Automatic Win awarded to {winningTeamName || 'opponent'}. </span>
                                                                    <span className="text-[10px] text-slate-600 dark:text-slate-400 block mt-0.5">
                                                                        Stats recorded exclusively for {winningTeamName || 'compliant team'}; forfeiting team stats excluded.
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>

                                                {/* Right Section: Action Buttons */}
                                                <div className="flex items-center gap-2 w-full lg:w-auto justify-end shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-200/60 dark:border-slate-800">
                                                    {/* Set Lineup button for umpires/admins before game completion instead of stats button */}
                                                    {userRole !== 'fan' && !match.isComplete ? (
                                                        <button 
                                                            onClick={() => setLineupModalMatch(match)} 
                                                            className="flex-1 lg:flex-none text-center px-3 py-1.5 sm:py-2 rounded-lg border border-blue-500/40 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:border-blue-400 font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer whitespace-nowrap shadow-sm"
                                                        >
                                                            Set Lineup
                                                        </button>
                                                    ) : (
                                                        <button 
                                                            onClick={() => handleOpenMatchStats(match)} 
                                                            className="flex-1 lg:flex-none text-center px-3 py-1.5 sm:py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500/50 font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer whitespace-nowrap shadow-sm"
                                                        >
                                                            Stats
                                                        </button>
                                                    )}
                                                    
                                                    <button 
                                                        onClick={async () => {
                                                            if (!match.isComplete && userRole !== 'fan') {
                                                                safeStorage.setItem('dugout_active_match_id', match.id);
                                                                if (matchStatus === 'SCHEDULED') {
                                                                    const updatedMatch = { ...match, status: 'IN_PROGRESS' as const };
                                                                    await storage.updateMatch(updatedMatch).catch(console.error);
                                                                    setMatches(prev => prev.map(m => m.id === match.id ? updatedMatch : m));
                                                                }
                                                            }
                                                            setState({ ...state, view: 'scoring', currentMatchId: match.id });
                                                        }} 
                                                        className="flex-1 lg:flex-none text-center px-3 py-1.5 sm:py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:white font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer whitespace-nowrap shadow-sm"
                                                    >
                                                        {matchStatus === 'FINAL' 
                                                            ? (userRole === 'admin' ? 'Score / Edit' : 'View') 
                                                            : (matchStatus === 'IN_PROGRESS' 
                                                                ? (userRole === 'fan' ? 'Watch Live' : 'Score') 
                                                                : (userRole === 'fan' ? 'Preview' : 'Start Game')
                                                            )
                                                        }
                                                    </button>
                                                    
                                                    {/* Manual Delete Button for completed practice sessions - right alongside Stats & View */}
                                                    {(match.isPractice || match.is_practice) && match.isComplete && userRole !== 'fan' && (
                                                        <button 
                                                            onClick={() => handleDeleteMatch(match.id)} 
                                                            className="flex-1 lg:flex-none text-center px-3 py-1.5 sm:py-2 rounded-lg border border-red-300 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 hover:border-red-400 font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer whitespace-nowrap shadow-sm flex items-center justify-center gap-1 shrink-0"
                                                            title="Delete completed practice session"
                                                        >
                                                            <span>🗑️</span>
                                                            <span>Delete</span>
                                                        </button>
                                                    )}

                                                    {(match.isPractice || match.is_practice) && !match.isComplete && userRole !== 'fan' && (
                                                        <button 
                                                            onClick={() => handleDeleteMatch(match.id)} 
                                                            className="flex-1 lg:flex-none text-center px-3 py-1.5 sm:py-2 rounded-lg border border-amber-400/50 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 hover:border-red-400 font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer whitespace-nowrap shadow-sm flex items-center justify-center gap-1 shrink-0"
                                                            title="Delete practice session"
                                                        >
                                                            <span>🗑️</span>
                                                            <span>Del Practice</span>
                                                        </button>
                                                    )}
                                                    
                                                    {userRole === 'admin' && (
                                                        <div className="flex gap-2 shrink-0">
                                                            {matchStatus === 'FINAL' && (
                                                                <button 
                                                                    onClick={() => setStatEditorMatch(match)} 
                                                                    className="px-2.5 py-1.5 sm:py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer shadow-sm flex items-center gap-1" 
                                                                    title="Fix / Re-assign match player stats"
                                                                >
                                                                    <span>🛠️</span>
                                                                    <span className="hidden sm:inline">Fix Stats</span>
                                                                </button>
                                                            )}
                                                            <button 
                                                                onClick={() => setMoveMatchModal({ matchId: match.id, currentLeague: match.league })} 
                                                                className="px-3 py-1.5 sm:py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 font-bold text-xs sm:text-sm transition-all font-sans cursor-pointer shadow-sm" 
                                                                title="Move to another league"
                                                            >
                                                                Move
                                                            </button>
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
                                                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold text-xs text-slate-500 uppercase">Team</th>
                                                    {renderSortHeader('Pts', 'totalPoints', seasonSort, setSeasonSort)}
                                                    {renderSortHeader('4s', 'hits4', seasonSort, setSeasonSort, 'text-right', 'text-rose-600 dark:text-rose-500')}
                                                    {renderSortHeader('3s', 'hits3', seasonSort, setSeasonSort, 'text-right', 'text-amber-600 dark:text-amber-500')}
                                                    {renderSortHeader('2s', 'hits2', seasonSort, setSeasonSort, 'text-right', 'text-green-600 dark:text-green-500')}
                                                    {renderSortHeader('1s', 'hits1', seasonSort, setSeasonSort, 'text-right', 'text-cyan-600 dark:text-cyan-500')}
                                                    {renderSortHeader('Pit', 'pitchesSeen', seasonSort, setSeasonSort, 'text-right', 'text-slate-500')}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                                                {performSort(seasonStatsWithTeam, seasonSort).map(stat => (
                                                    <tr key={stat.playerId} className="hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                                                        <td className="px-2 sm:px-6 py-2 sm:py-3 font-bold text-slate-900 dark:text-white font-sans text-xs sm:text-base">
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedCareerPlayer(stat.name)}
                                                                className="text-left font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer transition-colors"
                                                                title="View career batting record"
                                                            >
                                                                {stat.name}
                                                            </button>
                                                        </td>
                                                        <td className="px-2 sm:px-4 py-2 sm:py-3 font-semibold text-blue-700 dark:text-blue-400 font-sans text-xs sm:text-sm">
                                                            {stat.teamName || '—'}
                                                        </td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums font-bold text-sm sm:text-lg text-slate-900 dark:text-white">{stat.totalPoints}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits4}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits3}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits2}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits1}</td>
                                                        <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-slate-500 text-[10px] sm:text-sm">{stat.pitchesSeen}</td>
                                                    </tr>
                                                ))}
                                                {seasonStats.length === 0 && (
                                                  <tr><td colSpan={8} className="p-8 text-center text-slate-500 italic">No player stats recorded yet.</td></tr>
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
            <div className="bg-slate-900 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-700 mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg sm:text-xl font-bold text-white font-sans">Access Control</h3>
                <button onClick={() => setShowLoginModal(false)} className="text-slate-400 hover:text-white text-xl font-bold p-1 cursor-pointer">&times;</button>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mb-5 font-sans leading-relaxed">
                Enter your password to sign in as an <strong className="text-slate-200 font-semibold">Administrator</strong> or <strong className="text-slate-200 font-semibold">Umpire (Scorer)</strong>.
              </p>
              
              <form onSubmit={handleLoginSubmit}>
                <div className="mb-6">
                  <div className="relative">
                    <input 
                      type={showPassword ? "text" : "password"} 
                      autoFocus 
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="current-password"
                      spellCheck={false}
                      className={`w-full bg-slate-950 border rounded-xl px-4 py-3 pr-14 text-base outline-none focus:ring-2 text-white placeholder-slate-500 font-sans ${loginError ? 'border-red-500 focus:ring-red-900' : 'border-slate-700 focus:ring-blue-600'}`} 
                      value={passwordInput} 
                      onChange={e => {
                        setPasswordInput(e.target.value);
                        if (loginError) setLoginError('');
                      }} 
                      placeholder="Password" 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 text-xs font-semibold select-none cursor-pointer"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  {loginError && <p className="text-red-400 text-xs mt-2 font-bold font-sans bg-red-950/40 p-2 rounded-lg border border-red-900/40">{loginError}</p>}
                </div>

                <div className="flex gap-2">
                  <button 
                    type="button" 
                    onClick={() => setShowLoginModal(false)} 
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl transition-colors font-sans text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={loading || !passwordInput.trim()} 
                    className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-colors font-sans shadow-lg shadow-blue-900/20 text-sm cursor-pointer"
                  >
                    {loading ? 'Verifying...' : 'Log In'}
                  </button>
                </div>
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

        {statsModalMatch && (() => {
            const homeT = teams.find(t => t.id === statsModalMatch.homeTeamId);
            const awayT = teams.find(t => t.id === statsModalMatch.awayTeamId);
            const homeName = homeT?.name || 'Home Team';
            const awayName = awayT?.name || 'Away Team';

            return createPortal(
            <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setStatsModalMatch(null)}>
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                    <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-start sm:items-center bg-slate-50 dark:bg-slate-950 gap-4">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Match Statistics</span>
                                <span className="text-slate-300 dark:text-slate-700">•</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400 font-sans">{new Date(statsModalMatch.date).toLocaleDateString()}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-sm sm:text-lg font-bold">
                                <span className="text-blue-700 dark:text-blue-400">{awayName}</span>
                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Away</span>
                                <span className="text-slate-400 text-xs sm:text-sm font-normal">vs</span>
                                <span className="text-red-700 dark:text-red-400">{homeName}</span>
                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Home</span>
                            </div>
                        </div>
                        <button onClick={() => setStatsModalMatch(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-white font-bold text-xl transition-colors">&times;</button>
                    </div>

                    {(statsModalMatch.isForfeit || statsModalMatch.is_forfeit) && (
                        <div className="p-3 sm:px-6 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-200 font-sans flex items-start gap-2">
                            <span className="font-bold shrink-0 text-sm">⚠️</span>
                            <div>
                                <span className="font-bold">Official Forfeit Match: </span>
                                <span>Compliant team hitting points count normally toward official records. Forfeiting team statistics shown below are completely excluded from season totals, weekly leaderboards, and career stats.</span>
                            </div>
                        </div>
                    )}

                    <div className="overflow-y-auto p-0 bg-white dark:bg-slate-900">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase font-bold text-xs sticky top-0 z-10 shadow-sm border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    {renderSortHeader('Player', 'name', matchSort, setMatchSort, 'text-left', 'px-2 sm:px-6')}
                                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold text-xs text-slate-500 uppercase">Team</th>
                                    {renderSortHeader('Pts', 'totalPoints', matchSort, setMatchSort)}
                                    {renderSortHeader('4s', 'hits4', matchSort, setMatchSort, 'text-right', 'text-rose-600 dark:text-rose-500')}
                                    {renderSortHeader('3s', 'hits3', matchSort, setMatchSort, 'text-right', 'text-amber-600 dark:text-amber-500')}
                                    {renderSortHeader('2s', 'hits2', matchSort, setMatchSort, 'text-right', 'text-green-600 dark:text-green-500')}
                                    {renderSortHeader('1s', 'hits1', matchSort, setMatchSort, 'text-right', 'text-cyan-600 dark:text-cyan-500')}
                                    {renderSortHeader('Pit', 'pitchesSeen', matchSort, setMatchSort, 'text-right', 'text-slate-500')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                                {performSort(statsModalData, matchSort).map(stat => {
                                    const isAway = awayT && [...(awayT.players || []), ...(awayT.subs || [])].some(p => p.id === stat.playerId || p.name === stat.name);
                                    const teamLabel = isAway ? awayName : homeName;
                                    const teamColor = isAway ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800' : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800';

                                    const isMatchForfeit = !!(statsModalMatch.isForfeit || statsModalMatch.is_forfeit);
                                    const forfeitingTeamId = statsModalMatch.forfeitingTeamId || statsModalMatch.forfeiting_team_id;
                                    const isForfeitingPlayer = isMatchForfeit && forfeitingTeamId && (
                                        (forfeitingTeamId === statsModalMatch.homeTeamId && !isAway) ||
                                        (forfeitingTeamId === statsModalMatch.awayTeamId && isAway)
                                    );

                                    return (
                                        <tr key={stat.playerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="px-2 sm:px-6 py-2 sm:py-3 font-bold text-slate-900 dark:text-white font-sans text-xs sm:text-base">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedCareerPlayer(stat.name)}
                                                    className="text-left font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer transition-colors"
                                                    title="View career batting record"
                                                >
                                                    {stat.name}
                                                </button>
                                            </td>
                                            <td className="px-2 sm:px-4 py-2 sm:py-3 font-semibold text-xs sm:text-sm">
                                                <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${teamColor}`}>
                                                    {teamLabel}
                                                </span>
                                                {isForfeitingPlayer && (
                                                    <span className="ml-1 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                                        Excluded
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums font-bold text-sm sm:text-lg text-slate-900 dark:text-white">{stat.totalPoints}</td>
                                            <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits4}</td>
                                            <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits3}</td>
                                            <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits2}</td>
                                            <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-[10px] sm:text-sm">{stat.hits1}</td>
                                            <td className="px-1 sm:px-4 py-2 sm:py-3 text-right font-sans tabular-nums text-slate-500 text-[10px] sm:text-sm">{stat.pitchesSeen}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center gap-3">
                        {userRole === 'admin' && (
                            <button
                                onClick={() => {
                                    const m = statsModalMatch;
                                    setStatsModalMatch(null);
                                    setStatEditorMatch(m);
                                }}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs sm:text-sm font-sans transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                                title="Re-assign placeholder stats to official players"
                            >
                                <span>🛠️</span>
                                <span>Fix / Re-assign Match Stats</span>
                            </button>
                        )}
                        <button onClick={() => setStatsModalMatch(null)} className="px-6 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white font-sans transition-colors ml-auto">Close</button>
                    </div>
                </div>
            </div>,
            document.body
            );
        })()}

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

        {/* Player Career Stats Modal */}
        <PlayerCareerModal
            isOpen={!!selectedCareerPlayer}
            playerName={selectedCareerPlayer}
            onClose={() => setSelectedCareerPlayer(null)}
        />

        {/* Practice Mode Setup Modal */}
        <PracticeSetupModal
            isOpen={showPracticeModal}
            onClose={() => setShowPracticeModal(false)}
            currentLeague={state.view === 'admin' ? '' : (state.currentLeague || (leagues[0]?.id as AgeGroup) || '7-9')}
            allowLeagueSelection={state.view === 'admin'}
            season={state.season}
            teams={leagueTeams.length > 0 ? leagueTeams : teams.filter(t => storage.leaguesMatch(t.league, state.currentLeague || (leagues[0]?.id as AgeGroup) || '7-9'))}
            onStartPractice={handleStartPractice}
        />

        {/* Set Lineup Modal for Umpires and Admins */}
        {lineupModalMatch && (() => {
            const homeT = teams.find(t => t.id === lineupModalMatch.homeTeamId);
            const awayT = teams.find(t => t.id === lineupModalMatch.awayTeamId);
            if (!homeT || !awayT) return null;

            return (
                <SetLineupModal
                    match={lineupModalMatch}
                    homeTeam={homeT}
                    awayTeam={awayT}
                    isOpen={!!lineupModalMatch}
                    onClose={() => setLineupModalMatch(null)}
                    onTeamUpdated={(updatedTeam) => {
                        setTeams(prev => prev.map(t => t.id === updatedTeam.id ? updatedTeam : t));
                    }}
                    onSave={async (updatedMatch, andStartScoring) => {
                        setMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
                        setLineupModalMatch(null);
                        if (andStartScoring) {
                            safeStorage.setItem('dugout_active_match_id', updatedMatch.id);
                            setState({ ...state, view: 'scoring', currentMatchId: updatedMatch.id });
                        }
                    }}
                />
            );
        })()}
        {/* Match Stats Re-assignment Editor Modal for Admins */}
        {statEditorMatch && (
            <MatchStatsEditorModal
                match={statEditorMatch}
                isOpen={!!statEditorMatch}
                onClose={() => setStatEditorMatch(null)}
                teams={teams}
                onSuccess={(updatedMatch) => {
                    setMatches(prev => prev.map(m => m.id === updatedMatch.id ? updatedMatch : m));
                    if (state.currentLeague) {
                        refreshDashboard(state.currentLeague, state.season, true);
                    }
                }}
            />
        )}
    </div>
  );
};

export default App;
