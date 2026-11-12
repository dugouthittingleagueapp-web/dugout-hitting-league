import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Team, Player } from '../types.js';
import * as storage from '../services/storageService.js';
import { isPlaceholderPlayerName } from '../utils/statsEditorHelper.js';
import { detectForfeit } from '../services/matchHelpers.js';
import { removeDraftLineupPlayer, isPlayableLineup, incompleteLineupMessage } from '../utils/lineupDraft.js';

interface MatchSetupProps {
  homeTeam: Team;
  awayTeam: Team;
  onStart: (finalHomeId: string, finalAwayId: string, homeLineup: Player[], awayLineup: Player[]) => void;
  onCancel: () => void;
}

export const MatchSetup: React.FC<MatchSetupProps> = ({ homeTeam, awayTeam, onStart, onCancel }) => {
  // Initialize with only the first 3 players to prevent overflow if team has >3 players
  const [homeLineup, setHomeLineup] = useState<Player[]>(() => (homeTeam?.players || []).slice(0, 3));
  const [awayLineup, setAwayLineup] = useState<Player[]>(() => (awayTeam?.players || []).slice(0, 3));
  
  const [isSwapped, setIsSwapped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sub Modal State
  const [showSubModal, setShowSubModal] = useState(false);
  const [subSide, setSubSide] = useState<'left' | 'right' | null>(null);
  const [newSubName, setNewSubName] = useState('');

  // Inline Player Rename State
  const [editingPlayer, setEditingPlayer] = useState<{ id: string; name: string; lastName: string } | null>(null);

  // Placeholder Prompt Modal State (Warn & Prompt before match start)
  const [showPlaceholderPrompt, setShowPlaceholderPrompt] = useState(false);
  const [placeholderEntries, setPlaceholderEntries] = useState<Record<string, { name: string; lastName: string }>>({});

  // Lock Body Scroll Effect
  useEffect(() => {
      if (showSubModal || showPlaceholderPrompt || editingPlayer) {
          document.body.style.overflow = 'hidden';
      } else {
          document.body.style.overflow = '';
      }
      return () => { document.body.style.overflow = ''; };
  }, [showSubModal, showPlaceholderPrompt, editingPlayer]);

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
      // Allow temporary incomplete drafts while substituting absent regulars.
      const setter = side === 'left' ? setLeftSideLineup : setRightSideLineup;
      const player = list[index];
      if (player) setter(removeDraftLineupPlayer(list, player.id));
  };

  const restoreRoster = (side: 'left' | 'right') => {
      const originalTeam = side === 'left' ? leftSideTeam : rightSideTeam;
      const setter = side === 'left' ? setLeftSideLineup : setRightSideLineup;
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
      
      if (list.find(p => p.id === player.id)) {
          alert("Player already in lineup");
          return;
      }
      
      if (list.length >= 3) {
          alert('A lineup can have up to 3 batters. Remove a regular first if you need to add a substitute.');
          return;
      }
      setter([...list, player]);
      setShowSubModal(false);
  };

  const handleCreateNewSub = () => {
      const trimmed = newSubName.trim();
      if (!trimmed) {
          alert("Please enter the player's name");
          return;
      }
      if (isPlaceholderPlayerName(trimmed)) {
          alert("Please enter the player's actual name rather than a generic placeholder like 'Sub' or 'Player 1' so their stats can be credited.");
          return;
      }
      const list = subSide === 'left' ? getLeftSideLineup() : getRightSideLineup();
      if (list.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
          alert("A player with this name is already in the lineup");
          return;
      }
      const newPlayer: Player = { id: storage.generateUUID(), name: trimmed };
      handleAddSub(newPlayer);
  };

  const handleRenamePlayerSave = async () => {
    if (!editingPlayer) return;
    const trimmed = editingPlayer.name.trim();
    if (!trimmed) {
      alert("Player name cannot be empty");
      return;
    }
    if (isPlaceholderPlayerName(trimmed)) {
      alert("Please enter a real player name instead of a placeholder.");
      return;
    }

    const updater = (list: Player[]) =>
      list.map(p => (p.id === editingPlayer.id ? { ...p, name: trimmed, lastName: editingPlayer.lastName?.trim() || undefined } : p));

    setHomeLineup(updater);
    setAwayLineup(updater);

    // Also update team roster permanently
    try {
      if (homeTeam.players.some(p => p.id === editingPlayer.id)) {
        const updated = { ...homeTeam, players: updater(homeTeam.players) };
        await storage.updateTeam(updated);
      }
      if (awayTeam.players.some(p => p.id === editingPlayer.id)) {
        const updated = { ...awayTeam, players: updater(awayTeam.players) };
        await storage.updateTeam(updated);
      }
    } catch (e) {
      console.warn('Failed to persist renamed player to team roster', e);
    }

    setEditingPlayer(null);
  };

  const handleItemClick = (side: 'left' | 'right', index: number, player: Player) => {
    if (!selectedId) {
        setSelectedId(player.id);
    } else {
        const list = side === 'left' ? getLeftSideLineup() : getRightSideLineup();
        const existingIdx = list.findIndex(p => p.id === selectedId);
        if (existingIdx !== -1 && list[existingIdx]) {
             swapPlayers(side, existingIdx, index);
        } else {
            setSelectedId(player.id);
        }
    }
  };

  // Check for any placeholder players currently in the lineups
  const detectPlaceholderPlayers = () => {
    const list: { player: Player; teamSide: 'Home' | 'Away'; team: Team }[] = [];
    homeLineup.forEach(p => {
      if (isPlaceholderPlayerName(p.name)) {
        list.push({ player: p, teamSide: 'Home', team: homeTeam });
      }
    });
    awayLineup.forEach(p => {
      if (isPlaceholderPlayerName(p.name)) {
        list.push({ player: p, teamSide: 'Away', team: awayTeam });
      }
    });
    return list;
  };

  const handleStartMatchClick = () => {
      if (!validateStartingLineups(homeLineup, awayLineup)) return;
      const placeholders = detectPlaceholderPlayers();
      if (placeholders.length > 0) {
        // Initialize inputs for placeholders
        const initial: Record<string, { name: string; lastName: string }> = {};
        placeholders.forEach(item => {
          initial[item.player.id] = { name: '', lastName: '' };
        });
        setPlaceholderEntries(initial);
        setShowPlaceholderPrompt(true);
        return;
      }
      executeMatchStart(homeLineup, awayLineup);
  };

  const validateStartingLineups = (home: Player[], away: Player[]): boolean => {
      if (!isPlayableLineup(home.map(player => player.id))) {
          alert(incompleteLineupMessage(homeTeam.name));
          return false;
      }
      if (!isPlayableLineup(away.map(player => player.id))) {
          alert(incompleteLineupMessage(awayTeam.name));
          return false;
      }
      return true;
  };

  const executeMatchStart = (finalHomeLineup: Player[], finalAwayLineup: Player[]) => {
      if (!validateStartingLineups(finalHomeLineup, finalAwayLineup)) return;
      if (isSwapped) {
          onStart(awayTeam.id, homeTeam.id, finalAwayLineup, finalHomeLineup);
      } else {
          onStart(homeTeam.id, awayTeam.id, finalHomeLineup, finalAwayLineup);
      }
  };

  const handleSavePlaceholdersAndStart = async () => {
    let updatedHome = [...homeLineup];
    let updatedAway = [...awayLineup];

    const teamHomePlayers = [...homeTeam.players];
    const teamAwayPlayers = [...awayTeam.players];

    for (const [id, vals] of Object.entries(placeholderEntries)) {
      if (vals && vals.name.trim()) {
        const realName = vals.name.trim();
        const realLast = vals.lastName?.trim() || undefined;

        updatedHome = updatedHome.map(p => (p.id === id ? { ...p, name: realName, lastName: realLast } : p));
        updatedAway = updatedAway.map(p => (p.id === id ? { ...p, name: realName, lastName: realLast } : p));

        const hIdx = teamHomePlayers.findIndex(p => p.id === id);
        if (hIdx !== -1) teamHomePlayers[hIdx] = { ...teamHomePlayers[hIdx], name: realName, lastName: realLast };

        const aIdx = teamAwayPlayers.findIndex(p => p.id === id);
        if (aIdx !== -1) teamAwayPlayers[aIdx] = { ...teamAwayPlayers[aIdx], name: realName, lastName: realLast };
      }
    }

    try {
      if (homeTeam) await storage.updateTeam({ ...homeTeam, players: teamHomePlayers });
      if (awayTeam) await storage.updateTeam({ ...awayTeam, players: teamAwayPlayers });
    } catch (e) {}

    setShowPlaceholderPrompt(false);
    executeMatchStart(updatedHome, updatedAway);
  };

  const renderLineupList = (side: 'left' | 'right', teamData: Team, players: Player[]) => {
    return (
      <div className="space-y-2.5">
        {players.map((player, index) => {
            const isSelected = selectedId === player.id;
            const isPlaceholder = isPlaceholderPlayerName(player.name);

            return (
                <div key={player.id} 
                     onClick={() => handleItemClick(side, index, player)} 
                     className={`relative p-3 rounded-xl border-2 transition-all cursor-pointer select-none flex items-center gap-3 ${isSelected ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/30 shadow-md ring-2 ring-blue-400/50' : isPlaceholder ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 hover:border-slate-300 dark:hover:border-slate-600 shadow-sm active:scale-[0.99]'}`}>
                    
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shrink-0 font-sans tabular-nums ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-900 text-slate-700 dark:text-slate-300'}`}>{index + 1}</div>
                    
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`font-bold truncate text-sm sm:text-base font-sans ${isSelected ? 'text-blue-700 dark:text-blue-300 font-extrabold' : 'text-slate-900 dark:text-slate-100'}`}>{formatName(player)}</div>
                          {isPlaceholder && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 shrink-0">
                              ⚠️ Enter Name
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium font-sans">
                            {isSelected ? <span className="text-blue-600 dark:text-blue-400 font-bold animate-pulse">Tap another player to swap</span> : `Batter #${index + 1}`}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPlayer({
                                id: player.id,
                                name: isPlaceholder ? '' : player.name,
                                lastName: player.lastName || ''
                              });
                            }}
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700"
                            title="Edit / Rename Player"
                            aria-label="Edit player name"
                        >
                            ✏️
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); movePlayer(side, index, 'up'); }} 
                            disabled={index === 0}
                            aria-label="Move up in lineup"
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-20 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); movePlayer(side, index, 'down'); }} 
                            disabled={index === players.length - 1}
                            aria-label="Move down in lineup"
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-20 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removePlayer(side, index); }}
                            className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-900/40"
                            title="Remove player while choosing substitutes"
                            aria-label="Remove player"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    </div>
                </div>
            );
        })}
        
        {players.length < 2 && (
            <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                {incompleteLineupMessage(teamData.name)} Add substitutes below, or reset the roster.
            </p>
        )}
        <div className="flex gap-2 mt-3">
             {players.length < 3 && (
                <button onClick={() => restoreRoster(side)} className="flex-1 py-2.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl border border-dashed border-blue-300 dark:border-blue-800 hover:border-blue-500 dark:hover:border-blue-600 transition-colors font-sans cursor-pointer">
                    + Reset Roster
                </button>
            )}
            {players.length < 3 && (
                <button onClick={() => openSubModal(side)} className="flex-1 py-2.5 text-xs font-bold text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl border border-dashed border-green-300 dark:border-green-800 hover:border-green-500 dark:hover:border-green-600 transition-colors font-sans cursor-pointer">
                    + Add Sub
                </button>
            )}
        </div>
      </div>
    );
  };

  const effectiveHomeTeam = isSwapped ? awayTeam : homeTeam;
  const effectiveAwayTeam = isSwapped ? homeTeam : awayTeam;
  const effectiveHomeLineup = isSwapped ? awayLineup : homeLineup;
  const effectiveAwayLineup = isSwapped ? homeLineup : awayLineup;

  const forfeitEval = detectForfeit(
    effectiveHomeTeam,
    effectiveAwayTeam,
    effectiveHomeLineup.map(p => p.id),
    effectiveAwayLineup.map(p => p.id)
  );

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 pb-24 font-sans animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
           <div className="flex items-center gap-2 mb-1">
               <span className="text-xs font-bold uppercase tracking-wider text-slate-400 font-sans">Pre-Game Setup</span>
               <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700"></span>
               <span className="text-xs font-bold text-blue-600 dark:text-blue-400 font-sans">{homeTeam.league} League</span>
           </div>
           <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white font-sans tracking-tight">Set Batting Order</h2>
        </div>
        
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button 
              onClick={() => setIsSwapped(!isSwapped)} 
              className="flex-1 sm:flex-initial py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs sm:text-sm font-sans transition-all flex items-center justify-center gap-1.5 border border-slate-300 dark:border-slate-700 cursor-pointer shadow-sm"
              title="Swap Home and Away dugout assignments"
            >
              <span>⇄</span>
              <span>Swap Home / Away</span>
            </button>
            <button 
              onClick={onCancel} 
              className="py-2.5 px-4 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs sm:text-sm font-sans transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button 
              onClick={handleStartMatchClick} 
              className="py-2.5 px-5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs sm:text-sm font-sans shadow-lg shadow-green-900/20 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <span>Start Game</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
        </div>
      </div>

      <div className="space-y-6">
        {forfeitEval.isForfeit && (
          <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-500/60 rounded-xl p-4 text-xs font-sans text-red-900 dark:text-red-200 shadow-md animate-in fade-in">
            <div className="flex items-center gap-2 mb-2 font-black text-sm text-red-600 dark:text-red-400 uppercase tracking-wider">
              <span>⚠️</span>
              <span>Official Roster Threshold Warning: Automatic Forfeit</span>
            </div>
            <p className="mb-2 leading-relaxed font-semibold">
              {forfeitEval.forfeitReason}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-red-200 dark:border-red-900/50 text-[11px]">
              <div className="bg-white/70 dark:bg-slate-900/60 p-2 rounded-lg border border-red-200/50 dark:border-red-800/40">
                <span className="font-bold text-red-700 dark:text-red-300">Automatic Decision: </span>
                <span>
                  {forfeitEval.winningTeamId === effectiveHomeTeam.id ? effectiveHomeTeam.name : effectiveAwayTeam.name} awarded Win. {forfeitEval.forfeitingTeamId === effectiveHomeTeam.id ? effectiveHomeTeam.name : effectiveAwayTeam.name} receives Loss.
                </span>
              </div>
              <div className="bg-white/70 dark:bg-slate-900/60 p-2 rounded-lg border border-red-200/50 dark:border-red-800/40">
                <span className="font-bold text-red-700 dark:text-red-300">Asymmetrical Stats: </span>
                <span>
                  Compliant team stats count normally. Forfeiting team stats are completely excluded from season totals.
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-4 rounded-xl text-xs text-amber-800 dark:text-amber-300 font-sans">
             <span className="font-bold">Dugout Note:</span> Batters will hit in this exact order. Tap any player to swap positions, or use the arrows to reorder. 3v2 games automatically activate 15-pitch Ghost Mode for the short team.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 transition-all">
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

      {/* Inline Player Rename Modal */}
      {editingPlayer && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setEditingPlayer(null)}>
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800 font-sans" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-1">Enter Player Name</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Enter the player&apos;s real name so their match hits, runs, and career records are saved.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">First Name *</label>
                <input
                  type="text"
                  autoFocus
                  value={editingPlayer.name}
                  onChange={e => setEditingPlayer({ ...editingPlayer, name: e.target.value })}
                  placeholder="e.g. Jack"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Last Name (Optional)</label>
                <input
                  type="text"
                  value={editingPlayer.lastName}
                  onChange={e => setEditingPlayer({ ...editingPlayer, lastName: e.target.value })}
                  placeholder="e.g. Miller"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingPlayer(null)}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenamePlayerSave}
                disabled={!editingPlayer.name.trim()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-900/20"
              >
                Save Name
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Pre-Game Placeholder Warning & Name Prompt Modal */}
      {showPlaceholderPrompt && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setShowPlaceholderPrompt(false)}>
          <div className="bg-white dark:bg-slate-900 p-6 sm:p-7 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-800 font-sans" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl shrink-0">
                ⚠️
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Enter Real Player Names</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Some lineup slots have generic placeholder names. Enter their real names so their hits and stats are properly credited.
                </p>
              </div>
            </div>

            <div className="space-y-4 my-5">
              {detectPlaceholderPlayers().map(({ player, teamSide, team }, idx) => {
                const currentVals = placeholderEntries[player.id] || { name: '', lastName: '' };
                return (
                  <div key={player.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-white">
                        {team.name} ({teamSide}) — Slot #{idx + 1}
                      </span>
                      <span className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded font-bold">
                        {player.name}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={currentVals.name}
                        onChange={e => setPlaceholderEntries(prev => ({
                          ...prev,
                          [player.id]: { ...prev[player.id], name: e.target.value }
                        }))}
                        placeholder="First Name *"
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={currentVals.lastName}
                        onChange={e => setPlaceholderEntries(prev => ({
                          ...prev,
                          [player.id]: { ...prev[player.id], lastName: e.target.value }
                        }))}
                        placeholder="Last Name"
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowPlaceholderPrompt(false);
                  executeMatchStart(homeLineup, awayLineup);
                }}
                className="py-2.5 px-3 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-bold text-xs order-2 sm:order-1"
              >
                Skip & Start Anyway
              </button>
              <div className="flex-1 flex gap-2 order-1 sm:order-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowPlaceholderPrompt(false)}
                  className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePlaceholdersAndStart}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold text-xs rounded-xl shadow-md shadow-green-900/20"
                >
                  Save Names & Begin Scoring
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add Sub Modal */}
      {showSubModal && subSide && createPortal(
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
                            placeholder="Player Real Name" 
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
          </div>,
          document.body
      )}
    </div>
  );
};