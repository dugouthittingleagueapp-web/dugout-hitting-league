
import React, { useState, useEffect } from 'react';
import { AgeGroup, AppState, Match, Team, Player, League, PlayerStats } from './types';
import { Navbar } from './components/Navbar';
import { TeamManagement } from './components/TeamManagement';
import { Scoreboard } from './components/Scoreboard';
import { AdminDashboard } from './components/AdminDashboard';
import { MatchSetup } from './components/MatchSetup';
import * as storage from './services/storageService';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({ view: 'league_select', currentLeague: null, currentMatchId: null, season: '2025' });
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHomeId, setSelectedHomeId] = useState('');
  const [selectedAwayId, setSelectedAwayId] = useState('');
  
  // Dashboard View State
  const [dashboardTab, setDashboardTab] = useState<'matches' | 'standings' | 'season_stats'>('matches');

  // Role / Auth State
  const [userRole, setUserRole] = useState<'fan' | 'umpire' | 'admin'>('fan');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  // Match Stats Modal
  const [statsModalMatch, setStatsModalMatch] = useState<Match | null>(null);
  const [statsModalData, setStatsModalData] = useState<PlayerStats[]>([]);

  // Sorting State
  const [seasonSort, setSeasonSort] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });
  const [matchSort, setMatchSort] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });

  useEffect(() => {
    const init = async () => {
        const [ls, currentSeason] = await Promise.all([storage.getLeagues(), storage.getCurrentSeason()]);
        setLeagues(ls);
        setState(s => ({ ...s, season: currentSeason }));
    };
    init();
  }, []);

  useEffect(() => {
    if (state.currentLeague && state.view === 'dashboard') refreshDashboard(state.currentLeague, state.season);
  }, [state.currentLeague, state.view, state.season]);

  const refreshDashboard = async (league: AgeGroup, season: string) => {
    setLoading(true);
    try { const [m, t] = await Promise.all([storage.getMatches(league, season), storage.getTeams(league, season)]); setMatches(m); setTeams(t); } 
    catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleStartGame = async (finalHomeId: string, finalAwayId: string, homeLineup: Player[], awayLineup: Player[]) => {
    if (!state.currentLeague) return;
    try {
        setLoading(true);

        const syncSubs = async (teamId: string, lineup: Player[]) => {
            const team = teams.find(t => t.id === teamId);
            if (!team) return;
            
            const newPlayers = lineup.filter(p => !team.players.find(tp => tp.id === p.id));
            if (newPlayers.length > 0) {
                const updatedTeam = { ...team, players: [...team.players, ...newPlayers] };
                await storage.updateTeam(updatedTeam);
                setTeams(prev => prev.map(t => t.id === teamId ? updatedTeam : t));
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
  };

  const handleLogout = () => {
      setUserRole('fan');
      setState({...state, view: 'league_select', currentLeague: null, currentMatchId: null}); 
  };
  
  const openAdminDashboard = () => {
      if (userRole === 'admin') {
          setState({ ...state, view: 'admin' });
      }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await storage.verifyPassword(passwordInput);
    setLoading(false);
    
    if (result.success && result.role) {
      setUserRole(result.role);
      setShowLoginModal(false);
      if (result.role === 'admin') setState({...state, view: 'admin'}); 
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
        className={`px-4 py-3 cursor-pointer hover:bg-slate-200 transition-colors select-none ${align} ${colorClass}`}
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

  const calculateStandings = () => {
    const stats: Record<string, { wins: number; losses: number; ties: number; pf: number; pa: number }> = {};
    teams.forEach(t => { stats[t.id] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 }; });

    matches.forEach(m => {
        if (!m.isComplete) return; 
        
        const getScore = (side: 'home' | 'away') => {
            const sideData = side === 'home' ? m.innings.map(i => i.home) : m.innings.map(i => i.away);
            return sideData.reduce((acc, inning) => acc + inning.playerScores.reduce((pAcc, p) => pAcc + p.pitches.reduce((pitchAcc, pitch) => pitchAcc + (pitch.points || 0), 0), 0), 0);
        };
        
        let homeScore = getScore('home');
        let awayScore = getScore('away');

        if (m.tieBreaker) {
            m.tieBreaker.forEach(tb => {
                homeScore += tb.homeScores.reduce((a,b)=>a+b,0);
                awayScore += tb.awayScores.reduce((a,b)=>a+b,0);
            });
        }

        if (stats[m.homeTeamId]) { stats[m.homeTeamId].pf += homeScore; stats[m.homeTeamId].pa += awayScore; }
        if (stats[m.awayTeamId]) { stats[m.awayTeamId].pf += awayScore; stats[m.awayTeamId].pa += homeScore; }

        if (homeScore > awayScore) {
            if (stats[m.homeTeamId]) stats[m.homeTeamId].wins++;
            if (stats[m.awayTeamId]) stats[m.awayTeamId].losses++;
        } else if (awayScore > homeScore) {
            if (stats[m.awayTeamId]) stats[m.awayTeamId].wins++;
            if (stats[m.homeTeamId]) stats[m.homeTeamId].losses++;
        } else {
            if (stats[m.homeTeamId]) stats[m.homeTeamId].ties++;
            if (stats[m.awayTeamId]) stats[m.awayTeamId].ties++;
        }
    });

    return teams.map(t => ({ ...t, stats: stats[t.id] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 } })).sort((a, b) => {
        if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
        return b.stats.pf - a.stats.pf;
    });
  };

  const calculateSeasonLeaders = () => {
      const playerStatsMap = new Map<string, PlayerStats>();
      teams.forEach(t => {
          t.players.forEach(p => {
              playerStatsMap.set(p.id, {
                  playerId: p.id, name: p.name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0
              });
          });
      });

      matches.filter(m => m.isComplete).forEach(m => {
          const home = teams.find(t => t.id === m.homeTeamId);
          const away = teams.find(t => t.id === m.awayTeamId);
          if (home && away) {
              const matchStats = storage.calculateMatchStats(m, home, away);
              matchStats.forEach(stat => {
                  if (!playerStatsMap.has(stat.playerId)) playerStatsMap.set(stat.playerId, { ...stat });
                  else {
                       const existing = playerStatsMap.get(stat.playerId)!;
                       existing.totalPoints += stat.totalPoints;
                       existing.hits4 += stat.hits4;
                       existing.hits3 += stat.hits3;
                       existing.hits2 += stat.hits2;
                       existing.hits1 += stat.hits1;
                       existing.pitchesSeen += stat.pitchesSeen;
                  }
              });
          }
      });

      const rawList = Array.from(playerStatsMap.values())
          .filter(p => p.playerId !== 'ghost-player-3' && p.name !== 'Player 3 (Team Stats)');
      
      return performSort(rawList, seasonSort);
  };

  // --- WEEKLY LEADERS CALCULATION ---
  const calculateWeeklyLeaders = () => {
      if (!state.currentLeague) return { topInnings: [], topTotals: [] };

      const now = new Date();
      const day = now.getDay(); 
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); 
      const monday = new Date(now.setDate(diff));
      monday.setHours(0,0,0,0);
      
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);

      const weeklyMatches = matches.filter(m => {
          const d = new Date(m.date);
          // Filter by League AND Date AND Completion
          return m.league === state.currentLeague && m.isComplete && d >= monday && d < nextMonday;
      });

      const singleInningBest: { name: string; score: number; team: string; date: string }[] = [];
      const matchTotalBest: { name: string; score: number; team: string; date: string }[] = [];

      weeklyMatches.forEach(m => {
          const home = teams.find(t => t.id === m.homeTeamId);
          const away = teams.find(t => t.id === m.awayTeamId);
          if(!home || !away) return;

          const processSide = (team: Team, sideData: any) => {
               const playerMatchTotals = new Map<string, number>();

               m.innings.forEach(inning => {
                   const iData = sideData(inning); 
                   iData.playerScores.forEach((ps: any) => {
                       const inningScore = ps.pitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
                       
                       const pName = team.players.find(p => p.id === ps.playerId)?.name || 'Sub';
                       if (pName !== 'Player 3 (Team Stats)') { 
                           singleInningBest.push({ name: pName, score: inningScore, team: team.name, date: m.date });
                           playerMatchTotals.set(ps.playerId, (playerMatchTotals.get(ps.playerId) || 0) + inningScore);
                       }
                   });
               });
               
               playerMatchTotals.forEach((score, pId) => {
                   const pName = team.players.find(p => p.id === pId)?.name || 'Sub';
                   matchTotalBest.push({ name: pName, score, team: team.name, date: m.date });
               });
          };

          processSide(home, (i: any) => i.home);
          processSide(away, (i: any) => i.away);
      });

      const topInnings = singleInningBest.sort((a,b) => b.score - a.score).slice(0, 3);
      const topTotals = matchTotalBest.sort((a,b) => b.score - a.score).slice(0, 3);

      return { topInnings, topTotals };
  };

  const weeklyStats = calculateWeeklyLeaders();

  const navbarProps = {
      currentLeague: state.currentLeague,
      currentSeason: state.season,
      leagues: leagues,
      userRole: userRole,
      showLeagueHomeButton: state.view !== 'dashboard' && !!state.currentLeague, // Logic: Only show button if we have a league but are NOT on the dashboard
      onGoHome: () => setState({ ...state, view: 'dashboard' }),
      onSwitchLeague: () => setState({ ...state, view: 'league_select', currentLeague: null, currentMatchId: null }),
      onSelectLeague: handleSelectLeague,
      onLogin: openLoginModal,
      onLogout: handleLogout,
      onAdminDashboard: openAdminDashboard,
      onSeasonChange: handleSeasonChange
  };

  if (state.view === 'league_select') {
    const sortedLeagues = [...leagues].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 font-sans">
        <Navbar {...navbarProps} />
        
        <div className="text-center mb-8 mt-12">
            <h1 className="text-4xl font-bold text-white tracking-tight mb-2 font-sans">Dugout Hitting League</h1>
            <p className="text-slate-400 text-lg font-sans">Select a league to view <span className="text-blue-400 font-bold font-sans">{state.season}</span> season</p>
            {userRole === 'fan' && <p className="text-xs text-slate-500 mt-2 font-sans">Read-Only Fan Mode</p>}
            {userRole !== 'fan' && <div className="mt-2"><span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider font-sans">Logged in as {userRole}</span></div>}
        </div>
        
        {leagues.length === 0 ? (
            <div className="text-center bg-slate-800 p-8 rounded-xl border border-slate-700 max-w-md font-sans">
                <p className="text-slate-300 mb-4 font-sans">No leagues found.</p>
                <button onClick={openLoginModal} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-500 transition-colors font-sans">Log In to Create League</button>
            </div>
        ) : (
            <div className="flex flex-wrap justify-center gap-6 w-full max-w-6xl px-4">
            {sortedLeagues.map(league => (
                <button key={league.id} onClick={() => handleSelectLeague(league.id)} className="bg-white hover:bg-slate-50 text-slate-900 p-6 rounded-2xl shadow-2xl transition-transform hover:scale-105 group w-full sm:w-64 aspect-[4/3] sm:aspect-square flex flex-col items-center justify-center">
                    <span className="block text-3xl sm:text-4xl font-black mb-2 group-hover:text-blue-600 transition-colors uppercase text-center w-full break-words leading-tight font-sans">{league.id}</span>
                    <span className="block text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap font-sans">{state.season} Season</span>
                </button>
            ))}
            </div>
        )}
        
        {showLoginModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowLoginModal(false)}>
            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200 font-sans" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-800 mb-4 text-center font-sans">Access Control</h3>
              <p className="text-sm text-slate-500 mb-4 text-center font-sans">Enter password for Umpire or Admin access.</p>
              <form onSubmit={handleLoginSubmit}>
                <div className="mb-4">
                  <input type="password" autoFocus className={`w-full border rounded-lg px-4 py-3 text-lg outline-none focus:ring-2 ${loginError ? 'border-red-300 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`} value={passwordInput} onChange={e => setPasswordInput(e.target.value)} placeholder="Password" />
                  {loginError && <p className="text-red-500 text-xs mt-2 font-bold font-sans">{loginError}</p>}
                </div>
                <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors font-sans">{loading ? 'Verifying...' : 'Log In'}</button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }
  if (state.view === 'admin') return <AdminDashboard onBack={() => setState({ ...state, view: 'league_select' })} />;
  if (state.view === 'match_setup' && selectedHomeId && selectedAwayId && state.currentLeague) {
    const homeTeam = teams.find(t => t.id === selectedHomeId);
    const awayTeam = teams.find(t => t.id === selectedAwayId);
    if (homeTeam && awayTeam) return <MatchSetup homeTeam={homeTeam} awayTeam={awayTeam} onStart={handleStartGame} onCancel={() => setState({ ...state, view: 'dashboard' })} />;
  }
  if (state.view === 'scoring' && state.currentMatchId) return <Scoreboard matchId={state.currentMatchId} onExit={() => setState({ ...state, view: 'dashboard', currentMatchId: null })} isReadOnly={userRole === 'fan'} />;
  if (state.view === 'team_management' && state.currentLeague) return <TeamManagement league={state.currentLeague} season={state.season} onBack={() => setState({ ...state, view: 'dashboard' })} />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <Navbar {...navbarProps} />
      <main className="max-w-7xl mx-auto p-4 sm:p-8">
        <div className={`grid grid-cols-1 ${userRole !== 'fan' ? 'lg:grid-cols-3' : ''} gap-8`}>
            
            {userRole !== 'fan' && (
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-lg font-bold text-slate-700 mb-4 font-sans">League Status ({state.season})</h2>
                    <div className="flex justify-between text-center"><div><div className="text-3xl font-black text-slate-900 font-sans">{teams.length}</div><div className="text-xs text-slate-500 uppercase font-bold font-sans">Teams</div></div></div>
                    <button onClick={() => setState({ ...state, view: 'team_management' })} className="w-full mt-6 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors font-sans">Manage Teams & Stats</button>
                </div>
                <div className="bg-blue-600 p-6 rounded-xl shadow-lg text-white">
                    <h2 className="text-xl font-bold mb-4 font-sans">Start New Match</h2>
                    <div className="space-y-3">
                        <select className="w-full p-2 rounded text-slate-900 font-sans" value={selectedHomeId} onChange={(e) => setSelectedHomeId(e.target.value)}><option value="">Select Home Team...</option>{teams.map(t => <option key={t.id} value={t.id} disabled={t.id === selectedAwayId}>{t.name}</option>)}</select>
                        <select className="w-full p-2 rounded text-slate-900 font-sans" value={selectedAwayId} onChange={(e) => setSelectedAwayId(e.target.value)}><option value="">Select Away Team...</option>{teams.map(t => <option key={t.id} value={t.id} disabled={t.id === selectedHomeId}>{t.name}</option>)}</select>
                        <button disabled={!selectedHomeId || !selectedAwayId} onClick={() => setState({ ...state, view: 'match_setup' })} className="w-full bg-white text-blue-600 font-bold py-3 rounded-lg mt-4 hover:bg-blue-50 disabled:opacity-50 transition-colors font-sans">Next: Set Lineup</button>
                    </div>
                </div>
                <div className="text-center">
                     <span className="bg-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider font-sans">Role: {userRole}</span>
                     <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-600 ml-2 underline font-sans">Log Out</button>
                </div>
            </div>
            )}

            <div className={`${userRole !== 'fan' ? 'lg:col-span-2' : 'col-span-1'}`}>
                <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl shadow-md p-6 mb-8 text-white">
                    <h3 className="font-bold text-white/90 uppercase tracking-wider text-sm mb-4 border-b border-white/20 pb-2 font-sans">Weekly Leaders ({state.currentLeague})</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <h4 className="font-bold text-lg mb-2 font-sans">Best Total Score</h4>
                            {weeklyStats.topTotals.length > 0 ? (
                                <ul className="space-y-2">
                                    {weeklyStats.topTotals.map((s, idx) => (
                                        <li key={idx} className="flex justify-between items-center bg-white/10 p-2 rounded">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold bg-white text-indigo-600 w-6 h-6 flex items-center justify-center rounded-full text-xs font-sans">{idx+1}</span>
                                                <span className="font-semibold font-sans">{s.name}</span>
                                                <span className="text-xs text-white/70 font-sans">({s.team})</span>
                                            </div>
                                            <span className="font-mono font-bold text-xl">{s.score}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="text-white/50 italic text-sm font-sans">No matches yet this week.</p>}
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-2 font-sans">Best Single Inning</h4>
                             {weeklyStats.topInnings.length > 0 ? (
                                <ul className="space-y-2">
                                    {weeklyStats.topInnings.map((s, idx) => (
                                        <li key={idx} className="flex justify-between items-center bg-white/10 p-2 rounded">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold bg-white text-purple-600 w-6 h-6 flex items-center justify-center rounded-full text-xs font-sans">{idx+1}</span>
                                                <span className="font-semibold font-sans">{s.name}</span>
                                                <span className="text-xs text-white/70 font-sans">({s.team})</span>
                                            </div>
                                            <span className="font-mono font-bold text-xl">{s.score}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="text-white/50 italic text-sm font-sans">No matches yet this week.</p>}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 mb-6 border-b border-slate-200 pb-1 overflow-x-auto">
                    <button onClick={() => setDashboardTab('matches')} className={`text-lg sm:text-xl font-bold pb-2 px-2 transition-colors border-b-2 whitespace-nowrap font-sans ${dashboardTab === 'matches' ? 'text-slate-800 border-blue-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>Matches</button>
                    <button onClick={() => setDashboardTab('standings')} className={`text-lg sm:text-xl font-bold pb-2 px-2 transition-colors border-b-2 whitespace-nowrap font-sans ${dashboardTab === 'standings' ? 'text-slate-800 border-blue-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>Standings</button>
                    <button onClick={() => setDashboardTab('season_stats')} className={`text-lg sm:text-xl font-bold pb-2 px-2 transition-colors border-b-2 whitespace-nowrap font-sans ${dashboardTab === 'season_stats' ? 'text-slate-800 border-blue-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>Season Stats</button>
                </div>

                {dashboardTab === 'matches' && (
                    <div className="space-y-4">
                        {matches.map(match => {
                            const home = teams.find(t => t.id === match.homeTeamId);
                            const away = teams.find(t => t.id === match.awayTeamId);
                            if (!home || !away) return null;
                            return (
                                <div key={match.id} className="bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                    <div className="flex items-center gap-4 w-full sm:w-auto">
                                        <div className="shrink-0"><div className={`text-xs font-bold px-2 py-1 rounded-full font-sans ${match.isComplete ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-600'}`}>{match.isComplete ? 'FINAL' : 'LIVE'}</div></div>
                                        <div className="flex flex-1 sm:flex-auto items-center justify-between sm:justify-start sm:gap-8 w-full sm:w-auto">
                                            <div className="text-base sm:text-lg font-semibold text-slate-800 text-right font-sans">{home.name}</div>
                                            <div className="text-slate-300 text-sm sm:text-xl px-2 font-sans">vs</div>
                                            <div className="text-base sm:text-lg font-semibold text-slate-800 text-left font-sans">{away.name}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 w-full sm:w-auto justify-end">
                                    <button onClick={() => handleOpenMatchStats(match)} className="flex-1 sm:flex-none text-center px-3 py-2 rounded border border-slate-200 text-blue-600 hover:bg-blue-50 font-medium text-xs sm:text-sm transition-colors font-sans">Stats</button>
                                    
                                    <button onClick={() => setState({ ...state, view: 'scoring', currentMatchId: match.id })} className="flex-1 sm:flex-none text-center px-3 py-2 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium text-xs sm:text-sm transition-colors font-sans">
                                        {userRole === 'fan' ? (match.isComplete ? 'View' : 'Watch Live') : (match.isComplete ? 'View' : 'Score')}
                                    </button>
                                    
                                    {(userRole === 'admin' || userRole === 'umpire') && <button onClick={() => handleDeleteMatch(match.id)} className="flex-initial px-3 py-2 rounded border border-slate-200 text-red-500 hover:bg-red-50 font-medium text-xs sm:text-sm transition-colors font-sans">Delete</button>}
                                    </div>
                                </div>
                            );
                        })}
                        {matches.length === 0 && <div className="text-center py-10 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed font-sans">No matches found for this season.</div>}
                    </div>
                )}

                {dashboardTab === 'standings' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                         <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-100 text-slate-500 uppercase font-bold text-xs">
                                    <tr>
                                        <th className="px-4 py-3 w-12 text-center font-sans">#</th>
                                        <th className="px-4 py-3 font-sans">Team</th>
                                        <th className="px-4 py-3 text-center font-sans">W</th>
                                        <th className="px-4 py-3 text-center font-sans">L</th>
                                        <th className="px-4 py-3 text-center font-sans">T</th>
                                        <th className="px-4 py-3 text-center text-slate-400 font-sans">PF</th>
                                        <th className="px-4 py-3 text-center text-slate-400 font-sans">PA</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {calculateStandings().map((t, idx) => (
                                        <tr key={t.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-center font-bold text-slate-400 font-sans">{idx + 1}</td>
                                            <td className="px-4 py-3 font-bold text-slate-800 font-sans">{t.name}</td>
                                            <td className="px-4 py-3 text-center font-mono font-bold text-green-600">{t.stats.wins}</td>
                                            <td className="px-4 py-3 text-center font-mono font-bold text-red-600">{t.stats.losses}</td>
                                            <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">{t.stats.ties}</td>
                                            <td className="px-4 py-3 text-center font-mono text-slate-400">{t.stats.pf}</td>
                                            <td className="px-4 py-3 text-center font-mono text-slate-400">{t.stats.pa}</td>
                                        </tr>
                                    ))}
                                    {teams.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400 italic font-sans">No teams in this league.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {dashboardTab === 'season_stats' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                         <div className="p-4 bg-slate-50 border-b border-slate-200"><h3 className="font-bold text-slate-700 font-sans">Top 50 Players</h3></div>
                         <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-100 text-slate-500 uppercase font-bold text-xs">
                                    <tr>
                                        <th className="px-4 py-3 w-12 text-center font-sans">#</th>
                                        {renderSortHeader('Player', 'name', seasonSort, setSeasonSort, 'text-left')}
                                        {renderSortHeader('Total Pts', 'totalPoints', seasonSort, setSeasonSort)}
                                        {renderSortHeader('4s', 'hits4', seasonSort, setSeasonSort, 'text-right', 'text-rose-600')}
                                        {renderSortHeader('3s', 'hits3', seasonSort, setSeasonSort, 'text-right', 'text-amber-600')}
                                        {renderSortHeader('2s', 'hits2', seasonSort, setSeasonSort, 'text-right', 'text-green-600')}
                                        {renderSortHeader('1s', 'hits1', seasonSort, setSeasonSort, 'text-right', 'text-cyan-600')}
                                        {renderSortHeader('Pitches', 'pitchesSeen', seasonSort, setSeasonSort, 'text-right', 'text-slate-400')}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {calculateSeasonLeaders().slice(0, 50).map((p, idx) => (
                                        <tr key={p.playerId} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-center font-bold text-slate-400 font-sans">{idx + 1}</td>
                                            <td className="px-4 py-3 font-bold text-slate-800 font-sans">{p.name}</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-lg">{p.totalPoints}</td>
                                            <td className="px-4 py-3 text-right font-mono">{p.hits4}</td>
                                            <td className="px-4 py-3 text-right font-mono">{p.hits3}</td>
                                            <td className="px-4 py-3 text-right font-mono">{p.hits2}</td>
                                            <td className="px-4 py-3 text-right font-mono">{p.hits1}</td>
                                            <td className="px-4 py-3 text-right font-mono text-slate-400">{p.pitchesSeen}</td>
                                        </tr>
                                    ))}
                                    {calculateSeasonLeaders().length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400 italic font-sans">No stats available yet.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
        
        {showLoginModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowLoginModal(false)}>
            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200 font-sans" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-800 mb-4 text-center font-sans">Access Control</h3>
              <p className="text-sm text-slate-500 mb-4 text-center font-sans">Enter password for Umpire or Admin access.</p>
              <form onSubmit={handleLoginSubmit}>
                <div className="mb-4">
                  <input type="password" autoFocus className={`w-full border rounded-lg px-4 py-3 text-lg outline-none focus:ring-2 ${loginError ? 'border-red-300 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`} value={passwordInput} onChange={e => setPasswordInput(e.target.value)} placeholder="Password" />
                  {loginError && <p className="text-red-500 text-xs mt-2 font-bold font-sans">{loginError}</p>}
                </div>
                <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors font-sans">{loading ? 'Verifying...' : 'Log In'}</button>
              </form>
            </div>
          </div>
        )}

        {statsModalMatch && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setStatsModalMatch(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col transform scale-100 animate-in zoom-in-95 duration-200 font-sans" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800 font-sans">Match Statistics</h3>
                            <p className="text-sm text-slate-500 font-sans">{new Date(statsModalMatch.date).toLocaleDateString()}</p>
                        </div>
                        <button onClick={() => setStatsModalMatch(null)} className="text-slate-400 hover:text-slate-600 font-bold text-xl">&times;</button>
                    </div>
                    <div className="overflow-y-auto p-0">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 text-slate-500 uppercase font-bold text-xs sticky top-0 z-10">
                                <tr>
                                    {renderSortHeader('Player', 'name', matchSort, setMatchSort, 'text-left', 'px-6')}
                                    {renderSortHeader('Total Pts', 'totalPoints', matchSort, setMatchSort)}
                                    {renderSortHeader('4s', 'hits4', matchSort, setMatchSort, 'text-right', 'text-rose-600')}
                                    {renderSortHeader('3s', 'hits3', matchSort, setMatchSort, 'text-right', 'text-amber-600')}
                                    {renderSortHeader('2s', 'hits2', matchSort, setMatchSort, 'text-right', 'text-green-600')}
                                    {renderSortHeader('1s', 'hits1', matchSort, setMatchSort, 'text-right', 'text-cyan-600')}
                                    {renderSortHeader('Pitches', 'pitchesSeen', matchSort, setMatchSort, 'text-right', 'text-slate-400')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {performSort(statsModalData, matchSort).map(stat => (
                                    <tr key={stat.playerId} className="hover:bg-slate-50">
                                        <td className="px-6 py-3 font-bold text-slate-800 font-sans">{stat.name}</td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-lg">{stat.totalPoints}</td>
                                        <td className="px-4 py-3 text-right font-mono">{stat.hits4}</td>
                                        <td className="px-4 py-3 text-right font-mono">{stat.hits3}</td>
                                        <td className="px-4 py-3 text-right font-mono">{stat.hits2}</td>
                                        <td className="px-4 py-3 text-right font-mono">{stat.hits1}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-400">{stat.pitchesSeen}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
                        <button onClick={() => setStatsModalMatch(null)} className="px-6 py-2 bg-white border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 font-sans">Close</button>
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;
