import React, { useState, useEffect } from 'react';
import { Match, Inning, Team } from '../types';
import * as storage from '../services/storageService';
import { ScoreInput } from './ScoreInput';

interface ScoreboardProps {
  matchId: string;
  onExit: () => void;
  isReadOnly?: boolean; // For Fans
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ matchId, onExit, isReadOnly = false }) => {
  const [match, setMatch] = useState<Match | null>(null);
  const [teams, setTeams] = useState<{ home?: Team, away?: Team }>({});
  const [activeInningIdx, setActiveInningIdx] = useState(0);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; } | null>(null);

  const loadMatchData = async () => {
      const m = await storage.getMatch(matchId);
      if (m) {
        const allTeams = await storage.getAllTeams();
        setMatch(m);
        setTeams({ home: allTeams.find(t => t.id === m.homeTeamId), away: allTeams.find(t => t.id === m.awayTeamId) });
      }
  };

  // Initial Load
  useEffect(() => {
    const init = async () => {
        setLoading(true);
        await loadMatchData();
        setLoading(false);
    };
    init();
  }, [matchId]);

  // Polling for Fans (Read Only Mode) - Updates every 5 seconds
  useEffect(() => {
      if (!isReadOnly) return;
      
      const interval = setInterval(() => {
          loadMatchData();
      }, 5000);
      return () => clearInterval(interval);
  }, [matchId, isReadOnly]);

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400 font-bold">Loading Match Data...</div>;
  if (!match || !teams.home || !teams.away) return <div className="text-center p-8">Error loading match</div>;

  const currentInning = match.innings[activeInningIdx];

  const handleScoreUpdate = async (side: 'home' | 'away', lineupIdx: number, pitchIdx: number, val: number) => {
    if (isReadOnly) return;

    // Check if this was an edit of an existing score
    const existingValue = match.innings[activeInningIdx][side].playerScores[lineupIdx].pitches[pitchIdx].points;
    const isEdit = existingValue !== null;

    const newMatch = { ...match };
    const inning = newMatch.innings[activeInningIdx];
    const teamData = side === 'home' ? inning.home : inning.away;
    
    teamData.playerScores[lineupIdx].pitches[pitchIdx].points = val;
    setMatch(newMatch);
    storage.updateMatch(newMatch).catch(err => console.error("Failed to save score", err));

    // Auto-advance logic:
    if (isEdit) {
        // If we are EDITING, we do NOT advance. Just close logic.
        setActiveCell(null);
        return;
    }

    // Detect 2-Player Mode for custom navigation flow
    // 2 Players have 15 pitches each. 
    const isTwoPlayerMode = teamData.playerScores.length === 2 && teamData.playerScores[0].pitches.length >= 15;

    if (isTwoPlayerMode) {
        // Player hits 15 pitches straight (0-14).
        // Indices 0-9 are on Row 1/2. Indices 10-14 are on Ghost Row.
        // The visual mapping handles the display, we just need to increment the pitch index.
        
        if (pitchIdx < 14) {
            // Advance to next pitch within the 15-pitch sequence
            // (e.g. Pitch 10 -> 11, which visually jumps from Main Row to Ghost Row automatically)
            setActiveCell({ side, lineupIdx, pitchIdx: pitchIdx + 1 });
        } else {
            // Hit Pitch 15 (Index 14). Stop.
            // User must manually select the next player, just like in 3-player mode after pitch 10.
            setActiveCell(null);
        }
    } else {
        // Standard 3-Player / Normal Flow (10 pitches)
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        if (pitchIdx < totalPitches - 1) {
            setActiveCell({ side, lineupIdx, pitchIdx: pitchIdx + 1 });
        } else {
            // Hit Pitch 10. Stop.
            setActiveCell(null);
        }
    }
  };

  const confirmCompleteGame = async () => {
    if (isReadOnly) return;
    const newMatch = { ...match, isComplete: true };
    setMatch(newMatch);
    await storage.updateMatch(newMatch);
    setShowFinishModal(false);
    onExit();
  };

  const handleRestoreRoster = async (side: 'home' | 'away') => {
    if (isReadOnly) return;
    const team = side === 'home' ? teams.home : teams.away;
    if (!team) return;
    
    if (confirm(`Player arrived? This will reset the scorecard for ${team.name} for the REMAINDER of the game (including the current inning) to the full 3-player / 10-pitch format. Existing scores in this specific inning will be lost.`)) {
        setLoading(true);
        try {
            const updatedMatch = await storage.restoreTeamRoster(match.id, team.id, activeInningIdx);
            setMatch(updatedMatch);
        } catch (e) {
            alert("Failed to restore roster.");
        }
        setLoading(false);
    }
  };

  const calculateTeamInningTotal = (side: 'home' | 'away', inning: Inning) => {
    const teamData = side === 'home' ? inning.home : inning.away;
    return teamData.playerScores.reduce((sum, player) => sum + player.pitches.reduce((pSum, pitch) => pSum + (pitch.points || 0), 0), 0);
  };

  const calculateTeamGameTotal = (side: 'home' | 'away') => {
    return match.innings.reduce((sum, inning) => sum + calculateTeamInningTotal(side, inning), 0);
  };

  const homeTotal = calculateTeamGameTotal('home');
  const awayTotal = calculateTeamGameTotal('away');

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const teamColor = side === 'home' ? 'text-blue-800 bg-blue-50' : 'text-red-800 bg-red-50';
    
    // Check for 2-player mode (specifically looking at data structure)
    const isTwoPlayerMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;

    // Check if team is short-handed (2 players) while full roster is bigger (3)
    // Only allow restore in Innings 2-6 (index 1-5)
    const isShortHanded = inningData.playerScores.length < team.players.length;
    const canRestore = !isReadOnly && isShortHanded && activeInningIdx >= 1;

    const renderRow = (playerScore: any, lineupIdx: number, player: any, pitchStartIndex: number, pitchEndIndex: number, isGhostRow = false) => {
         const visiblePitches = playerScore.pitches.slice(pitchStartIndex, pitchEndIndex);
         // Calc total just for this visible segment
         const rowTotal = visiblePitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);

         return (
            <tr key={`${playerScore.playerId}-${isGhostRow ? 'ghost' : 'norm'}`} className="hover:bg-slate-50/50">
                <td className="px-2 sm:px-4 py-3 font-medium text-slate-700 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-100 w-[100px] sm:w-auto max-w-[120px]">
                    <div className="flex items-center gap-2">
                        <span className={`text-[9px] sm:text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isGhostRow ? 'bg-slate-200 text-slate-500' : 'bg-slate-100 text-slate-400'}`}>
                            {isGhostRow ? '3' : lineupIdx + 1}
                        </span>
                        <span className="truncate text-xs sm:text-sm">
                            {isGhostRow ? <span className="italic text-slate-400">Player 3</span> : (player ? player.name : 'Unknown')}
                        </span>
                    </div>
                </td>
                <td className="px-2 py-3">
                    <div className="flex gap-1 sm:gap-2 justify-start">
                        {visiblePitches.map((pitch: any, idx: number) => {
                            const realPitchIdx = pitchStartIndex + idx;
                            // For Ghost Row: 
                            // Pitches 1-5 are visual 1-5.
                            // Pitches 6-10 are visual 6-10.
                            const displayNum = isGhostRow ? idx + 1 : realPitchIdx + 1;
                            
                            return (
                                <ScoreInput 
                                    key={realPitchIdx} 
                                    pitchNumber={displayNum} 
                                    value={pitch.points} 
                                    readOnly={isReadOnly || match.isComplete} 
                                    isEditing={activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === realPitchIdx} 
                                    onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: realPitchIdx })} 
                                    onClose={() => setActiveCell(null)} 
                                    onChange={(val) => handleScoreUpdate(side, lineupIdx, realPitchIdx, val)} 
                                />
                            );
                        })}
                    </div>
                </td>
                {!isGhostRow && (
                    <td className="px-3 py-3 text-center align-middle border-l border-slate-100 bg-slate-50/30">
                        <div className="text-base font-mono font-bold text-slate-800 w-8">{rowTotal}</div>
                    </td>
                )}
            </tr>
         );
    };

    return (
      <div className="mb-8">
        <div className={`p-3 rounded-t-lg border-b border-slate-200 flex justify-between items-end ${teamColor}`}>
          <div className="flex items-center gap-3">
             <div>
                <span className="text-xs font-bold uppercase opacity-60 tracking-wider">{side === 'home' ? 'Home' : 'Away'}</span>
                <h3 className="text-xl font-bold leading-none">{team.name}</h3>
             </div>
             {canRestore && (
                 <button onClick={() => handleRestoreRoster(side)} className="bg-white/80 hover:bg-white text-slate-600 px-2 py-1 rounded text-[10px] font-bold border border-slate-200 shadow-sm transition-colors animate-pulse">
                    + Player Arrived? (Reset)
                 </button>
             )}
          </div>
          <div className="text-2xl font-mono font-bold">{calculateTeamInningTotal(side, currentInning)} <span className="text-sm font-normal opacity-60">pts</span></div>
        </div>
        <div className="bg-white rounded-b-lg shadow-sm border border-slate-200 overflow-x-auto scrollbar-hide">
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {isTwoPlayerMode ? (
                  <>
                    {/* Render Player 1 & 2 (First 10 pitches only) */}
                    {inningData.playerScores.map((playerScore, lineupIdx) => {
                         const player = team.players.find(p => p.id === playerScore.playerId);
                         return renderRow(playerScore, lineupIdx, player, 0, 10, false);
                    })}
                    {/* Render Ghost Player Row (Aggregating the last 5 pitches from both players) */}
                    <tr className="hover:bg-slate-50/50 bg-slate-50/30">
                        <td className="px-2 sm:px-4 py-3 font-medium text-slate-700 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-100 w-[100px] sm:w-auto max-w-[120px]">
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] sm:text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-200 text-slate-500">3</span>
                                <span className="truncate text-xs sm:text-sm italic text-slate-400">Player 3</span>
                            </div>
                        </td>
                        <td className="px-2 py-3">
                            <div className="flex items-center gap-1 sm:gap-2 justify-start">
                                {/* Ghost Slots 1-5: Mapped to Player 1 (Index 0), Pitches 11-15 (Indices 10-14) */}
                                {inningData.playerScores[0].pitches.slice(10, 15).map((pitch, idx) => {
                                    const realPitchIdx = 10 + idx;
                                    return (
                                        <ScoreInput 
                                            key={`p1-${realPitchIdx}`} 
                                            pitchNumber={realPitchIdx + 1} // Display as 11, 12, 13, 14, 15
                                            value={pitch.points} 
                                            readOnly={isReadOnly || match.isComplete} 
                                            isEditing={activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === realPitchIdx} 
                                            onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: realPitchIdx })} 
                                            onClose={() => setActiveCell(null)} 
                                            onChange={(val) => handleScoreUpdate(side, 0, realPitchIdx, val)} 
                                        />
                                    );
                                })}
                                
                                {/* Visual Separator */}
                                <div className="w-px h-8 bg-slate-300 mx-1"></div>

                                {/* Ghost Slots 6-10: Mapped to Player 2 (Index 1), Pitches 11-15 (Indices 10-14) */}
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch, idx) => {
                                    const realPitchIdx = 10 + idx;
                                    return (
                                        <ScoreInput 
                                            key={`p2-${realPitchIdx}`} 
                                            pitchNumber={realPitchIdx + 1} // Display as 11, 12, 13, 14, 15
                                            value={pitch.points} 
                                            readOnly={isReadOnly || match.isComplete} 
                                            isEditing={activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === realPitchIdx} 
                                            onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: realPitchIdx })} 
                                            onClose={() => setActiveCell(null)} 
                                            onChange={(val) => handleScoreUpdate(side, 1, realPitchIdx, val)} 
                                        />
                                    );
                                })}
                            </div>
                        </td>
                        <td className="px-3 py-3 text-center align-middle border-l border-slate-100 bg-slate-50/30">
                             {/* Calculate total for ghost row: P1(10-14) + P2(10-14) */}
                             <div className="text-base font-mono font-bold text-slate-800 w-8">
                                 {
                                     inningData.playerScores[0].pitches.slice(10, 15).reduce((sum, p) => sum + (p.points || 0), 0) +
                                     inningData.playerScores[1].pitches.slice(10, 15).reduce((sum, p) => sum + (p.points || 0), 0)
                                 }
                             </div>
                        </td>
                    </tr>
                  </>
              ) : (
                  // Standard 3+ Player Mode
                  inningData.playerScores.map((playerScore, lineupIdx) => {
                     const player = team.players.find(p => p.id === playerScore.playerId);
                     return renderRow(playerScore, lineupIdx, player, 0, 10, false);
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-20">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center gap-4">
          <div className="flex gap-4 sm:gap-8 items-center flex-1 overflow-hidden">
            <div className="text-center"><div className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold">Away</div><div className="text-lg sm:text-xl font-bold text-red-700 truncate max-w-[100px]">{teams.away.name}</div><div className="text-xl sm:text-2xl font-mono leading-none">{awayTotal}</div></div>
            <div className="text-slate-300 text-xl font-light">vs</div>
            <div className="text-center"><div className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold">Home</div><div className="text-lg sm:text-xl font-bold text-blue-700 truncate max-w-[100px]">{teams.home.name}</div><div className="text-xl sm:text-2xl font-mono leading-none">{homeTotal}</div></div>
          </div>
          <div className="flex items-center gap-2">
            {isReadOnly && <div className="flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider animate-pulse"><span className="w-2 h-2 rounded-full bg-red-600"></span>LIVE</div>}

            {!isReadOnly && !match.isComplete && <button onClick={() => setShowFinishModal(true)} className="bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm font-bold py-2 px-3 sm:px-4 rounded-lg shadow-sm transition-colors">Complete Game</button>}
            <button onClick={onExit} className="text-xs sm:text-sm font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 py-2 px-3 rounded-lg transition-colors">Exit</button>
          </div>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide border-t border-slate-100">{match.innings.map((ing, idx) => (<button key={ing.number} onClick={() => setActiveInningIdx(idx)} className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors min-w-[80px] ${idx === activeInningIdx ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>Inning {ing.number}</button>))}</div>
      </header>
      <main className="max-w-5xl mx-auto p-4 mt-4">{renderTeamSection('away', teams.away)}{renderTeamSection('home', teams.home)}</main>
      {showFinishModal && !isReadOnly && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-[90%] transform scale-100 animate-in zoom-in-95 duration-200">
                <div className="mb-4 text-center"><h3 className="text-xl font-bold text-slate-800">Finalize Game?</h3><p className="text-slate-500 mt-2 text-sm">Are you sure you want to finalize this game?</p></div>
                <div className="grid grid-cols-2 gap-3"><button onClick={() => setShowFinishModal(false)} className="py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">No</button><button onClick={confirmCompleteGame} className="py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg shadow-green-200 transition-colors">Yes, Finalize</button></div>
            </div>
        </div>
      )}
    </div>
  );
};