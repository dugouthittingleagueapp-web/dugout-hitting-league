import React, { useState } from 'react';
import { Team, Player } from '../types';

interface MatchSetupProps {
  homeTeam: Team;
  awayTeam: Team;
  onStart: (homeLineup: Player[], awayLineup: Player[]) => void;
  onCancel: () => void;
}

export const MatchSetup: React.FC<MatchSetupProps> = ({ homeTeam, awayTeam, onStart, onCancel }) => {
  const [homeLineup, setHomeLineup] = useState<Player[]>([...homeTeam.players]);
  const [awayLineup, setAwayLineup] = useState<Player[]>([...awayTeam.players]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const swapPlayers = (team: 'home' | 'away', idx1: number, idx2: number) => {
    const setter = team === 'home' ? setHomeLineup : setAwayLineup;
    const list = team === 'home' ? homeLineup : awayLineup;
    const newList = [...list];
    const temp = newList[idx1];
    newList[idx1] = newList[idx2];
    newList[idx2] = temp;
    setter(newList);
    setSelectedId(null);
  };

  const movePlayer = (team: 'home' | 'away', index: number, direction: 'up' | 'down') => {
    const setter = team === 'home' ? setHomeLineup : setAwayLineup;
    const list = team === 'home' ? homeLineup : awayLineup;
    const newList = [...list];
    
    if (direction === 'up' && index > 0) {
        [newList[index], newList[index - 1]] = [newList[index - 1], newList[index]];
    } else if (direction === 'down' && index < list.length - 1) {
        [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
    }
    setter(newList);
  };

  const handleItemClick = (team: 'home' | 'away', index: number, player: Player) => {
    if (!selectedId) {
        setSelectedId(player.id);
    } else {
        const list = team === 'home' ? homeLineup : awayLineup;
        const existingIdx = list.findIndex(p => p.id === selectedId);
        // Allow swapping within the same team list
        if (existingIdx !== -1 && list[existingIdx]) {
             swapPlayers(team, existingIdx, index);
        } else {
            // If they clicked a different team or something invalid, just select the new one
            setSelectedId(player.id);
        }
    }
  };

  const renderLineupList = (team: 'home' | 'away', players: Player[]) => {
    return (
      <div className="space-y-2">
        {players.map((player, index) => {
            const isSelected = selectedId === player.id;
            return (
                <div key={player.id} 
                     onClick={() => handleItemClick(team, index, player)} 
                     draggable 
                     onDragStart={(e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ team, index })); setSelectedId(player.id); }} 
                     onDragOver={(e) => e.preventDefault()} 
                     onDrop={(e) => { e.preventDefault(); const data = JSON.parse(e.dataTransfer.getData('text/plain')); if (data.team === team) { swapPlayers(team, data.index, index); } }} 
                     className={`relative p-3 rounded-xl border-2 transition-all cursor-pointer select-none flex items-center gap-3 group ${isSelected ? 'border-blue-500 bg-blue-50 shadow-md scale-[1.01]' : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm active:scale-[0.99]'}`}>
                    
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${isSelected ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{index + 1}</div>
                    
                    <div className="flex-1 min-w-0">
                        <div className={`font-bold truncate ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>{player.name}</div>
                        {isSelected && <div className="text-[10px] text-blue-600 font-medium animate-pulse">Tap another to swap</div>}
                    </div>

                    <div className="flex flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={(e) => { e.stopPropagation(); movePlayer(team, index, 'up'); }} 
                            disabled={index === 0}
                            className="p-1 rounded hover:bg-slate-100 disabled:opacity-20 text-slate-500"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                        </button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); movePlayer(team, index, 'down'); }} 
                            disabled={index === players.length - 1}
                            className="p-1 rounded hover:bg-slate-100 disabled:opacity-20 text-slate-500"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                    </div>
                </div>
            );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
                <h2 className="text-3xl font-bold text-slate-800">Set Lineup</h2>
                <p className="text-slate-500 text-sm sm:text-base">Tap to select/swap or use arrows to reorder.</p>
            </div>
            <div className="flex gap-3">
                <button onClick={onCancel} className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors">Cancel</button>
                <button onClick={() => onStart(homeLineup, awayLineup)} className="px-8 py-3 rounded-xl font-bold text-white bg-blue-600 shadow-lg shadow-blue-200 hover:bg-blue-700 hover:scale-105 transition-all">Start Match</button>
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-slate-100 p-4 sm:p-6 rounded-2xl border border-slate-200/50">
                <h3 className="text-xl font-bold text-blue-800 mb-4">Home: {homeTeam.name}</h3>
                {renderLineupList('home', homeLineup)}
            </div>
            <div className="bg-slate-100 p-4 sm:p-6 rounded-2xl border border-slate-200/50">
                <h3 className="text-xl font-bold text-red-800 mb-4">Away: {awayTeam.name}</h3>
                {renderLineupList('away', awayLineup)}
            </div>
        </div>
      </div>
    </div>
  );
};