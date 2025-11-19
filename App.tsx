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
  
  // Admin Auth State
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);

  // Match Stats Modal
  const [statsModalMatch, setStatsModalMatch] = useState<Match | null>(null);
  const [statsModalData, setStatsModalData] = useState<PlayerStats[]>([]);

  useEffect(() => {
    // Initial Load: Get Leagues and Current Season Setting
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

  const handleStartGame = async (homeLineup: Player[], awayLineup: Player[]) => {
    if (!state.currentLeague || !selectedHomeId || !selectedAwayId) return;
    try {
        setLoading(true);
        const homeIds = homeLineup.map(p => p.id);
        const awayIds = awayLineup.map(p => p.id);
        const newMatch = await storage.createMatch(state.currentLeague, selectedHomeId, selectedAwayId, homeIds, awayIds, state.season);
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
      // This updates the view locally, allowing them to browse history
      setState({ ...state, season: newSeason, view: state.currentLeague ? 'dashboard' : 'league_select' });
  };

  // Admin Login Logic
  const requestAdminAccess = () => {
    if (isAdminAuthenticated) {
      setState({ ...state, view: 'admin' });
    } else {
      setShowAdminLogin(true);
      setAdminPasswordInput('');
      setLoginError(false);
    }
  };

  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const isValid = await storage.verifyAdminPassword(adminPasswordInput);
    setLoading(false);
    if (isValid) {
      setIsAdminAuthenticated(true);
      setShowAdminLogin(false);
      setState({ ...state, view: 'admin' });
    } else {
      setLoginError(true);
    }
  };

  if (state.view === 'league_select') {
    // Sort leagues naturally (9u before 10u, A before B)
    const sortedLeagues = [...leagues].sort((a, b) => 
        a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
    );

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <Navbar currentLeague={null} currentSeason={state.season} onGoHome={() => {}} onSwitchLeague={() => {}} onAdmin={requestAdminAccess} onSeasonChange={handleSeasonChange} />
        
        <div className="text-center mb-8 mt-12"><h1 className="text-4xl font-bold text-white tracking-tight mb-2">Dugout Hitting League</h1></div>
        
        {leagues.length === 0 ? (
            <div className="text-center bg-slate-800 p-8 rounded-xl border border-slate-700 max-w-md">
                <p className="text-slate-300 mb-4">No leagues found.</p>
                <button onClick={requestAdminAccess} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-500 transition-colors">Create Your First League in Admin</button>
            </div>
        ) : (
            <div className="flex flex-wrap justify-center gap-6 w-full max-w-6xl px-4">
            {sortedLeagues.map(league => (
                <button key={league.id} 
                    onClick={() => setState({ ...state, view: 'dashboard', currentLeague: league.id, currentMatchId: null })} 
                    className="bg-white hover:bg-slate-50 text-slate-900 p-6 rounded-2xl shadow-2xl transition-transform hover:scale-105 group w-full sm:w-64 aspect-[4/3] sm:aspect-square flex flex-col items-center justify-center"
                >
                    <span className="block text-3xl sm:text-4xl font-black mb-2 group-hover:text-blue-600 transition-colors uppercase text-center w-full break-words leading-tight">{league.id}</span>
                    <span className="block text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{state.season} Season</span>
                </button>
            ))}
            </div>
        )}
        
        {showAdminLogin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowAdminLogin(false)}>
            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-800 mb-4 text-center">Admin Access</h3>
              <form onSubmit={handleAdminLoginSubmit}>
                <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                  <input 
                    type="password" 
                    autoFocus
                    className={`w-full border rounded-lg px-4 py-3 text-lg outline-none focus:ring-2 ${loginError ? 'border-red-300 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
                    value={adminPasswordInput} 
                    onChange={e => setAdminPasswordInput(e.target.value)} 
                    placeholder="Enter password"
                  />
                  {loginError && <p className="text-red-500 text-xs mt-2 font-bold">Incorrect password. Try 'admin'.</p>}
                </div>
                <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors">{loading ? 'Verifying...' : 'Unlock Admin'}</button>
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
  if (state.view === 'scoring' && state.currentMatchId) return <Scoreboard matchId={state.currentMatchId} onExit={() => setState({ ...state, view: 'dashboard', currentMatchId: null })} />;
  if (state.view === 'team_management' && state.currentLeague) return <TeamManagement league={state.currentLeague} season={state.season} onBack={() => setState({ ...state, view: 'dashboard' })} />;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar currentLeague={state.currentLeague} currentSeason={state.season} onGoHome={() => setState({ ...state, view: 'dashboard' })} onSwitchLeague={() => setState({ ...state, view: 'league_select', currentLeague: null, currentMatchId: null })} onAdmin={requestAdminAccess} onSeasonChange={handleSeasonChange} />
      <main className="max-w-7xl mx-auto p-4 sm:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-lg font-bold text-slate-700 mb-4">League Status ({state.season})</h2>
                    <div className="flex justify-between text-center"><div><div className="text-3xl font-black text-slate-900">{teams.length}</div><div className="text-xs text-slate-500 uppercase font-bold">Teams</div></div></div>
                    <button onClick={() => setState({ ...state, view: 'team_management' })} className="w-full mt-6 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors">Manage Teams & Stats</button>
                </div>
                <div className="bg-blue-600 p-6 rounded-xl shadow-lg text-white">
                    <h2 className="text-xl font-bold mb-4">Start New Match</h2>
                    <div className="space-y-3">
                        <select className="w-full p-2 rounded text-slate-900" value={selectedHomeId} onChange={(e) => setSelectedHomeId(e.target.value)}><option value="">Select Home Team...</option>{teams.map(t => <option key={t.id} value={t.id} disabled={t.id === selectedAwayId}>{t.name}</option>)}</select>
                        <select className="w-full p-2 rounded text-slate-900" value={selectedAwayId} onChange={(e) => setSelectedAwayId(e.target.value)}><option value="">Select Away Team...</option>{teams.map(t => <option key={t.id} value={t.id} disabled={t.id === selectedHomeId}>{t.name}</option>)}</select>
                        <button disabled={!selectedHomeId || !selectedAwayId} onClick={() => setState({ ...state, view: 'match_setup' })} className="w-full bg-white text-blue-600 font-bold py-3 rounded-lg mt-4 hover:bg-blue-50 disabled:opacity-50 transition-colors">Next: Set Lineup</button>
                    </div>
                </div>
            </div>
            <div className="lg:col-span-2">
                <h2 className="text-xl font-bold text-slate-800 mb-6">Match History ({state.season})</h2>
                <div className="space-y-4">
                    {matches.map(match => {
                        const home = teams.find(t => t.id === match.homeTeamId);
                        const away = teams.find(t => t.id === match.awayTeamId);
                        if (!home || !away) return null;
                        return (
                            <div key={match.id} className="bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <div className="flex items-center gap-4 w-full sm:w-auto">
                                    <div className="shrink-0"><div className={`text-xs font-bold px-2 py-1 rounded-full ${match.isComplete ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-600'}`}>{match.isComplete ? 'FINAL' : 'LIVE'}</div></div>
                                    <div className="flex flex-1 sm:flex-auto items-center justify-between sm:justify-start sm:gap-8 w-full sm:w-auto">
                                        <div className="text-base sm:text-lg font-semibold text-slate-800 text-right">{home.name}</div>
                                        <div className="text-slate-300 text-sm sm:text-xl px-2">vs</div>
                                        <div className="text-base sm:text-lg font-semibold text-slate-800 text-left">{away.name}</div>
                                    </div>
                                </div>
                                <div className="flex gap-2 w-full sm:w-auto justify-end">
                                  <button onClick={() => handleOpenMatchStats(match)} className="flex-1 sm:flex-none text-center px-3 py-2 rounded border border-slate-200 text-blue-600 hover:bg-blue-50 font-medium text-xs sm:text-sm transition-colors">Stats</button>
                                  <button onClick={() => setState({ ...state, view: 'scoring', currentMatchId: match.id })} className="flex-1 sm:flex-none text-center px-3 py-2 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium text-xs sm:text-sm transition-colors">{match.isComplete ? 'View' : 'Resume'}</button>
                                  <button onClick={() => handleDeleteMatch(match.id)} className="flex-initial px-3 py-2 rounded border border-slate-200 text-red-500 hover:bg-red-50 font-medium text-xs sm:text-sm transition-colors">Delete</button>
                                </div>
                            </div>
                        );
                    })}
                    {matches.length === 0 && <div className="text-center py-10 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">No matches found for this season.</div>}
                </div>
            </div>
        </div>
        
        {/* Reusable Admin Login */}
        {showAdminLogin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowAdminLogin(false)}>
            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-800 mb-4 text-center">Admin Access</h3>
              <form onSubmit={handleAdminLoginSubmit}>
                <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                  <input 
                    type="password" 
                    autoFocus
                    className={`w-full border rounded-lg px-4 py-3 text-lg outline-none focus:ring-2 ${loginError ? 'border-red-300 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
                    value={adminPasswordInput} 
                    onChange={e => setAdminPasswordInput(e.target.value)} 
                    placeholder="Enter password"
                  />
                  {loginError && <p className="text-red-500 text-xs mt-2 font-bold">Incorrect password. Try 'admin'.</p>}
                </div>
                <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors">{loading ? 'Verifying...' : 'Unlock Admin'}</button>
              </form>
            </div>
          </div>
        )}

        {/* Match Stats Modal */}
        {statsModalMatch && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setStatsModalMatch(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col transform scale-100 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Match Statistics</h3>
                            <p className="text-sm text-slate-500">{new Date(statsModalMatch.date).toLocaleDateString()}</p>
                        </div>
                        <button onClick={() => setStatsModalMatch(null)} className="text-slate-400 hover:text-slate-600 font-bold text-xl">&times;</button>
                    </div>
                    <div className="overflow-y-auto p-0">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100 text-slate-500 uppercase font-bold text-xs sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3">Player</th>
                                    <th className="px-4 py-3 text-right">Total Pts</th>
                                    <th className="px-4 py-3 text-right text-rose-600">4s</th>
                                    <th className="px-4 py-3 text-right text-amber-600">3s</th>
                                    <th className="px-4 py-3 text-right text-green-600">2s</th>
                                    <th className="px-4 py-3 text-right text-cyan-600">1s</th>
                                    <th className="px-4 py-3 text-right text-slate-400">Pitches</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {statsModalData.map(stat => (
                                    <tr key={stat.playerId} className="hover:bg-slate-50">
                                        <td className="px-6 py-3 font-bold text-slate-800">{stat.name}</td>
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
                        <button onClick={() => setStatsModalMatch(null)} className="px-6 py-2 bg-white border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50">Close</button>
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;