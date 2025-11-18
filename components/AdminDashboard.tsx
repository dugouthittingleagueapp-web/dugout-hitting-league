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

  useEffect(() => {
    const loadData = async () => { const d = await storage.exportData(); setData(d); };
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

  const handleGenerateReport = async () => {
    setLoading(true);
    setError('');
    try { 
      const result = await generateLeagueReport(); 
      setReport(result); 
    } 
    catch (e) { 
      setError("Failed to generate report. Ensure API Key is set in environment."); 
      console.error(e);
    } 
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8"><h2 className="text-3xl font-bold text-slate-800">Admin Dashboard</h2><button onClick={onBack} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-slate-700 font-medium">Exit Admin</button></div>
      <div className="grid gap-8">
        <section className="bg-white p-6 rounded-xl shadow border border-slate-200">
            <h3 className="text-xl font-bold text-slate-700 mb-4">League Management</h3>
            <div className="flex gap-3">
                <input type="text" value={newLeagueName} onChange={e => setNewLeagueName(e.target.value)} placeholder="League Name (e.g. 12u, Varsity)" className="flex-1 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                <button onClick={handleCreateLeague} disabled={creatingLeague} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 font-bold disabled:opacity-50">{creatingLeague ? 'Creating...' : 'Create League'}</button>
            </div>
        </section>

        <section className="bg-white p-6 rounded-xl shadow border border-slate-200">
            <h3 className="text-xl font-bold text-slate-700 mb-4">Data Management</h3>
            <button onClick={handleExport} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-lg hover:bg-blue-700 transition-colors">Export JSON Database</button>
        </section>

        <section className="bg-gradient-to-br from-purple-50 to-indigo-50 p-6 rounded-xl shadow border border-indigo-100">
            <h3 className="text-xl font-bold text-indigo-900 mb-2">AI League Analyst</h3>
            <p className="text-sm text-indigo-700 mb-4">Generates a summary report using Google Gemini 2.5 Flash.</p>
            <button onClick={handleGenerateReport} disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-bold">{loading ? 'Analyzing...' : 'Generate Report'}</button>
            {error && <p className="mt-2 text-red-600 text-sm">{error}</p>}
            {report && <div className="mt-6 p-4 bg-white rounded border border-indigo-100 prose prose-sm max-w-none text-slate-700"><p className="whitespace-pre-line">{report}</p></div>}
        </section>
      </div>
    </div>
  );
};