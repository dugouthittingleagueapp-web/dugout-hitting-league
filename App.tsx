import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from './components/Navbar';
import { TeamManagement } from './components/TeamManagement';
import { MatchSetup } from './components/MatchSetup';
import { Scoreboard } from './components/Scoreboard';
import { AdminDashboard } from './components/AdminDashboard';
import { UserGuide } from './components/UserGuide';
import * as storage from './services/storageService';
import { generateLeagueReport } from './services/geminiService';
import { AppState, League, Match, Team, Player, PlayerStats } from './types';

const App: React.FC = () => {
    // Application State
    const [view, setView] = useState<AppState['view']>('league_select');
    const [currentLeague, setCurrentLeague] = useState<string | null>(null);
    const [currentSeason, setCurrentSeason] = useState<string>('2025');
    const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
    const [dashboardTab, setDashboardTab] = useState<'matches' | 'standings' | 'season_stats'>('matches');

    // Data State
    const [leagues, setLeagues] = useState<League[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    
    // UI State
    const [userRole, setUserRole] = useState<'fan' | 'umpire' | 'admin'>('fan');
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showUserGuide, setShowUserGuide] = useState(false);
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState<string | null>(null);
    const [generatingReport, setGeneratingReport] = useState(false);

    // Match Creation State
    const [showMatchCreator, setShowMatchCreator] = useState(false);
    const [selectedHomeTeamId, setSelectedHomeTeamId] = useState('');
    const [selectedAwayTeamId, setSelectedAwayTeamId] = useState('');
    const [setupTeams, setSetupTeams] = useState<{home: Team, away: Team} | null>(null);

    // Initialization
    useEffect(() => {
        const init = async () => {
            const [ls, season] = await Promise.all([storage.getLeagues(), storage.getCurrentSeason()]);
            setLeagues(ls);
            setCurrentSeason(season);
            
            // Check Theme
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                setIsDarkMode(true);
            }
        };
        init();
    }, []);

    // Theme Effect
    useEffect(() => {
        if (isDarkMode) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
    }, [isDarkMode]);

    // Data Loader
    const loadLeagueData = async () => {
        if (!currentLeague) return;
        setLoading(true);
        const [ts, ms] = await Promise.all([
            storage.getTeams(currentLeague, currentSeason),
            storage.getMatches(currentLeague, currentSeason)
        ]);
        setTeams(ts);
        setMatches(ms);
        setLoading(false);
    };

    useEffect(() => {
        loadLeagueData();
    }, [currentLeague, currentSeason, view]);

    // Handlers
    const handleLogin = async () => {
        const pw = prompt("Enter Password:");
        if (!pw) return;
        const res = await storage.verifyPassword(pw);
        if (res.success && res.role) {
            setUserRole(res.role);
            alert(`Logged in as ${res.role.toUpperCase()}`);
        } else {
            alert("Invalid Password");
        }
    };

    const handleLogout = () => setUserRole('fan');

    const handleGenerateReport = async () => {
        setGeneratingReport(true);
        try {
            const text = await generateLeagueReport();
            setReport(text);
        } catch (e) {
            alert("Failed to generate report");
        }
        setGeneratingReport(false);
    };

    const prepareMatchSetup = () => {
        if (!selectedHomeTeamId || !selectedAwayTeamId || selectedHomeTeamId === selectedAwayTeamId) {
            alert("Please select two different teams.");
            return;
        }
        const home = teams.find(t => t.id === selectedHomeTeamId);
        const away = teams.find(t => t.id === selectedAwayTeamId);
        if (home && away) {
            setSetupTeams({ home, away });
            setShowMatchCreator(false);
            setView('match_setup');
        }
    };

    const handleStartMatch = async (homeId: string, awayId: string, homeLineup: Player[], awayLineup: Player[]) => {
        try {
            const homeIds = homeLineup.map(p => p.id);
            const awayIds = awayLineup.map(p => p.id);
            if(currentLeague) {
                const newMatch = await storage.createMatch(currentLeague, homeId, awayId, homeIds, awayIds, currentSeason);
                setCurrentMatchId(newMatch.id);
                setView('scoring');
            }
        } catch (e) {
            console.error(e);
            alert("Failed to start match");
        }
    };

    // --- Standings Calculation ---
    const standingsData = useMemo(() => {
        const stats: Record<string, { name: string, gp: number, w: number, l: number, t: number, ptsFor: number, ptsAgainst: number }> = {};
        teams.forEach(t => {
            stats[t.id] = { name: t.name, gp: 0, w: 0, l: 0, t: 0, ptsFor: 0, ptsAgainst: 0 };
        });

        matches.filter(m => m.isComplete).forEach(m => {
            const home = stats[m.homeTeamId];
            const away = stats[m.awayTeamId];
            if (!home || !away) return;

            const getScore = (innings: any, side: 'home' | 'away') => {
                let score = innings.reduce((acc: number, inn: any) => {
                    return acc + inn[side].playerScores.reduce((pAcc: number, ps: any) => {
                        return pAcc + ps.pitches.reduce((piAcc: number, pi: any) => piAcc + (pi.points || 0), 0);
                    }, 0);
                }, 0);
                
                if (m.tieBreaker) {
                    m.tieBreaker.forEach((tb: any) => {
                         const tbScores = side === 'home' ? tb.homeScores : tb.awayScores;
                         score += tbScores.reduce((a:number,b:number) => (a||0)+(b||0), 0);
                    });
                }
                return score;
            };

            const homeScore = getScore(m.innings, 'home');
            const awayScore = getScore(m.innings, 'away');

            home.gp++;
            away.gp++;
            home.ptsFor += homeScore;
            home.ptsAgainst += awayScore;
            away.ptsFor += awayScore;
            away.ptsAgainst += homeScore;

            if (homeScore > awayScore) { home.w++; away.l++; }
            else if (awayScore > homeScore) { away.w++; home.l++; }
            else { home.t++; away.t++; }
        });

        return Object.values(stats).sort((a, b) => b.w - a.w || b.ptsFor - a.ptsFor);
    }, [matches, teams]);

    // --- Season Stats Calculation ---
    const seasonStatsData = useMemo(() => {
        const pStats = new Map<string, PlayerStats>();
        const getOrInit = (id: string, name: string): PlayerStats => {
            if (!pStats.has(id)) {
                pStats.set(id, { playerId: id, name, totalPoints: 0, hits4: 0, hits3: 0, hits2: 0, hits1: 0, pitchesSeen: 0 });
            }
            return pStats.get(id)!;
        };

        matches.filter(m => m.isComplete).forEach(m => {
             m.innings.forEach(inn => {
                 [inn.home, inn.away].forEach(sideData => {
                     // Check for Ghost Mode (2 players getting 15 pitches)
                     const isGhostMode = sideData.playerScores.length === 2 && sideData.playerScores[0].pitches.length >= 15;
                     
                     sideData.playerScores.forEach(ps => {
                         // Find player name from teams array
                         const homeT = teams.find(t => t.id === m.homeTeamId);
                         const awayT = teams.find(t => t.id === m.awayTeamId);
                         let playerObj = homeT?.players.find(p => p.id === ps.playerId) || homeT?.subs?.find(p => p.id === ps.playerId) ||
                                         awayT?.players.find(p => p.id === ps.playerId) || awayT?.subs?.find(p => p.id === ps.playerId);
                         
                         const displayName = playerObj ? `${playerObj.name}${playerObj.lastName ? ' ' + playerObj.lastName.charAt(0) + '.' : ''}` : 'Unknown';
                         const stat = getOrInit(ps.playerId, displayName);

                         // Only count first 10 pitches if in Ghost Mode
                         const countablePitches = isGhostMode ? ps.pitches.slice(0, 10) : ps.pitches;

                         countablePitches.forEach(p => {
                             if (p.points !== null) {
                                 stat.totalPoints += p.points;
                                 stat.pitchesSeen++;
                                 if (p.points === 4) stat.hits4++;
                                 if (p.points === 3) stat.hits3++;
                                 if (p.points === 2) stat.hits2++;
                                 if (p.points === 1) stat.hits1++;
                             }
                         });
                     });
                 });
             });
             
             // Add Tie Breaker Stats
             if (m.tieBreaker) {
                 m.tieBreaker.forEach(tb => {
                     const processTb = (pid: string, scores: (number|null)[]) => {
                         const homeT = teams.find(t => t.id === m.homeTeamId);
                         const awayT = teams.find(t => t.id === m.awayTeamId);
                         let playerObj = homeT?.players.find(p => p.id === pid) || homeT?.subs?.find(p => p.id === pid) ||
                                         awayT?.players.find(p => p.id === pid) || awayT?.subs?.find(p => p.id === pid);
                         const displayName = playerObj ? `${playerObj.name}${playerObj.lastName ? ' ' + playerObj.lastName.charAt(0) + '.' : ''}` : 'Unknown';
                         const stat = getOrInit(pid, displayName);
                         scores.forEach(s => {
                             if (s !== null) {
                                 stat.totalPoints += s;
                                 stat.pitchesSeen++;
                                 if (s === 4) stat.hits4++;
                                 if (s === 3) stat.hits3++;
                                 if (s === 2) stat.hits2++;
                                 if (s === 1) stat.hits1++;
                             }
                         });
                     };
                     processTb(tb.homePlayerId, tb.homeScores);
                     processTb(tb.awayPlayerId, tb.awayScores);
                 });
             }
        });

        return Array.from(pStats.values()).sort((a, b) => b.totalPoints - a.totalPoints);
    }, [matches, teams]);


    // Views
    if (view === 'scoring' && currentMatchId) {
        return <Scoreboard matchId={currentMatchId} onExit={() => { setView('dashboard'); loadLeagueData(); }} isReadOnly={userRole === 'fan'} />;
    }

    if (view === 'match_setup' && setupTeams) {
        return <MatchSetup homeTeam={setupTeams.home} awayTeam={setupTeams.away} onStart={handleStartMatch} onCancel={() => setView('dashboard')} />;
    }

    if (view === 'team_management' && currentLeague) {
        return <TeamManagement league={currentLeague} season={currentSeason} onBack={() => setView('dashboard')} />;
    }

    if (view === 'admin') {
        return <AdminDashboard onBack={() => setView(currentLeague ? 'dashboard' : 'league_select')} />;
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300">
            <Navbar 
                currentLeague={currentLeague}
                currentSeason={currentSeason}
                leagues={leagues}
                userRole={userRole}
                onGoHome={() => { setCurrentLeague(null); setView('league_select'); }}
                onSwitchLeague={() => { setCurrentLeague(null); setView('league_select'); }}
                onSelectLeague={(id) => { setCurrentLeague(id); setView('dashboard'); }}
                onLogin={handleLogin}
                onLogout={handleLogout}
                onAdminDashboard={() => setView('admin')}
                onSeasonChange={setCurrentSeason}
                isDarkMode={isDarkMode}
                toggleTheme={() => setIsDarkMode(!isDarkMode)}
                isMenuOpen={isMenuOpen}
                setMenuOpen={setIsMenuOpen}
            />

            {/* League Selection View */}
            {view === 'league_select' && (
                <div className="max-w-7xl mx-auto px-4 py-12 flex flex-col items-center animate-in fade-in duration-500">
                    <h2 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white mb-8 italic uppercase tracking-tighter text-center">Select Your League</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl">
                        {leagues.map(l => (
                            <button 
                                key={l.id}
                                onClick={() => { setCurrentLeague(l.id); setView('dashboard'); }}
                                className="group relative overflow-hidden bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl p-8 transition-all hover:shadow-2xl hover:scale-105 text-left"
                            >
                                <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase italic group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{l.id} League</h3>
                                <p className="text-slate-500 dark:text-slate-400 font-bold mt-2 text-sm uppercase tracking-wider">Enter Arena &rarr;</p>
                            </button>
                        ))}
                    </div>
                     <div className="mt-12 flex gap-4">
                        <button onClick={() => setShowUserGuide(true)} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white font-bold text-sm uppercase tracking-wider transition-colors">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                            User Guide
                        </button>
                    </div>
                </div>
            )}

            {/* Dashboard View */}
            {view === 'dashboard' && currentLeague && (
                <div className="max-w-5xl mx-auto px-2 sm:px-4 py-4 sm:py-8 animate-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Controls Header */}
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6 sm:mb-8">
                         <div className="flex bg-slate-200 dark:bg-slate-800 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
                            <button onClick={() => setDashboardTab('matches')} className={`flex-1 md:flex-none px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider transition-all whitespace-nowrap ${dashboardTab === 'matches' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Matches</button>
                            <button onClick={() => setDashboardTab('standings')} className={`flex-1 md:flex-none px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider transition-all whitespace-nowrap ${dashboardTab === 'standings' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Standings</button>
                            <button onClick={() => setDashboardTab('season_stats')} className={`flex-1 md:flex-none px-4 sm:px-6 py-2 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider transition-all whitespace-nowrap ${dashboardTab === 'season_stats' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Stats</button>
                         </div>

                         <div className="flex gap-2 sm:gap-3 w-full md:w-auto">
                             {(userRole === 'admin' || userRole === 'umpire') && (
                                 <>
                                     <button onClick={() => setView('team_management')} className="flex-1 md:flex-none bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white px-3 sm:px-4 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-colors whitespace-nowrap">Manage Teams</button>
                                     <button onClick={() => setShowMatchCreator(true)} className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 text-white px-3 sm:px-4 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-lg shadow-blue-900/20 transition-colors whitespace-nowrap">+ New Match</button>
                                 </>
                             )}
                         </div>
                    </div>

                    {/* AI Report Section */}
                    {dashboardTab === 'matches' && (
                        <div className="mb-8">
                            {!report ? (
                                <button onClick={handleGenerateReport} disabled={generatingReport} className="text-xs font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                    {generatingReport ? 'Analyzing League...' : 'Generate AI League Report'}
                                </button>
                            ) : (
                                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/50 p-4 rounded-xl relative">
                                    <button onClick={() => setReport(null)} className="absolute top-2 right-2 text-purple-400 hover:text-purple-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    <h4 className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase mb-1">Gemini Analysis</h4>
                                    <p className="text-sm text-slate-700 dark:text-slate-300 italic">{report}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Matches Tab */}
                    {dashboardTab === 'matches' && (
                        <div className="space-y-4">
                            {matches.length === 0 && <div className="text-center py-12 text-slate-400 font-bold italic">No matches scheduled for {currentSeason}.</div>}
                            {matches.map(match => {
                                const home = teams.find(t => t.id === match.homeTeamId) || { name: 'Unknown' };
                                const away = teams.find(t => t.id === match.awayTeamId) || { name: 'Unknown' };
                                
                                const getScore = (side: 'home' | 'away') => {
                                    let score = match.innings.reduce((acc, inn) => acc + inn[side].playerScores.reduce((pAcc, ps) => pAcc + ps.pitches.reduce((piAcc, pi) => piAcc + (pi.points || 0), 0), 0), 0);
                                    if(match.tieBreaker) {
                                         match.tieBreaker.forEach(tb => {
                                             const s = side === 'home' ? tb.homeScores : tb.awayScores;
                                             score += s.reduce((a,b)=>(a||0)+(b||0), 0);
                                         });
                                    }
                                    return score;
                                };
                                const homeScore = getScore('home');
                                const awayScore = getScore('away');

                                return (
                                    <div key={match.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
                                        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-6 w-full sm:w-auto text-center sm:text-left">
                                             <div className="text-[10px] sm:text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded w-full sm:w-auto text-center">{new Date(match.date).toLocaleDateString()}</div>
                                             
                                             <div className="flex flex-1 sm:flex-auto items-center sm:justify-start sm:gap-8 w-full sm:w-auto min-w-0">
                                                <div className="flex-1 sm:flex-none sm:w-40 text-xs sm:text-lg font-bold text-red-700 dark:text-red-400 text-right font-sans break-words whitespace-normal leading-tight line-clamp-2 min-w-0">{home.name}</div>
                                                <div className="shrink-0 text-slate-400 dark:text-slate-600 text-[10px] sm:text-base px-1 sm:px-2 font-sans italic font-bold">VS</div>
                                                <div className="flex-1 sm:flex-none sm:w-40 text-xs sm:text-lg font-bold text-blue-700 dark:text-blue-400 text-left font-sans break-words whitespace-normal leading-tight line-clamp-2 min-w-0">{away.name}</div>
                                             </div>
                                        </div>

                                        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 border-slate-100 dark:border-slate-800 pt-2 sm:pt-0 mt-1 sm:mt-0">
                                             {match.isComplete ? (
                                                 <div className="flex items-center gap-3">
                                                     <div className="flex flex-col items-center">
                                                         <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase">Final</span>
                                                         <span className="text-lg sm:text-xl font-black text-slate-800 dark:text-white">{awayScore} - {homeScore}</span>
                                                     </div>
                                                     {(userRole === 'admin' || userRole === 'umpire') && (
                                                          <button onClick={() => { setCurrentMatchId(match.id); setView('scoring'); }} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                                                     )}
                                                 </div>
                                             ) : (
                                                 <div className="flex items-center gap-3 w-full sm:w-auto">
                                                     <div className="hidden sm:block text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider animate-pulse">Live</div>
                                                     <button onClick={() => { setCurrentMatchId(match.id); setView('scoring'); }} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-green-900/20 transition-colors">
                                                         {userRole === 'fan' ? 'Watch Live' : 'Score Match'}
                                                     </button>
                                                 </div>
                                             )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Standings Tab */}
                    {dashboardTab === 'standings' && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
                             <table className="w-full text-left text-sm min-w-[500px]">
                                 <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold text-xs border-b border-slate-200 dark:border-slate-800">
                                     <tr>
                                         <th className="px-4 sm:px-6 py-4">Team</th>
                                         <th className="px-2 sm:px-6 py-4 text-center">GP</th>
                                         <th className="px-2 sm:px-6 py-4 text-center text-green-600 dark:text-green-500">W</th>
                                         <th className="px-2 sm:px-6 py-4 text-center text-red-500 dark:text-red-400">L</th>
                                         <th className="px-2 sm:px-6 py-4 text-center text-slate-400">T</th>
                                         <th className="px-4 sm:px-6 py-4 text-center text-slate-900 dark:text-white">Total Pts</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                     {standingsData.map((s, idx) => (
                                         <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                             <td className="px-4 sm:px-6 py-4 font-bold text-slate-800 dark:text-white">
                                                 <span className="text-slate-400 mr-2 font-normal">#{idx + 1}</span>
                                                 {s.name}
                                             </td>
                                             <td className="px-2 sm:px-6 py-4 text-center font-bold text-slate-600 dark:text-slate-400">{s.gp}</td>
                                             <td className="px-2 sm:px-6 py-4 text-center font-bold text-green-600 dark:text-green-500">{s.w}</td>
                                             <td className="px-2 sm:px-6 py-4 text-center font-bold text-red-500 dark:text-red-400">{s.l}</td>
                                             <td className="px-2 sm:px-6 py-4 text-center font-bold text-slate-400">{s.t}</td>
                                             <td className="px-4 sm:px-6 py-4 text-center font-black text-slate-900 dark:text-white">{s.ptsFor}</td>
                                         </tr>
                                     ))}
                                     {standingsData.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400 italic">No standings data available.</td></tr>}
                                 </tbody>
                             </table>
                        </div>
                    )}

                    {/* Season Stats Tab */}
                    {dashboardTab === 'season_stats' && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
                             <table className="w-full text-left text-sm min-w-[600px]">
                                 <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold text-xs border-b border-slate-200 dark:border-slate-800">
                                     <tr>
                                         <th className="px-4 sm:px-6 py-3">Player</th>
                                         <th className="px-2 sm:px-4 py-3 text-center text-slate-900 dark:text-white">Total Points</th>
                                         <th className="px-2 sm:px-4 py-3 text-center text-rose-500">4s</th>
                                         <th className="px-2 sm:px-4 py-3 text-center text-amber-500">3s</th>
                                         <th className="px-2 sm:px-4 py-3 text-center text-green-500">2s</th>
                                         <th className="px-2 sm:px-4 py-3 text-center text-cyan-500">1s</th>
                                         <th className="px-2 sm:px-4 py-3 text-center text-slate-400">Pitches</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                     {seasonStatsData.map((stat, idx) => (
                                         <tr key={stat.playerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                             <td className="px-4 sm:px-6 py-3 font-bold text-slate-800 dark:text-white">
                                                 <span className="text-slate-400 mr-2 font-normal text-xs">#{idx + 1}</span>
                                                 {stat.name}
                                             </td>
                                             <td className="px-2 sm:px-4 py-3 text-center font-black text-lg text-slate-900 dark:text-white">{stat.totalPoints}</td>
                                             <td className="px-2 sm:px-4 py-3 text-center font-bold text-rose-600 dark:text-rose-400">{stat.hits4}</td>
                                             <td className="px-2 sm:px-4 py-3 text-center font-bold text-amber-600 dark:text-amber-400">{stat.hits3}</td>
                                             <td className="px-2 sm:px-4 py-3 text-center font-bold text-green-600 dark:text-green-400">{stat.hits2}</td>
                                             <td className="px-2 sm:px-4 py-3 text-center font-bold text-cyan-600 dark:text-cyan-400">{stat.hits1}</td>
                                             <td className="px-2 sm:px-4 py-3 text-center font-medium text-slate-500">{stat.pitchesSeen}</td>
                                         </tr>
                                     ))}
                                     {seasonStatsData.length === 0 && <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400 italic">No player stats recorded yet.</td></tr>}
                                 </tbody>
                             </table>
                        </div>
                    )}

                </div>
            )}
            
            {/* New Match Modal */}
            {showMatchCreator && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowMatchCreator(false)}>
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-[90%] max-w-md" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Start New Match</h3>
                        
                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Away Team</label>
                                <select className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 rounded-lg font-bold" value={selectedAwayTeamId} onChange={e => setSelectedAwayTeamId(e.target.value)}>
                                    <option value="">Select Team...</option>
                                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Home Team</label>
                                <select className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 rounded-lg font-bold" value={selectedHomeTeamId} onChange={e => setSelectedHomeTeamId(e.target.value)}>
                                    <option value="">Select Team...</option>
                                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </div>
                        </div>
                        
                        <button onClick={prepareMatchSetup} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors">
                            Next: Set Lineup
                        </button>
                    </div>
                </div>
            )}

            {/* User Guide Modal */}
            {showUserGuide && <UserGuide onClose={() => setShowUserGuide(false)} />}

        </div>
    );
};

export default App;