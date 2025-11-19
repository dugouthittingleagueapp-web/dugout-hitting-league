import React, { useState, useEffect } from 'react';
import * as storage from '../services/storageService';
import { generateLeagueReport } from '../services/geminiService';

export const AdminDashboard: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [data, setData] = useState('');
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newLeagueName, setNewLeagueName] = useState('');
  const [creatingLeague, setCreatingLeague] = useState(false);
  
  // Settings State
  const [currentSeason, setCurrentSeason] = useState('2025');
  const [newSeasonInput, setNewSeasonInput] = useState('');
  
  // Password State
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newUmpirePassword, setNewUmpirePassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    const loadData = async () => { 
        const d = await storage.exportData(); 
        setData(d); 
        const season = await storage.getCurrentSeason();
        setCurrentSeason(season);
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
      alert('League created! It will now appear on the main screen.');
      setNewLeagueName('');
    } catch (e: any) {
      alert('Failed to create league: ' + (e.message || 'Unknown error'));
    } finally {
      setCreatingLeague(false);
    }
  };

  const handleUpdateSeason = async () => {
      if(!newSeasonInput.trim()) return;
      if(confirm(`Are you sure? Changing the active season to ${newSeasonInput} will hide current teams/matches from the default view (data is NOT deleted).`)) {
          await storage.updateCurrentSeason(newSeasonInput.trim());
          setCurrentSeason(newSeasonInput.trim());
          setNewSeasonInput('');
          alert("Season updated. Return to dashboard to see changes.");
      }
  };
  
  const handleUpdateAdminPassword = async () => {
    if (!newAdminPassword.trim()) return;
    if (newAdminPassword.length < 4) { setPasswordMessage('Password too short.'); return; }
    
    try {
      await storage.updateAdminPassword(newAdminPassword.trim());
      setPasswordMessage('Admin password updated!');
      setNewAdminPassword('');
      setTimeout(() => setPasswordMessage(''), 3000);
    } catch (e) {
      setPasswordMessage('Failed to update admin password.');
    }
  };

  const handleUpdateUmpirePassword = async () => {
    if (!newUmpirePassword.trim()) return;
    if (newUmpirePassword.length < 4) { setPasswordMessage('Password too short.'); return; }
    
    try {
      await storage.updateUmpirePassword(newUmpirePassword.trim());
      setPasswordMessage('Umpire password updated!');
      setNewUmpirePassword('');
      setTimeout(() => setPasswordMessage(''), 3000);
    } catch (e) {
      setPasswordMessage('Failed to update umpire password.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8"><h2 className="text-3xl font-bold text-slate-800">Admin Dashboard</h2><button onClick={onBack} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-slate-700 font-medium">Exit Admin</button></div>
      <div className="grid gap-8">
        <section className="bg-white p-6 rounded-xl shadow border border-slate-200">
            <h3 className="text-xl font-bold text-slate-700 mb-4">League Configuration</h3>
            
            <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Create New League Category</label>
                <div className="flex gap-3">
                    <input type="text" value={newLeagueName} onChange={e => setNewLeagueName(e.target.value)} placeholder="e.g. 12u, Varsity" className="flex-1 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button onClick={handleCreateLeague} disabled={creatingLeague} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 font-bold disabled:opacity-50">{creatingLeague ? 'Creating...' : 'Create'}</button>
                </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Active Season (Current: <span className="text-blue-600">{currentSeason}</span>)</label>
                <p className="text-sm text-slate-500 mb-2">Change this to "Reset" the league for a new year. Old data is preserved.</p>
                <div className="flex gap-3">
                    <input type="text" value={newSeasonInput} onChange={e => setNewSeasonInput(e.target.value)} placeholder="e.g. 2026" className="w-40 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button onClick={handleUpdateSeason} className="bg-slate-700 text-white px-6 py-2 rounded-lg hover:bg-slate-800 font-bold">Update Season</button>
                </div>
            </div>
        </section>

        <section className="bg-white p-6 rounded-xl shadow border border-slate-200">
            <h3 className="text-xl font-bold text-slate-700 mb-4">Access Control</h3>
            
            <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Update Admin Password (Full Access)</label>
                <div className="flex gap-3 items-center">
                    <input type="text" value={newAdminPassword} onChange={e => setNewAdminPassword(e.target.value)} placeholder="New Admin Password" className="flex-1 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button onClick={handleUpdateAdminPassword} className="bg-slate-800 text-white px-6 py-2 rounded-lg hover:bg-slate-900 font-bold">Update Admin</button>
                </div>
            </div>

            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Update Umpire Password (Game Access)</label>
                <div className="flex gap-3 items-center">
                    <input type="text" value={newUmpirePassword} onChange={e => setNewUmpirePassword(e.target.value)} placeholder="New Umpire Password" className="flex-1 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button onClick={handleUpdateUmpirePassword} className="bg-blue-800 text-white px-6 py-2 rounded-lg hover:bg-blue-900 font-bold">Update Umpire</button>
                </div>
            </div>

            {passwordMessage && <p className={`mt-4 text-sm font-bold ${passwordMessage.includes('success') || passwordMessage.includes('updated') ? 'text-green-600' : 'text-red-600'}`}>{passwordMessage}</p>}
        </section>

        <section className="bg-white p-6 rounded-xl shadow border border-slate-200">
            <h3 className="text-xl font-bold text-slate-700 mb-4">Data Management</h3>
            <button onClick={handleExport} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-lg hover:bg-blue-700 transition-colors">Export JSON Database</button>
        </section>
      </div>
    </div>
  );
};