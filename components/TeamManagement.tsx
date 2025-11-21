
import React, { useState, useEffect } from 'react';
import { AgeGroup, Team, PlayerStats } from '../types';
import * as storage from '../services/storageService';

interface TeamManagementProps {
  league: AgeGroup;
  season: string;
  onBack: () => void;
}

interface EditablePlayer {
  name: string; // First Name
  lastName: string; // Last Name
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ league, season, onBack }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamStats, setTeamStats] = useState<PlayerStats[]>([]);
  
  // Sort State
  const [sortConfig, setSortConfig] = useState<{ key: keyof PlayerStats; direction: 'asc' | 'desc' }>({ key: 'totalPoints', direction: 'desc' });
  
  // Creation/Edit State
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  
  // Roster State - Now objects with first/last name
  const [players, setPlayers] = useState<EditablePlayer[]>([
      { name: '', lastName: '' }, 
      { name: '', lastName: '' }, 
      { name: '', lastName: '' }
  ]);
  
  // Subs state: stores objects to preserve IDs
  const [subs, setSubs] = useState<{id: string, name: string, lastName?: string}[]>([]);
  
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

  const handleSort = (key: keyof PlayerStats) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedStats = [...teamStats].sort((a, b) => {
    const valA = a[sortConfig.key];
    const valB = b[sortConfig.key];
    
    if (typeof valA === 'string' && typeof valB === 'string') {
        return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    
    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleEditTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setNewTeamName(team.name);
    
    // Fill players, separate First/Last if needed or just load
    const currentPlayers = team.players.map(p => ({
        name: p.name,
        lastName: p.lastName || ''
    }));
    
    // Ensure at least 3
    while(currentPlayers.length < 3) currentPlayers.push({ name: '', lastName: '' });
    
    setPlayers(currentPlayers.slice(0, 3));
    
    // Fill subs
    setSubs(team.subs || []);
  };

  const cancelEdit = () => {
      setEditingTeamId(null);
      setNewTeamName('');
      setPlayers([{ name: '', lastName: '' }, { name: '', lastName: '' }, { name: '', lastName: '' }]);
      setSubs([]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate: Team Name and First Names are required
    if (!newTeamName.trim() || players.some(p => !p.name.trim())) return;
    setLoading(true);

    try {
        if (editingTeamId) {
             // Update existing
             const teamToUpdate = teams.find(t => t.id === editingTeamId);
             if (teamToUpdate) {
                 const finalPlayers = players.map((p, idx) => ({
                     id: teamToUpdate.players[idx]?.id || storage.generateUUID(),
                     name: p.name,
                     lastName: p.lastName
                 }));
                 
                 // Clean empty subs before saving
                 const finalSubs = subs.filter(s => s.name.trim());

                 await storage.updateTeam({
                     ...teamToUpdate,
                     name: newTeamName,
                     players: finalPlayers,
                     subs: finalSubs
                 });
             }
        } else {
            // Create New
            const cleanSubs = subs.filter(s => s.name.trim());
            // Map players from EditablePlayer to API expected format
            await storage.createTeam(newTeamName, league, players, season, cleanSubs);
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

  const handlePlayerChange = (index: number, field: keyof EditablePlayer, value: string) => {
    const newPlayers = [...players];
    newPlayers[index] = { ...newPlayers[index], [field]: value };
    setPlayers(newPlayers);
  };

  const handleSubChange = (index: number, field: 'name' | 'lastName', value: string) => {
      const newSubs = [...subs];
      newSubs[index] = { ...newSubs[index], [field]: value };
      setSubs(newSubs);
  };

  const addSubField = () => setSubs([...subs, { id: storage.generateUUID(), name: '', lastName: '' }]);
  
  const removeSubField = (index: number) => {
      const newSubs = [...subs];
      newSubs.splice(index, 1);
      setSubs(newSubs);
  };

  // Helper to format name as First L.
  const formatName = (p: { name: string, lastName?: string }) => 
    `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;

  // Helper to render sortable headers
  const renderHeader = (label: string, key: keyof PlayerStats, align: string = 'text-right', colorClass: string = '') => (
    <th 
        className={`px-4 py-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none ${align} ${colorClass}`}
        onClick={() => handleSort(key)}
        title="Click to sort"
    >
        <div className={`flex items-center gap-1 ${align === 'text-right' ? 'justify-end' : 'justify-start'}`}>
            {label}
            {sortConfig.key === key && (
                <span className="text-[10px] text-slate-400">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
            )}
        </div>
    </th>
  );

  if (selectedTeam) {
    return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-3xl font-bold text-slate-800 dark:text-white font-sans">{selectedTeam.name}</h2>
                        <span className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-bold px-2 py-1 rounded font-sans">{season}</span>
                    </div>
                    <p className="text-slate-500 font-bold uppercase tracking-wider font-sans">Stats & Roster</p>
                </div>
                <button onClick={() => setSelectedTeam(null)} className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors font-sans border border-slate-300 dark:border-slate-700">Back to List</button>
            </div>

            <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden mb-8">
                <div className="p-4 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800"><h3 className="font-bold text-slate-700 dark:text-slate-300 font-sans">Hitting Statistics</h3></div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold text-xs border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                {renderHeader('Player', 'name', 'text-left')}
                                {renderHeader('Total Points', 'totalPoints')}
                                {renderHeader('4s', 'hits4', 'text-right', 'text-rose-600 dark:text-rose-500')}
                                {renderHeader('3s', 'hits3', 'text-right', 'text-amber-600 dark:text-amber-500')}
                                {renderHeader('2s', 'hits2', 'text-right', 'text-green-600 dark:text-green-500')}
                                {renderHeader('1s', 'hits1', 'text-right', 'text-cyan-600 dark:text-cyan-500')}
                                {renderHeader('Pitches', 'pitchesSeen', 'text-right', 'text-slate-500')}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {sortedStats.map(stat => (
                                <tr key={stat.playerId} className="hover:bg-black/5 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-3 font-bold text-slate-800 dark:text-white font-sans">{stat.name}</td>
                                    <td className="px-4 py-3 text-right font-sans tabular-nums font-bold text-lg text-slate-900 dark:text-white">{stat.totalPoints}</td>
                                    <td className="px-4 py-3 text-right font-sans tabular-nums text-slate-600 dark:text-slate-400">{stat.hits4}</td>
                                    <td className="px-4 py-3 text-right font-sans tabular-nums text-slate-600 dark:text-slate-400">{stat.hits3}</td>
                                    <td className="px-4 py-3 text-right font-sans tabular-nums text-slate-600 dark:text-slate-400">{stat.hits2}</td>
                                    <td className="px-4 py-3 text-right font-sans tabular-nums text-slate-600 dark:text-slate-400">{stat.hits1}</td>
                                    <td className="px-4 py-3 text-right font-sans tabular-nums text-slate-500">{stat.pitchesSeen}</td>
                                </tr>
                            ))}
                            {sortedStats.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 italic font-sans">No match data available for {season} yet.</td></tr>
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
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white font-sans">Manage Teams</h2>
            <p className="text-slate-500 text-sm font-bold uppercase tracking-wider font-sans">{league} League <span className="text-slate-400 mx-1">•</span> {season}</p>
        </div>
        <button onClick={onBack} className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors font-sans border border-slate-300 dark:border-slate-700">Back to Dashboard</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-xl shadow-md border border-slate-200 dark:border-slate-800 h-fit">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 font-sans">{editingTeamId ? 'Edit Team' : `Add New Team (${season})`}</h3>
            {editingTeamId && <button onClick={cancelEdit} className="text-xs text-red-500 hover:text-red-400 font-bold font-sans">Cancel Edit</button>}
          </div>
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 font-sans">Team Name</label>
              <input type="text" className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-sans text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-600" placeholder="e.g. Tigers" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} required />
            </div>
            
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-500 uppercase font-sans">Main Roster (3 Players)</label>
              <div className="grid grid-cols-2 gap-2 mb-1">
                  <span className="text-[10px] uppercase text-slate-400 font-bold font-sans">First Name (Display)</span>
                  <span className="text-[10px] uppercase text-slate-400 font-bold font-sans">Last Name (Admin)</span>
              </div>
              {players.map((player, idx) => (
                <div key={idx} className="relative flex gap-2">
                    <span className="absolute -left-5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold font-sans">#{idx + 1}</span>
                    <input 
                        type="text" 
                        className="w-1/2 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-600" 
                        placeholder="First Name" 
                        value={player.name} 
                        onChange={e => handlePlayerChange(idx, 'name', e.target.value)} 
                        required 
                    />
                    <input 
                        type="text" 
                        className="w-1/2 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-600" 
                        placeholder="Last Name (Optional)" 
                        value={player.lastName} 
                        onChange={e => handlePlayerChange(idx, 'lastName', e.target.value)} 
                    />
                </div>
              ))}
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-slate-500 uppercase font-sans">Substitutes</label>
                    <button type="button" onClick={addSubField} className="text-xs font-bold text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">+ Add Sub</button>
                </div>
                <div className="space-y-2">
                    {subs.map((sub, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                            <input 
                                type="text" 
                                className="flex-1 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-600" 
                                placeholder="First Name" 
                                value={sub.name} 
                                onChange={e => handleSubChange(idx, 'name', e.target.value)} 
                            />
                            <input 
                                type="text" 
                                className="flex-1 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-sans text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-600" 
                                placeholder="Last Name" 
                                value={sub.lastName || ''} 
                                onChange={e => handleSubChange(idx, 'lastName', e.target.value)} 
                            />
                            <button type="button" onClick={() => removeSubField(idx)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    ))}
                    {subs.length === 0 && <p className="text-xs text-slate-400 italic font-sans">No substitutes listed.</p>}
                </div>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 dark:disabled:bg-slate-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-blue-900/20 transition-all active:scale-95 font-sans">{loading ? 'Saving...' : (editingTeamId ? 'Update Team' : 'Create Team')}</button>
          </form>
        </div>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800 pb-2 font-sans">Current Teams ({teams.length})</h3>
          {teams.map(team => (
            <div key={team.id} className={`bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 rounded-xl shadow-sm border flex justify-between items-center group transition-colors ${editingTeamId === team.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-800 hover:border-blue-400'}`}>
              <div>
                <h4 className="font-bold text-lg text-slate-800 dark:text-slate-200 font-sans">{team.name}</h4>
                <div className="flex flex-col gap-1 mt-2">
                  {team.players.map(p => (
                    <span key={p.id} className="text-xs font-medium text-slate-600 dark:text-slate-400 font-sans">
                        {formatName(p)}
                    </span>
                  ))}
                </div>
                {team.subs && team.subs.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase mr-1 font-sans">Subs:</span>
                        {team.subs.map(s => (
                            <span key={s.id} className="text-xs font-medium bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-500 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 italic font-sans">
                                {formatName(s)}
                            </span>
                        ))}
                    </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                    <button onClick={() => handleSelectTeam(team)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 px-3 py-1 rounded text-xs font-bold transition-colors font-sans border border-blue-200 dark:border-blue-900/30">Stats</button>
                    <button onClick={() => handleEditTeam(team)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-300 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 px-3 py-1 rounded text-xs font-bold transition-colors font-sans border border-slate-300 dark:border-slate-700">Edit</button>
                </div>
                <button onClick={() => handleDelete(team.id, team.name)} className="text-xs text-slate-500 hover:text-red-500 p-1 transition-colors mt-1 font-sans">Delete</button>
              </div>
            </div>
          ))}
          {teams.length === 0 && <div className="text-slate-500 italic text-sm font-sans">No teams found for {season}.</div>}
        </div>
      </div>
    </div>
  );
};
