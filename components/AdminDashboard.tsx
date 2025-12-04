
import React, { useState, useEffect } from 'react';
import * as storage from '../services/storageService';
import { generateLeagueReport } from '../services/geminiService';
import { Team, League } from '../types';
import { UserGuide } from './UserGuide';

export const AdminDashboard: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(false);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [creatingLeague, setCreatingLeague] = useState(false);
  
  // Settings State
  const [currentSeason, setCurrentSeason] = useState('2025');
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
    const loadData = async () => { 
        setLoading(true);
        const [d, season, ls, ts] = await Promise.all([
            storage.exportData(),
            storage.getCurrentSeason(),
            storage.getLeagues(),
            storage.getAllTeams()
        ]);
        
        setData(d); 
        setCurrentSeason(season);
        setLeagues(ls);
        setAllTeams(ts);
        setLoading(false);
    };
    loadData();
  }, []);

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
      await storage.createLeague(newLeagueName.trim());
      const newLeagues = await storage.getLeagues();
      setLeagues(newLeagues);
      alert('League created!');
      setNewLeagueName('');
    } catch (e: any) {
      alert('Failed to create league: ' + (e.message || 'Unknown error'));
    } finally {
      setCreatingLeague(false);
    }
  };

  const handleDeleteLeague = async (leagueId: string) => {
    if (confirm(`Are you sure you want to delete the "${leagueId}" league? WARNING: All teams and matches associated with this league will be permanently deleted.`)) {
        setLoading(true);
        try {
            await storage.deleteLeague(leagueId);
            // Refresh
            const newLeagues = await storage.getLeagues();
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
      if(confirm(`Are you sure? Changing the active season to ${newSeasonInput} will hide current teams/matches from the default view (data is NOT deleted).`)) {
          await storage.updateCurrentSeason(newSeasonInput.trim());
          setCurrentSeason(newSeasonInput.trim());
          setNewSeasonInput('');
          alert("Season updated.");
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
    <div className="max-w-5xl mx-auto p-6 pb-24">
      <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white font-sans">Admin Dashboard</h2>
          <div className="flex gap-3">
              <button onClick={() => setShowGuide(true)} className="px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded font-medium font-sans transition-colors">User Guide</button>
              <button onClick={onBack} className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-slate-700 dark:text-slate-300 font-medium font-sans transition-colors">Exit Admin</button>
          </div>
      </div>
      <div className="grid gap-8">
        
        {/* Configuration */}
        <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-xl shadow border border-slate-200 dark:border-slate-800">
            <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-4 font-sans">League Configuration</h3>
            
            <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Create New League Category</label>
                <div className="flex gap-3">
                    <input type="text" value={newLeagueName} onChange={e => setNewLeagueName(e.target.value)} placeholder="e.g. 12u, Varsity" className="flex-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-sans" />
                    <button onClick={handleCreateLeague} disabled={creatingLeague} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 font-bold disabled:opacity-50 font-sans">{creatingLeague ? 'Creating...' : 'Create'}</button>
                </div>
            </div>

            <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-6">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 font-sans">Existing Leagues</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {leagues.map(l => (
                        <div key={l.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
                            <span className="font-bold text-slate-700 dark:text-slate-300 font-sans">{l.id}</span>
                            <button 
                                onClick={() => handleDeleteLeague(l.id)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded transition-colors"
                                title="Delete League"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    ))}
                    {leagues.length === 0 && <div className="text-sm text-slate-400 italic font-sans">No leagues found.</div>}
                </div>
            </div>

            <div className="pt-6 border-t border-slate-100 dark:border-slate-800 mt-6">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Active Season (Current: <span className="text-blue-600 dark:text-blue-400">{currentSeason}</span>)</label>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 font-sans">Change this to "Reset" the league for a new year. Old data is preserved.</p>
                <div className="flex gap-3">
                    <input type="text" value={newSeasonInput} onChange={e => setNewSeasonInput(e.target.value)} placeholder="e.g. 2026" className="w-40 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-sans" />
                    <button onClick={handleUpdateSeason} className="bg-slate-700 dark:bg-slate-600 text-white px-6 py-2 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-500 font-bold font-sans">Update Season</button>
                </div>
            </div>
        </section>

        {/* Bulk Move Teams */}
        <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-xl shadow border border-slate-200 dark:border-slate-800">
            <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-4 font-sans">Bulk Move Teams</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 font-sans">Select teams to move them to a different league. All match history and stats will follow the team to the new league.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 max-h-96 overflow-y-auto pr-2">
                {Object.keys(teamsByLeague).map(league => (
                    <div key={league} className="bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-blue-600 dark:text-blue-400 uppercase text-xs mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">{league} League</h4>
                        <div className="space-y-2">
                            {teamsByLeague[league].map(team => (
                                <label key={team.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 p-1 rounded transition-colors">
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 text-blue-600 rounded" 
                                        checked={selectedTeamIds.has(team.id)} 
                                        onChange={() => toggleTeamSelection(team.id)} 
                                    />
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 font-sans truncate">{team.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 items-end border-t border-slate-200 dark:border-slate-800 pt-4">
                <div className="w-full sm:flex-1">
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">Destination League</label>
                    <select 
                        className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-lg font-bold text-slate-800 dark:text-white font-sans"
                        value={targetLeagueForMove}
                        onChange={e => setTargetLeagueForMove(e.target.value)}
                    >
                        <option value="">Select Target League...</option>
                        {leagues.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
                    </select>
                </div>
                <button 
                    onClick={handleBulkMove} 
                    disabled={selectedTeamIds.size === 0 || !targetLeagueForMove || movingTeams}
                    className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-lg shadow-blue-900/20 hover:bg-blue-500 disabled:opacity-50 transition-all font-sans"
                >
                    {movingTeams ? 'Moving...' : `Move ${selectedTeamIds.size} Selected Team(s)`}
                </button>
            </div>
        </section>

        {/* Passwords */}
        <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-xl shadow border border-slate-200 dark:border-slate-800">
            <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-4 font-sans">Access Control</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">New Admin Password</label>
                    <div className="flex gap-3">
                        <input type="text" value={newAdminPw} onChange={e => setNewAdminPw(e.target.value)} placeholder="New Admin Pass" className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-sans" />
                        <button onClick={handleUpdateAdminPw} className="bg-slate-600 dark:bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-700 dark:hover:bg-slate-600 font-bold text-sm font-sans">Update</button>
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">New Umpire Password</label>
                    <div className="flex gap-3">
                        <input type="text" value={newUmpirePw} onChange={e => setNewUmpirePw(e.target.value)} placeholder="New Umpire Pass" className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-sans" />
                        <button onClick={handleUpdateUmpirePw} className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 font-bold text-sm font-sans">Update</button>
                    </div>
                </div>
            </div>
        </section>

        {/* Data */}
        <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-xl shadow border border-slate-200 dark:border-slate-800">
            <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-4 font-sans">Data Management</h3>
            <button onClick={handleExport} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-lg hover:bg-blue-700 transition-colors font-sans">Export JSON Database</button>
        </section>
      </div>

      {showGuide && <UserGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
};
