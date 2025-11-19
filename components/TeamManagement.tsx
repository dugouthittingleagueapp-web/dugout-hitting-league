import React, { useState, useEffect } from 'react';
import { AgeGroup, Team, PlayerStats } from '../types';
import * as storage from '../services/storageService';

interface TeamManagementProps {
  league: AgeGroup;
  season: string;
  onBack: () => void;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ league, season, onBack }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamStats, setTeamStats] = useState<PlayerStats[]>([]);
  
  // Creation/Edit State
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [playerNames, setPlayerNames] = useState(['', '', '']);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadTeams(); }, [league, season]);

  const loadTeams = async () => {
    setLoading(true);
    const data = await storage.getTeams(league, season);
    setTeams(data);
    setLoading(false);
  };

  const handleSelectTeam = async (team: Team) => {
    setSelectedTeam(team);
    setLoading(true);
    try {
        const stats = await storage.getTeamStats(team, league, season);
        setTeamStats(stats);
    } catch (e) {
        console.error("Error fetching stats", e);
    }
    setLoading(false);
  };

  const handleEditTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setNewTeamName(team.name);
    // Fill player names, ensure at least 3
    const pNames = team.players.map(p => p.name);
    while(pNames.length < 3) pNames.push('');
    setPlayerNames(pNames.slice(0, 3));
  };

  const cancelEdit = () => {
      setEditingTeamId(null);
      setNewTeamName('');
      setPlayerNames(['', '', '']);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || playerNames.some(p => !p.trim())) return;
    setLoading(true);

    try {
        if (editingTeamId) {
             // Update existing
             const teamToUpdate = teams.find(t => t.id === editingTeamId);
             if (teamToUpdate) {
                 const updatedPlayers = teamToUpdate.players.map((p, i) => ({ ...p, name: playerNames[i] }));
                 // If there are new players (structure change), handle that, but we assume fixed 3 for now or match index
                 // Actually, just replace names for existing IDs if possible, or create new IDs if structure changed.
                 // Simpler: Just map index 0->0, 1->1, 2->2.
                 const finalPlayers = playerNames.map((name, idx) => ({
                     id: teamToUpdate.players[idx]?.id || crypto.randomUUID(),
                     name
                 }));
                 
                 await storage.updateTeam({
                     ...teamToUpdate,
                     name: newTeamName,
                     players: finalPlayers
                 });
             }
        } else {
            // Create New
            await storage.createTeam(newTeamName, league, playerNames, season);
        }
        
        await loadTeams();
        cancelEdit();
    } catch (e) {
        alert("Failed to save team");
    }
    
    setLoading(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if(confirm(`Delete team "${name}"?`)) {
        setLoading(true);
        await storage.deleteTeam(id);
        if (selectedTeam?.id === id) setSelectedTeam(null);
        await loadTeams();
    }
  };

  const handlePlayerNameChange = (index: number, value: string) => {
    const newNames = [...playerNames];
    newNames[index] = value;
    setPlayerNames(newNames);
  };

  if (selectedTeam) {
    return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-3xl font-bold text-slate-800">{selectedTeam.name}</h2>
                        <span className="bg-slate-200 text-slate-600 text-xs font-bold px-2 py-1 rounded">{season}</span>
                    </div>
                    <p className="text-slate-500 font-bold uppercase tracking-wider">Stats & Roster</p>
                </div>
                <button onClick={() => setSelectedTeam(null)} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition-colors">Back to List</button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
                <div className="p-4 bg-slate-50 border-b border-slate-200"><h3 className="font-bold text-slate-700">Hitting Statistics</h3></div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 text-slate-500 uppercase font-bold text-xs">
                            <tr>
                                <th className="px-4 py-3">Player</th>
                                <th className="px-4 py-3 text-right">Total Points</th>
                                <th className="px-4 py-3 text-right text-rose-600">4s</th>
                                <th className="px-4 py-3 text-right text-amber-600">3s</th>
                                <th className="px-4 py-3 text-right text-green-600">2s</th>
                                <th className="px-4 py-3 text-right text-cyan-600">1s</th>
                                <th className="px-4 py-3 text-right text-slate-400">Pitches</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {teamStats.map(stat => (
                                <tr key={stat.playerId} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-bold text-slate-800">{stat.name}</td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-lg">{stat.totalPoints}</td>
                                    <td className="px-4 py-3 text-right font-mono">{stat.hits4}</td>
                                    <td className="px-4 py-3 text-right font-mono">{stat.hits3}</td>
                                    <td className="px-4 py-3 text-right font-mono">{stat.hits2}</td>
                                    <td className="px-4 py-3 text-right font-mono">{stat.hits1}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-400">{stat.pitchesSeen}</td>
                                </tr>
                            ))}
                            {teamStats.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 italic">No match data available for {season} yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Manage Teams</h2>
            <p className="text-slate-500 text-sm font-bold uppercase tracking-wider">{league} League <span className="text-slate-400 mx-1">•</span> {season}</p>
        </div>
        <button onClick={onBack} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition-colors">Back to Dashboard</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-100 h-fit">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-800">{editingTeamId ? 'Edit Team' : `Add New Team (${season})`}</h3>
            {editingTeamId && <button onClick={cancelEdit} className="text-xs text-red-500 hover:text-red-700 font-bold">Cancel Edit</button>}
          </div>
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Team Name</label>
              <input type="text" className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Tigers" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} required />
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-500 uppercase">Names (3 Players)</label>
              {playerNames.map((name, idx) => (
                <div key={idx} className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">#{idx + 1}</span>
                    <input type="text" className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder={`Name`} value={name} onChange={e => handlePlayerNameChange(idx, e.target.value)} required />
                </div>
              ))}
            </div>
            <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-blue-200 transition-all active:scale-95">{loading ? 'Saving...' : (editingTeamId ? 'Update Team' : 'Create Team')}</button>
          </form>
        </div>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-700 border-b pb-2">Current Teams ({teams.length})</h3>
          {teams.map(team => (
            <div key={team.id} className={`bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center group transition-colors ${editingTeamId === team.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300'}`}>
              <div>
                <h4 className="font-bold text-lg text-slate-800">{team.name}</h4>
                <div className="flex flex-wrap gap-2 mt-2">
                  {team.players.map(p => (
                    <span key={p.id} className="text-xs font-medium bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md border border-slate-200">{p.name}</span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                    <button onClick={() => handleSelectTeam(team)} className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded text-xs font-bold transition-colors">Stats</button>
                    <button onClick={() => handleEditTeam(team)} className="text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-xs font-bold transition-colors">Edit</button>
                </div>
                <button onClick={() => handleDelete(team.id, team.name)} className="text-xs text-slate-300 hover:text-red-500 p-1 transition-colors mt-1">Delete</button>
              </div>
            </div>
          ))}
          {teams.length === 0 && <div className="text-slate-400 italic text-sm">No teams found for {season}.</div>}
        </div>
      </div>
    </div>
  );
};