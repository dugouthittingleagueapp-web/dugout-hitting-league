import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { TeamManagement } from './components/TeamManagement';
import { MatchSetup } from './components/MatchSetup';
import { Scoreboard } from './components/Scoreboard';
import { AdminDashboard } from './components/AdminDashboard';
import { UserGuide } from './components/UserGuide';
import * as storage from './services/storageService';
import { generateLeagueReport } from './services/geminiService';
import { AppState, Team, Match, League, AgeGroup, Player } from './types';

// Login Modal
const LoginModal = ({ onClose, onLogin }: { onClose: () => void, onLogin: (role: 'admin' | 'umpire') => void }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleVerify = async () => {
    const res = await storage.verifyPassword(password);
    if (res.success && res.role) {
      onLogin(res.role);
    } else {
      setError('Invalid Password');
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-slate-200 dark:border-slate-800">
        <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-white font-sans">Staff Login</h3>
        <input 
          type="password" 
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Enter Password"
          className="w-full p-3 border border-slate-300 dark:border-slate-700 rounded-lg mb-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-sans"
          onKeyDown={e => e.key === 'Enter' && handleVerify()}
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mb-4 font-bold font-sans">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-bold font-sans hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">Cancel</button>
          <button onClick={handleVerify} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 font-sans transition-colors">Login</button>
        </div>
      </div>
    </div>
  );
};

// Main App Component
function App() {
  // --- STATE ---
  const [appState, setAppState] = useState<AppState>({
    view: 'league_select',
    currentLeague: null,
    currentMatchId: null,
    season: '2025',
    dashboardTab: 'matches'
  });
  
  const [userRole, setUserRole] = useState<'fan' | 'umpire' | 'admin'>('fan');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  
  // Data
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Gemini Report
  const [report, setReport] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Match Setup State
  const [pendingMatchTeams, setPendingMatchTeams] = useState<{home: Team, away: Team} | null>(null);

  // --- EFFECTS ---
  
  // Initial Load
  useEffect(() => {
    // Check system preference for dark mode
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDarkMode(true);
    }
    
    loadLeagues();
    loadCurrentSeason();
  }, []);

  // Fetch Data when League/Season changes
  useEffect(() => {
    if (appState.currentLeague && appState.season) {
      loadLeagueData(appState.currentLeague, appState.season);
    }
  }, [appState.currentLeague, appState.season]);

  const loadLeagues = async () => {
    const ls = await storage.getLeagues();
    setLeagues(ls);
  };
  
  const loadCurrentSeason = async () => {
      const s = await storage.getCurrentSeason();
      setAppState(prev => ({ ...prev, season: s }));
  };

  const loadLeagueData = async (league: AgeGroup, season: string) => {
    setLoading(true);
    const [t, m] = await Promise.all([
      storage.getTeams(league, season),
      storage.getMatches(league, season)
    ]);
    setTeams(t);
    setMatches(m);
    setLoading(false);
  };

  // --- ACTIONS ---

  const handleSelectLeague = (leagueId: string) => {
    setAppState(prev => ({ ...prev, view: 'dashboard', currentLeague: leagueId }));
  };

  const handleSwitchLeague = () => {
      setAppState(prev => ({ ...prev, view: 'league_select', currentLeague: null }));
  };

  const handleLogin = (role: 'admin' | 'umpire') => {
    setUserRole(role);
    setShowLogin(false);
  };
  
  const handleLogout = () => {
      setUserRole('fan');
      setAppState(prev => ({ ...prev, view: 'league_select', currentLeague: null }));
  };

  const handleGenerateReport = async () => {
      setGeneratingReport(true);
      try {
          const text = await generateLeagueReport();
          setReport(text);
      } catch(e) {
          alert("Failed to generate report.");
      }
      setGeneratingReport(false);
  };

  // Match Creation Flow
  const startMatchSetup = () => {
    setNewMatchModalOpen(true);
  };

  // --- RENDER HELPERS ---
  
  // Dashboard Render
  const renderDashboard = () => {
     if (!appState.currentLeague) return null;
     
     // Filter matches
     const leagueMatches = matches; // already filtered by API/loadLeagueData usually, but double check
     const upcomingMatches = leagueMatches.filter(m => !m.isComplete);
     const completedMatches = leagueMatches.filter(m => m.isComplete);
     
     // Standings Calculation
     const standings = teams.map(t => {
         const played = completedMatches.filter(m => m.homeTeamId === t.id || m.awayTeamId === t.id);
         const wins = played.filter(m => {
             const homeScore = m.innings.reduce((sum, i) => sum + i.home.playerScores.reduce((pSum, ps) => pSum + ps.pitches.reduce((v, p) => v + (p.points||0), 0), 0), 0) + (m.tieBreaker?.reduce((s, t) => s + t.homeScores.reduce((a,b)=>a+(b||0),0), 0) || 0);
             const awayScore = m.innings.reduce((sum, i) => sum + i.away.playerScores.reduce((pSum, ps) => pSum + ps.pitches.reduce((v, p) => v + (p.points||0), 0), 0), 0) + (m.tieBreaker?.reduce((s, t) => s + t.awayScores.reduce((a,b)=>a+(b||0),0), 0) || 0);
             return (m.homeTeamId === t.id && homeScore > awayScore) || (m.awayTeamId === t.id && awayScore > homeScore);
         }).length;
         return { ...t, wins, losses: played.length - wins, played: played.length };
     }).sort((a,b) => b.wins - a.wins || (b.played - b.losses) - (a.played - a.losses));

     return (
       <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-24">
           {/* Actions Bar */}
           <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
               <div className="flex bg-slate-200 dark:bg-slate-800 p-1 rounded-xl">
                   <button 
                      onClick={() => setAppState(prev => ({ ...prev, dashboardTab: 'matches' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-bold font-sans transition-all ${appState.dashboardTab === 'matches' ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                   >Matches</button>
                   <button 
                      onClick={() => setAppState(prev => ({ ...prev, dashboardTab: 'standings' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-bold font-sans transition-all ${appState.dashboardTab === 'standings' ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                   >Standings</button>
               </div>
               
               <div className="flex gap-2 w-full sm:w-auto">
                   <button onClick={() => setShowGuide(true)} className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-bold text-xs sm:text-sm font-sans flex items-center justify-center gap-2">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                       Rules
                   </button>
                   {userRole !== 'fan' && (
                       <>
                           <button onClick={() => setAppState(prev => ({ ...prev, view: 'team_management' }))} className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-bold text-xs sm:text-sm font-sans">
                               Teams
                           </button>
                           {teams.length >= 2 && (
                               <button onClick={() => setNewMatchModalOpen(true)} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs sm:text-sm shadow-lg shadow-blue-900/20 font-sans flex items-center justify-center gap-1">
                                   + New Match
                               </button>
                           )}
                       </>
                   )}
               </div>
           </div>
           
           {/* Content */}
           {appState.dashboardTab === 'matches' && (
               <div className="space-y-4">
                   {matches.length === 0 && (
                       <div className="text-center py-12 bg-white/50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
                           <p className="text-slate-500 font-sans">No matches scheduled yet.</p>
                           {userRole !== 'fan' && teams.length >= 2 && <button onClick={() => setNewMatchModalOpen(true)} className="mt-4 text-blue-600 font-bold hover:underline font-sans">Start a Match</button>}
                       </div>
                   )}
                   
                   {matches.map(match => {
                       const home = teams.find(t => t.id === match.homeTeamId) || { name: 'Unknown', players: [], league: '' } as Team;
                       const away = teams.find(t => t.id === match.awayTeamId) || { name: 'Unknown', players: [], league: '' } as Team;
                       
                       // Calculate scores for display
                       const getScore = (m: Match, side: 'home'|'away') => {
                           let total = m.innings.reduce((sum, i) => {
                               const inningSide = side === 'home' ? i.home : i.away;
                               return sum + inningSide.playerScores.reduce((pSum, ps) => pSum + ps.pitches.reduce((v, p) => v + (p.points||0), 0), 0);
                           }, 0);
                           if (m.tieBreaker) {
                               total += m.tieBreaker.reduce((s, tb) => s + (side === 'home' ? tb.homeScores : tb.awayScores).reduce((a,b)=>a+(b||0),0), 0);
                           }
                           return total;
                       };
                       
                       const homeScore = getScore(match, 'home');
                       const awayScore = getScore(match, 'away');
                       
                       return (
                           <div key={match.id} onClick={() => openMatch(match.id)} className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                     <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto min-w-0 flex-1">
                                        <div className="shrink-0"><div className={`text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded font-sans border ${match.isComplete ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-500/30 animate-pulse'}`}>{match.isComplete ? 'FINAL' : 'LIVE'}</div></div>
                                        <div className="flex flex-1 sm:flex-auto items-center sm:justify-start sm:gap-8 w-full sm:w-auto min-w-0">
                                            <div className="flex-1 sm:flex-none sm:w-40 text-xs sm:text-lg font-bold text-red-700 dark:text-red-400 text-right font-sans leading-tight break-words line-clamp-2 min-w-0">{home.name}</div>
                                            <div className="shrink-0 text-slate-400 dark:text-slate-600 text-[10px] sm:text-base px-1 sm:px-2 font-sans italic font-bold">VS</div>
                                            <div className="flex-1 sm:flex-none sm:w-40 text-xs sm:text-lg font-bold text-blue-700 dark:text-blue-400 text-left font-sans leading-tight break-words line-clamp-2 min-w-0">{away.name}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-6 sm:gap-8 justify-center w-full sm:w-auto border-t sm:border-t-0 border-slate-100 dark:border-slate-800 pt-2 sm:pt-0">
                                        <div className="text-center">
                                            <div className="text-2xl font-black text-slate-800 dark:text-white tabular-nums font-sans leading-none">{homeScore}</div>
                                        </div>
                                        <div className="text-slate-300 dark:text-slate-600 font-light text-xl">-</div>
                                        <div className="text-center">
                                            <div className="text-2xl font-black text-slate-800 dark:text-white tabular-nums font-sans leading-none">{awayScore}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="hidden sm:block text-slate-400 dark:text-slate-600">
                                        <svg className="w-5 h-5 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                                    </div>
                                </div>
                           </div>
                       );
                   })}
               </div>
           )}

           {appState.dashboardTab === 'standings' && (
               <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                   <table className="w-full text-left text-sm">
                       <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold text-xs">
                           <tr>
                               <th className="px-4 py-3 font-sans">Team</th>
                               <th className="px-4 py-3 text-center font-sans">W</th>
                               <th className="px-4 py-3 text-center font-sans">L</th>
                               <th className="px-4 py-3 text-center font-sans">GP</th>
                           </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                           {standings.map((t, i) => (
                               <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                   <td className="px-4 py-3 font-bold text-slate-800 dark:text-white font-sans flex items-center gap-2">
                                       <span className="text-slate-400 w-4">{i+1}.</span>
                                       {t.name}
                                   </td>
                                   <td className="px-4 py-3 text-center font-bold text-green-600 dark:text-green-400 font-sans">{t.wins}</td>
                                   <td className="px-4 py-3 text-center font-bold text-red-600 dark:text-red-400 font-sans">{t.losses}</td>
                                   <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-400 font-sans">{t.played}</td>
                               </tr>
                           ))}
                           {standings.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic font-sans">No teams in this league yet.</td></tr>}
                       </tbody>
                   </table>
               </div>
           )}
           
           {/* Gemini Report Button */}
           <div className="mt-8">
               <button onClick={handleGenerateReport} disabled={generatingReport} className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-purple-900/20 hover:from-purple-500 hover:to-indigo-500 transition-all font-sans flex items-center justify-center gap-2">
                    {generatingReport ? (
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    )}
                    Generate AI League Report
               </button>
               {report && (
                   <div className="mt-4 p-6 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 rounded-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                       <h4 className="font-black uppercase text-purple-800 dark:text-purple-300 mb-2 font-sans flex items-center gap-2">
                           <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                           Gemini Insights
                       </h4>
                       <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">{report}</p>
                   </div>
               )}
           </div>
       </div>
     );
  };

  // --- ACTIONS & MODALS ---
  
  const [newMatchModalOpen, setNewMatchModalOpen] = useState(false);
  const [selectedHomeId, setSelectedHomeId] = useState('');
  const [selectedAwayId, setSelectedAwayId] = useState('');

  const handleCreateMatchSetup = () => {
      const home = teams.find(t => t.id === selectedHomeId);
      const away = teams.find(t => t.id === selectedAwayId);
      if(home && away) {
          setPendingMatchTeams({home, away});
          setNewMatchModalOpen(false);
          setAppState(prev => ({ ...prev, view: 'match_setup' }));
      }
  };

  const openMatch = (matchId: string) => {
      setAppState(prev => ({ ...prev, view: 'scoring', currentMatchId: matchId }));
  };

  const startScoring = async (homeId: string, awayId: string, homeLineup: Player[], awayLineup: Player[]) => {
      if(!appState.currentLeague) return;
      
      const homeIds = homeLineup.map(p=>p.id);
      const awayIds = awayLineup.map(p=>p.id);
      
      try {
          const newMatch = await storage.createMatch(appState.currentLeague, homeId, awayId, homeIds, awayIds, appState.season);
          setMatches(prev => [newMatch, ...prev]);
          setAppState(prev => ({ ...prev, view: 'scoring', currentMatchId: newMatch.id }));
          setPendingMatchTeams(null);
      } catch (e) {
          alert("Failed to create match");
      }
  };

  // Scoreboard Handlers
  const currentMatch = matches.find(m => m.id === appState.currentMatchId);
  
  const updateScore = async (inningIdx: number, teamId: string, lineupIdx: number, pitchIdx: number, score: number) => {
      if(!currentMatch) return;
      const newInnings = [...currentMatch.innings];
      const teamSide = newInnings[inningIdx].home.teamId === 'home' && currentMatch.homeTeamId === teamId ? 'home' : 'away';
      
      // Update specific pitch
      if (teamSide === 'home') {
          newInnings[inningIdx].home.playerScores[lineupIdx].pitches[pitchIdx].points = score;
      } else {
          newInnings[inningIdx].away.playerScores[lineupIdx].pitches[pitchIdx].points = score;
      }
      
      const updated = { ...currentMatch, innings: newInnings };
      
      // Optimistic Update
      setMatches(prev => prev.map(m => m.id === updated.id ? updated : m));
      
      // API call
      await storage.updateMatch(updated);
  };

  const updateTieBreaker = async (roundIdx: number, teamId: string, pitchIdx: number, score: number) => {
      if(!currentMatch || !currentMatch.tieBreaker) return;
      const newTB = [...currentMatch.tieBreaker];
      const isHome = teamId === currentMatch.homeTeamId;
      
      if(isHome) newTB[roundIdx].homeScores[pitchIdx] = score;
      else newTB[roundIdx].awayScores[pitchIdx] = score;
      
      const updated = { ...currentMatch, tieBreaker: newTB };
      setMatches(prev => prev.map(m => m.id === updated.id ? updated : m));
      await storage.updateMatch(updated);
  };
  
  const addTieBreakerRound = async () => {
      if(!currentMatch) return;
      const lastInning = currentMatch.innings[5]; // 6th inning
      const homePid = lastInning.home.playerScores[0].playerId;
      const awayPid = lastInning.away.playerScores[0].playerId;
      
      const newRound = {
          roundNumber: (currentMatch.tieBreaker?.length || 0) + 1,
          pitchLimit: 5,
          homePlayerId: homePid,
          awayPlayerId: awayPid,
          homeScores: Array(5).fill(null),
          awayScores: Array(5).fill(null)
      };
      
      const updated = { ...currentMatch, tieBreaker: [...(currentMatch.tieBreaker || []), newRound] };
      setMatches(prev => prev.map(m => m.id === updated.id ? updated : m));
      await storage.updateMatch(updated);
  };

  const completeGame = async () => {
      if(!currentMatch) return;
      const updated = { ...currentMatch, isComplete: true };
      setMatches(prev => prev.map(m => m.id === updated.id ? updated : m));
      await storage.updateMatch(updated);
      setAppState(prev => ({ ...prev, view: 'dashboard' }));
  };
  
  const restoreRoster = async (teamId: string, inningIdx: number) => {
      if(!currentMatch) return;
      try {
        const updated = await storage.restoreTeamRoster(currentMatch.id, teamId, inningIdx);
        setMatches(prev => prev.map(m => m.id === updated.id ? updated : m));
      } catch(e) {
        alert("Failed to restore roster.");
      }
  };

  // --- MAIN RENDER SWITCH ---
  
  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors">
        
        {/* Navigation */}
        <Navbar 
            currentLeague={appState.currentLeague}
            currentSeason={appState.season}
            leagues={leagues}
            userRole={userRole}
            onGoHome={handleSwitchLeague}
            onSwitchLeague={handleSwitchLeague}
            onSelectLeague={handleSelectLeague}
            onLogin={() => setShowLogin(true)}
            onLogout={handleLogout}
            onAdminDashboard={() => setAppState(prev => ({ ...prev, view: 'admin' }))}
            onSeasonChange={s => setAppState(prev => ({ ...prev, season: s }))}
            isDarkMode={isDarkMode}
            toggleTheme={() => setIsDarkMode(!isDarkMode)}
            isMenuOpen={isMenuOpen}
            setMenuOpen={setMenuOpen}
        />
        
        {/* Modals */}
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} />}
        {showGuide && <UserGuide onClose={() => setShowGuide(false)} />}
        
        {/* Team Selector Modal for New Match */}
        {newMatchModalOpen && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800">
                    <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-white font-sans">Start New Match</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Home Team</label>
                            <select className="w-full p-3 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-sans dark:text-white" value={selectedHomeId} onChange={e => setSelectedHomeId(e.target.value)}>
                                <option value="">Select Team...</option>
                                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Away Team</label>
                            <select className="w-full p-3 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-sans dark:text-white" value={selectedAwayId} onChange={e => setSelectedAwayId(e.target.value)}>
                                <option value="">Select Team...</option>
                                {teams.filter(t => t.id !== selectedHomeId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-3 mt-6">
                        <button onClick={() => setNewMatchModalOpen(false)} className="flex-1 py-3 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold font-sans">Cancel</button>
                        <button onClick={handleCreateMatchSetup} disabled={!selectedHomeId || !selectedAwayId} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold font-sans hover:bg-blue-700 disabled:opacity-50">Next: Set Lineup</button>
                    </div>
                </div>
            </div>
        )}

        {/* Views */}
        
        {/* LEAGUE SELECT (Landing) */}
        {appState.view === 'league_select' && (
            <div className="max-w-7xl mx-auto px-4 py-12 flex flex-col items-center">
                <div className="text-center mb-12 animate-in slide-in-from-bottom-4 duration-700">
                    <h1 className="text-4xl sm:text-6xl font-black italic uppercase text-slate-900 dark:text-white mb-4 tracking-tighter">
                        Select Your <span className="text-blue-600 dark:text-blue-400">League</span>
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-lg font-bold font-sans max-w-2xl mx-auto">
                        Welcome to the Dugout Hitting League. Choose a league to view standings, schedules, and live match scores.
                    </p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-5xl">
                    {leagues.map((l, i) => (
                        <button 
                            key={l.id} 
                            onClick={() => handleSelectLeague(l.id)}
                            className="group relative overflow-hidden bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 border border-slate-200 dark:border-slate-800 text-left"
                            style={{ animationDelay: `${i * 100}ms` }}
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <svg className="w-24 h-24 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 24 24"><path d="M15.18 4L12.5 15.63H9.82L12.5 4h2.68zm2.68 15.63l2.68-11.63h-2.68l-2.68 11.63h2.68zm-8.04 0L7.14 8H4.46l2.68 11.63h2.68z"/></svg>
                            </div>
                            <h3 className="text-3xl font-black italic uppercase text-slate-800 dark:text-white mb-2 relative z-10">{l.id}</h3>
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-sm uppercase tracking-wider relative z-10 font-sans">
                                Enter League 
                                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                            </div>
                        </button>
                    ))}
                    {leagues.length === 0 && (
                        <div className="col-span-full text-center py-12 text-slate-400 font-sans">
                            No leagues found. <button onClick={() => setShowLogin(true)} className="text-blue-500 underline">Login as Admin</button> to create one.
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* DASHBOARD */}
        {appState.view === 'dashboard' && renderDashboard()}
        
        {/* TEAM MANAGEMENT */}
        {appState.view === 'team_management' && appState.currentLeague && (
            <TeamManagement 
                league={appState.currentLeague} 
                season={appState.season}
                onBack={() => setAppState(prev => ({ ...prev, view: 'dashboard' }))} 
            />
        )}
        
        {/* MATCH SETUP */}
        {appState.view === 'match_setup' && pendingMatchTeams && (
            <MatchSetup 
                homeTeam={pendingMatchTeams.home}
                awayTeam={pendingMatchTeams.away}
                onCancel={() => { setPendingMatchTeams(null); setAppState(prev => ({ ...prev, view: 'dashboard' })); }}
                onStart={startScoring}
            />
        )}
        
        {/* SCORING / LIVE MATCH */}
        {appState.view === 'scoring' && currentMatch && (
            <>
                <div className="max-w-7xl mx-auto px-4 pt-4 pb-0">
                    <button onClick={() => setAppState(prev => ({ ...prev, view: 'dashboard', currentMatchId: null }))} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors font-bold text-sm font-sans mb-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        Back to Dashboard
                    </button>
                </div>
                <Scoreboard 
                    match={currentMatch}
                    teams={{ 
                        home: teams.find(t => t.id === currentMatch.homeTeamId)!, 
                        away: teams.find(t => t.id === currentMatch.awayTeamId)! 
                    }}
                    isReadOnly={userRole === 'fan'}
                    onUpdateScore={updateScore}
                    onUpdateTieBreaker={updateTieBreaker}
                    onCompleteGame={completeGame}
                    onAddTieBreakerRound={addTieBreakerRound}
                    onRestoreRoster={restoreRoster}
                />
            </>
        )}
        
        {/* ADMIN DASHBOARD */}
        {appState.view === 'admin' && (
            <AdminDashboard onBack={() => setAppState(prev => ({ ...prev, view: 'dashboard' }))} />
        )}

      </div>
    </div>
  );
}

export default App;