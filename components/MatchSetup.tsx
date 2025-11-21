
import React, { useState } from 'react';
import { Team, Player } from '../types';
import * as storage from '../services/storageService';

interface MatchSetupProps {
  homeTeam: Team;
  awayTeam: Team;
  onStart: (finalHomeId: string, finalAwayId: string, homeLineup: Player[], awayLineup: Player[]) => void;
  onCancel: () => void;
}

export const MatchSetup: React.FC<MatchSetupProps> = ({ homeTeam, awayTeam, onStart, onCancel }) => {
  // Initialize with only the first 3 players to prevent overflow if team has >3 players
  const [homeLineup, setHomeLineup] = useState<Player[]>(homeTeam.players.slice(0, 3));
  const [awayLineup, setAwayLineup] = useState<Player[]>(awayTeam.players.slice(0, 3));
  
  const [isSwapped, setIsSwapped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sub Modal State
  const [showSubModal, setShowSubModal] = useState(false);
  const [subSide, setSubSide] = useState<'left' | 'right' | null>(null);
  const [newSubName, setNewSubName] = useState('');

  // Helper to format name as First L.
  const formatName = (p: { name: string, lastName?: string }) => 
    `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;

  // Helper to get current visual home/away names/lineups
  // If swapped: Left Side shows Away Team data, Right Side shows Home Team data
  const leftSideTeam = isSwapped ? awayTeam : homeTeam;
  const rightSideTeam = isSwapped ? homeTeam : awayTeam;
  
  // Accessors for lineups based on visual side
  const getLeftSideLineup = () => isSwapped ? awayLineup : homeLineup;
  const setLeftSideLineup = (p: Player[]) => isSwapped ? setAwayLineup(p) : setHomeLineup(p);
  
  const getRightSideLineup = () => isSwapped ? homeLineup : awayLineup;
  const setRightSideLineup = (p: Player[]) => isSwapped ? setHomeLineup(p) : setAwayLineup(p);

  const swapPlayers = (side: 'left' | 'right', idx1: number, idx2: number) => {
    const list = side === 'left' ? getLeftSideLineup() : getRightSideLineup();
    const setter = side === 'left' ? setLeftSideLineup : setRightSideLineup;
    
    const newList = [...list];
    const temp = newList[idx1];
    newList[idx1] = newList[idx2];
    newList[idx2] = temp;
    setter(newList);
    setSelectedId(null);
  };

  const movePlayer = (side: 'left' | 'right', index: number, direction: 'up' | 'down') => {
    const list = side === 'left' ? getLeftSideLineup() : getRightSideLineup();
    const setter = side === 'left' ? setLeftSideLineup : setRightSideLineup;
    
    const newList = [...list];
    if (direction === 'up' && index > 0) {
        [newList[index], newList[index - 1]] = [newList[index - 1], newList[index]];
    } else if (direction === 'down' && index < list.length - 1) {
        [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
    }
    setter(newList);
  };

  const removePlayer = (side: 'left' | 'right', index: number) => {
      const list = side === 'left' ? getLeftSideLineup() : getRightSideLineup();
      const setter = side === 'left' ? setLeftSideLineup : setRightSideLineup;
      const newList = [...list];
      newList.splice(index, 1);
      setter(newList);
  };

  const restoreRoster = (side: 'left' | 'right') => {
      const originalTeam = side === 'left' ? leftSideTeam : rightSideTeam;
      const setter = side === 'left' ? setLeftSideLineup : setRightSideLineup;
      // Restore to default first 3 players
      setter(originalTeam.players.slice(0, 3));
  };

  const openSubModal = (side: 'left' | 'right') => {
      setSubSide(side);
      setNewSubName('');
      setShowSubModal(true);
  };

  const handleAddSub = (player: Player) => {
      if (!subSide) return;
      const list = subSide === 'left' ? getLeftSideLineup() : getRightSideLineup();
      const setter = subSide === 'left' ? setLeftSideLineup : setRightSideLineup;
      
      // Check if already in lineup
      if (list.find(p => p.id === player.id)) {
          alert("Player already in lineup");
          return;
      }
      
      setter([...list, player]);
      setShowSubModal(false);
  };

  const handleCreateNewSub = () => {
      if (!newSubName.trim()) return;
      const newPlayer: Player = { id: storage.generateUUID(), name: newSubName.trim() };
      handleAddSub(newPlayer);
  };

  const handleItemClick = (side: 'left' | 'right', index: number, player: Player) => {
    if (!selectedId) {
        setSelectedId(player.id);
    } else {
        const list = side === 'left' ? getLeftSideLineup() : getRightSideLineup();
        const existingIdx = list.findIndex(p => p.id === selectedId);
        // Allow swapping within the same visible list
        if (existingIdx !== -1 && list[existingIdx]) {
             swapPlayers(side, existingIdx, index);
        } else {
            setSelectedId(player.id);
        }
    }
  };

  const handleStartMatch = () => {
      if (isSwapped) {
          // Visual Left is Away, Visual Right is Home.
          // App expects (finalHomeId, finalAwayId, homeLineup, awayLineup)
          // Since we swapped, the new HOME team is awayTeam, new AWAY team is homeTeam.
          onStart(awayTeam.id, homeTeam.id, awayLineup, homeLineup);
      } else {
          onStart(homeTeam.id, awayTeam.id, homeLineup, awayLineup);
      }
  };

  const renderLineupList = (side: 'left' | 'right', teamData: Team, players: Player[]) => {
    return (
      <div className="space-y-2">
        {players.map((player, index) => {
            const isSelected = selectedId === player.id;
            return (
                <div key={player.id} 
                     onClick={() => handleItemClick(side, index, player)} 
                     draggable 
                     onDragStart={(e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ side, index })); setSelectedId(player.id); }} 
                     onDragOver={(e) => e.preventDefault()} 
                     onDrop={(e) => { e.preventDefault(); const data = JSON.parse(e.dataTransfer.getData('text/plain')); if (data.side === side) { swapPlayers(side, data.index, index); } }} 
                     className={`relative p-3 rounded-xl border-2 transition-all cursor-pointer select-none flex items-center gap-3 group ${isSelected ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/20 shadow-md scale-[1.01]' : 'border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 hover:border-slate-400 dark:hover:border-slate-600 shadow-sm active:scale-[0.99]'}`}>
                    
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 font-sans tabular-nums ${isSelected ? 'bg-blue-500 text-white' : 'bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500'}`}>{index + 1}</div>
                    
                    <div className="flex-1 min-w-0">
                        <div className={`font-bold truncate font-sans ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`}>{formatName(player)}</div>
                        {isSelected && <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium animate-pulse font-sans">Tap another to swap</div>}
                    </div>

                    <div className="flex items-center gap-1">
                        <div className="flex flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button 
                                onClick={(e) => { e.stopPropagation(); movePlayer(side, index, 'up'); }} 
                                disabled={index === 0}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 text-slate-500"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); movePlayer(side, index, 'down'); }} 
                                disabled={index === players.length - 1}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 text-slate-500"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                            </button>
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); removePlayer(side, index); }}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
                            title="Remove Player"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    </div>
                </div>
            );
        })}
        
        <div className="flex gap-2 mt-3">
             {players.length < 3 && (
                <button onClick={() => restoreRoster(side)} className="flex-1 py-2 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded border border-dashed border-blue-300 dark:border-blue-800 hover:border-blue-500 dark:hover:border-blue-600 transition-colors font-sans">
                    + Reset Roster
                </button>
            )}
            {players.length < 3 && (
                <button onClick={() => openSubModal(side)} className="flex-1 py-2 text-xs font-bold text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded border border-dashed border-green-300 dark:border-green-800 hover:border-green-500 dark:hover:border-green-600 transition-colors font-sans">
                    + Add Sub
                </button>
            )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-transparent p-4 sm:p-8 font-sans text-slate-800 dark:text-slate-200">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
                <h2 className="text-3xl font-bold text-slate-800 dark:text-white font-sans">Set Lineup</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base font-sans">Drag/Tap to reorder. Remove players for 2-person teams.</p>
            </div>
            <div className="flex flex-wrap gap-3">
                <button onClick={() => setIsSwapped(!isSwapped)} className="flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-sans">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5-5 5"/><path d="M4 20h17"/><path d="m8 21-5-5 5-5"/></svg>
                    Swap Sides
                </button>
                <button onClick={onCancel} className="px-6 py-3 rounded-xl font-bold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-sans">Cancel</button>
                <button onClick={handleStartMatch} className="flex-1 sm:flex-none px-8 py-3 rounded-xl font-bold text-white bg-blue-600 shadow-lg shadow-blue-900/50 hover:bg-blue-500 hover:scale-105 transition-all font-sans">Start Match</button>
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 transition-all">
                {/* Home = Red, Away = Blue */}
                <h3 className={`text-xl font-bold mb-4 flex justify-between items-center font-sans ${isSwapped ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                    <span>Home: {leftSideTeam.name}</span>
                    {isSwapped && <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-1 rounded font-sans">Swapped</span>}
                </h3>
                {renderLineupList('left', leftSideTeam, getLeftSideLineup())}
            </div>
            <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 transition-all">
                 <h3 className={`text-xl font-bold mb-4 flex justify-between items-center font-sans ${isSwapped ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                    <span>Away: {rightSideTeam.name}</span>
                    {isSwapped && <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-1 rounded font-sans">Swapped</span>}
                </h3>
                {renderLineupList('right', rightSideTeam, getRightSideLineup())}
            </div>
        </div>
      </div>

      {/* Add Sub Modal */}
      {showSubModal && subSide && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowSubModal(false)}>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-[90%] max-w-md font-sans border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-bold text-slate-800 dark:text-white font-sans">Add Substitute</h3>
                      <button onClick={() => setShowSubModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                      </button>
                  </div>

                  {/* Existing Subs List */}
                  <div className="mb-6">
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 font-sans">Available Subs</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                          {(() => {
                              const team = subSide === 'left' ? leftSideTeam : rightSideTeam;
                              const subs = team.subs || [];
                              const lineup = subSide === 'left' ? getLeftSideLineup() : getRightSideLineup();
                              // Filter out subs already in lineup
                              const availableSubs = subs.filter(s => !lineup.find(l => l.id === s.id));

                              if (availableSubs.length === 0) {
                                  return <p className="text-sm italic text-slate-400 dark:text-slate-600">No previous substitutes found.</p>;
                              }

                              return availableSubs.map(sub => (
                                  <button 
                                    key={sub.id} 
                                    onClick={() => handleAddSub(sub)}
                                    className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-left"
                                  >
                                      <span className="font-bold text-slate-700 dark:text-slate-200">{formatName(sub)}</span>
                                      <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded font-bold">Add</span>
                                  </button>
                              ));
                          })()}
                      </div>
                  </div>

                  {/* Create New Sub */}
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 font-sans">Create New Sub</h4>
                      <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={newSubName} 
                            onChange={e => setNewSubName(e.target.value)}
                            placeholder="Player Name" 
                            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none font-sans text-slate-900 dark:text-white"
                          />
                          <button 
                            onClick={handleCreateNewSub} 
                            disabled={!newSubName.trim()}
                            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg text-sm font-sans"
                          >
                              Create & Add
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
