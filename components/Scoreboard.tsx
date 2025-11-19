
import React, { useState, useEffect } from 'react';
import { Match, Inning, Team, TieBreakerRound } from '../types';
import * as storage from '../services/storageService';
import { ScoreInput } from './ScoreInput';

interface ScoreboardProps {
  matchId: string;
  onExit: () => void;
  isReadOnly?: boolean;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ matchId, onExit, isReadOnly = false }) => {
  const [match, setMatch] = useState<Match | null>(null);
  const [teams, setTeams] = useState<{ home?: Team, away?: Team }>({});
  const [activeInningIdx, setActiveInningIdx] = useState(0);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; } | null>(null);

  // Tie Breaker State
  const [showTieBreaker, setShowTieBreaker] = useState(false);
  const [tieBreakerRound, setTieBreakerRound] = useState<TieBreakerRound | null>(null);

  const loadMatchData = async () => {
      const m = await storage.getMatch(matchId);
      if (m) {
        const allTeams = await storage.getAllTeams();
        setMatch(m);
        setTeams({ home: allTeams.find(t => t.id === m.homeTeamId), away: allTeams.find(t => t.id === m.awayTeamId) });
      }
  };

  useEffect(() => {
    const init = async () => {
        setLoading(true);
        await loadMatchData();
        setLoading(false);
    };
    init();
  }, [matchId]);

  useEffect(() => {
      if (!isReadOnly) return;
      const interval = setInterval(() => { loadMatchData(); }, 5000);
      return () => clearInterval(interval);
  }, [matchId, isReadOnly]);

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400 font-bold">Loading Match Data...</div>;
  if (!match || !teams.home || !teams.away) return <div className="text-center p-8">Error loading match</div>;

  const currentInning = match.innings[activeInningIdx];

  const calculateTeamInningTotal = (side: 'home' | 'away', inning: Inning) => {
    const teamData = side === 'home' ? inning.home : inning.away;
    return teamData.playerScores.reduce((sum, player) => sum + player.pitches.reduce((pSum, pitch) => pSum + (pitch.points || 0), 0), 0);
  };

  const calculateTeamGameTotal = (side: 'home' | 'away', matchData: Match = match) => {
    const baseScore = matchData.innings.reduce((sum, inning) => sum + calculateTeamInningTotal(side, inning), 0);
    // Add Tie Breaker scores if any
    let tieScore = 0;
    if (matchData.tieBreaker) {
        matchData.tieBreaker.forEach(round => {
            const scores = side === 'home' ? round.homeScores : round.awayScores;
            tieScore += scores.reduce((a, b) => a + b, 0);
        });
    }
    return baseScore + tieScore;
  };

  const homeTotal = calculateTeamGameTotal('home');
  const awayTotal = calculateTeamGameTotal('away');

  const initiateTieBreaker = () => {
      if (!teams.home || !teams.away) return;

      setTieBreakerRound({
          roundNumber: (match.tieBreaker?.length || 0) + 1,
          pitchLimit: 5,
          homePlayerId: teams.home.players[0].id,
          awayPlayerId: teams.away.players[0].id,
          homeScores: Array(5).fill(0), 
          awayScores: Array(5).fill(0)
      });
      setShowTieBreaker(true);
  };

  const handleScoreUpdate = async (side: 'home' | 'away', lineupIdx: number, pitchIdx: number, val: number) => {
    if (isReadOnly) return;

    const existingValue = match.innings[activeInningIdx][side].playerScores[lineupIdx].pitches[pitchIdx].points;
    const isEdit = existingValue !== null;

    const newMatch = { ...match };
    const inning = newMatch.innings[activeInningIdx];
    const teamData = side === 'home' ? inning.home : inning.away;
    
    teamData.playerScores[lineupIdx].pitches[pitchIdx].points = val;
    setMatch(newMatch); // Optimistic update
    storage.updateMatch(newMatch).catch(err => console.error("Failed to save score", err));

    if (isEdit) {
        setActiveCell(null);
        return;
    }

    // --- AUTO-DETECT END OF REGULATION & TIE ---
    const isFinalInning = activeInningIdx === 5; // 6th Inning (0-5)
    if (isFinalInning && side === 'home') {
        const isLastPlayer = lineupIdx === teamData.playerScores.length - 1;
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        const isLastPitch = pitchIdx === totalPitches - 1;

        if (isLastPlayer && isLastPitch) {
            const newHomeTotal = calculateTeamGameTotal('home', newMatch);
            const newAwayTotal = calculateTeamGameTotal('away', newMatch);
            
            if (newHomeTotal === newAwayTotal) {
                // TIE DETECTED!
                setActiveCell(null);
                setTimeout(() => {
                    initiateTieBreaker();
                }, 500); 
                return;
            }
        }
    }

    // Auto-advance logic
    // 2v2 Detection: Array length 2, 10 pitches (NOT 15)
    // Ghost Detection: Array length 2, 15 pitches
    const isTwoPlayerGhostMode = teamData.playerScores.length === 2 && teamData.playerScores[0].pitches.length >= 15;
    const isStrict2v2 = teamData.playerScores.length === 2 && teamData.playerScores[0].pitches.length === 10;

    if (isTwoPlayerGhostMode) {
        // Ghost Mode Logic
        if (pitchIdx < 14) {
            setActiveCell({ side, lineupIdx, pitchIdx: pitchIdx + 1 });
        } else {
             // End of player turn (15 pitches)
             setActiveCell(null);
        }
    } else {
        // Standard or 2v2 Logic (10 Pitches)
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        if (pitchIdx < totalPitches - 1) {
            setActiveCell({ side, lineupIdx, pitchIdx: pitchIdx + 1 });
        } else {
            setActiveCell(null);
        }
    }
  };

  const confirmCompleteGame = async () => {
    if (isReadOnly) return;
    
    // Double check for Tie (Manually triggered completion)
    if (homeTotal === awayTotal) {
        setShowFinishModal(false);
        initiateTieBreaker();
        return;
    }

    const newMatch = { ...match, isComplete: true };
    setMatch(newMatch);
    await storage.updateMatch(newMatch);
    setShowFinishModal(false);
    onExit();
  };

  // --- TIE BREAKER LOGIC ---
  const handleTieBreakerScore = (side: 'home'|'away', idx: number, val: number) => {
      if(!tieBreakerRound) return;
      const newRound = { ...tieBreakerRound };
      if (side === 'home') newRound.homeScores[idx] = val;
      else newRound.awayScores[idx] = val;
      setTieBreakerRound(newRound);
  };

  const submitTieBreakerRound = async () => {
      if(!tieBreakerRound) return;
      
      const homeSum = tieBreakerRound.homeScores.reduce((a,b)=>a+b,0);
      const awaySum = tieBreakerRound.awayScores.reduce((a,b)=>a+b,0);

      const updatedMatch = { ...match };
      if (!updatedMatch.tieBreaker) updatedMatch.tieBreaker = [];
      
      updatedMatch.tieBreaker.push(tieBreakerRound);
      
      if (homeSum !== awaySum) {
          updatedMatch.isComplete = true;
          setMatch(updatedMatch);
          await storage.updateMatch(updatedMatch);
          setShowTieBreaker(false);
          onExit();
      } else {
          // Still Tied
          let nextLimit = 5;
          if (tieBreakerRound.pitchLimit === 5) nextLimit = 3;
          else nextLimit = 1;

          setMatch(updatedMatch);
          await storage.updateMatch(updatedMatch); 

          setTieBreakerRound({
              roundNumber: tieBreakerRound.roundNumber + 1,
              pitchLimit: nextLimit,
              homePlayerId: teams.home!.players[0].id,
              awayPlayerId: teams.away!.players[0].id,
              homeScores: Array(nextLimit).fill(0),
              awayScores: Array(nextLimit).fill(0)
          });
      }
  };

  const handleRestoreRoster = async (side: 'home' | 'away') => {
    if (isReadOnly) return;
    const team = side === 'home' ? teams.home : teams.away;
    if (!team) return;
    if (confirm(`Player arrived? Reset roster for ${team.name}?`)) {
        setLoading(true);
        try {
            const updatedMatch = await storage.restoreTeamRoster(match.id, team.id, activeInningIdx);
            setMatch(updatedMatch);
        } catch (e) { alert("Failed."); }
        setLoading(false);
    }
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const teamColor = side === 'home' ? 'text-blue-800 bg-blue-50' : 'text-red-800 bg-red-50';
    
    const isTwoPlayerGhostMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;
    const isShortHanded = inningData.playerScores.length < team.players.length;
    const canRestore = !isReadOnly && isShortHanded && activeInningIdx >= 1;

    const renderRow = (playerScore: any, lineupIdx: number, player: any, pitchStartIndex: number, pitchEndIndex: number, isGhostRow = false) => {
         const visiblePitches = playerScore.pitches.slice(pitchStartIndex, pitchEndIndex);
         const rowTotal = visiblePitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
         
         const pitchesTaken = visiblePitches.filter((p:any) => p.points !== null).length;
         const pitchesLeft = visiblePitches.length - pitchesTaken;

         return (
            <tr key={`${playerScore.playerId}-${isGhostRow ? 'ghost' : 'norm'}`} className="hover:bg-slate-50/50">
                <td className="px-2 sm:px-4 py-3 font-medium text-slate-700 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-100 w-[100px] sm:w-auto max-w-[120px]">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                        <div className="flex items-center gap-2">
                            <span className={`text-[9px] sm:text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isGhostRow ? 'bg-slate-200 text-slate-500' : 'bg-slate-100 text-slate-400'}`}>
                                {isGhostRow ? '3' : lineupIdx + 1}
                            </span>
                            <span className="truncate text-xs sm:text-sm">
                                {isGhostRow ? <span className="italic text-slate-400">Player 3</span> : (player ? player.name : 'Unknown')}
                            </span>
                        </div>
                        {/* Removed Pitches Left from here, moving to Modal */}
                    </div>
                </td>
                <td className="px-2 py-3">
                    <div className="flex gap-1 sm:gap-2 justify-start">
                        {visiblePitches.map((pitch: any, idx: number) => {
                            const realPitchIdx = pitchStartIndex + idx;
                            const displayNum = isGhostRow ? pitchStartIndex + idx + 1 : realPitchIdx + 1;
                            
                            return (
                                <ScoreInput 
                                    key={realPitchIdx} 
                                    pitchNumber={displayNum} 
                                    value={pitch.points} 
                                    pitchesRemaining={pitchesLeft}
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
             {canRestore && <button onClick={() => handleRestoreRoster(side)} className="bg-white/80 hover:bg-white text-slate-600 px-2 py-1 rounded text-[10px] font-bold border border-slate-200 shadow-sm animate-pulse">+ Reset Roster</button>}
          </div>
          <div className="text-2xl font-mono font-bold">{calculateTeamInningTotal(side, currentInning)} <span className="text-sm font-normal opacity-60">pts</span></div>
        </div>
        <div className="bg-white rounded-b-lg shadow-sm border border-slate-200 overflow-x-auto scrollbar-hide">
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {isTwoPlayerGhostMode ? (
                  <>
                    {inningData.playerScores.map((playerScore, lineupIdx) => {
                         const player = team.players.find(p => p.id === playerScore.playerId);
                         return renderRow(playerScore, lineupIdx, player, 0, 10, false);
                    })}
                    <tr className="hover:bg-slate-50/50 bg-slate-50/30">
                        <td className="px-2 sm:px-4 py-3 font-medium text-slate-700 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-100 w-[100px] sm:w-auto max-w-[120px]">
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] sm:text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-200 text-slate-500">3</span>
                                <span className="truncate text-xs sm:text-sm italic text-slate-400">Player 3</span>
                            </div>
                        </td>
                        <td className="px-2 py-3">
                            <div className="flex items-center gap-1 sm:gap-2 justify-start">
                                {inningData.playerScores[0].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput 
                                        key={`p1-${10+idx}`} pitchNumber={11+idx} value={pitch.points} readOnly={isReadOnly || match.isComplete} 
                                        isEditing={activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === 10+idx} 
                                        onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, 0, 10+idx, val)} 
                                    />
                                ))}
                                <div className="w-px h-8 bg-slate-300 mx-1"></div>
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput 
                                        key={`p2-${10+idx}`} pitchNumber={11+idx} value={pitch.points} readOnly={isReadOnly || match.isComplete} 
                                        isEditing={activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === 10+idx} 
                                        onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, 1, 10+idx, val)} 
                                    />
                                ))}
                            </div>
                        </td>
                        <td className="px-3 py-3 text-center align-middle border-l border-slate-100 bg-slate-50/30">
                             <div className="text-base font-mono font-bold text-slate-800 w-8">
                                 {inningData.playerScores[0].pitches.slice(10, 15).reduce((s,p)=>s+(p.points||0),0) + inningData.playerScores[1].pitches.slice(10, 15).reduce((s,p)=>s+(p.points||0),0)}
                             </div>
                        </td>
                    </tr>
                  </>
              ) : (
                  inningData.playerScores.map((playerScore, lineupIdx) => {
                     const player = team.players.find(p => p.id === playerScore.playerId);
                     return renderRow(playerScore, lineupIdx, player, 0, playerScore.pitches.length, false);
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
      <main className="max-w-5xl mx-auto p-4 mt-4">
          {renderTeamSection('away', teams.away)}
          {renderTeamSection('home', teams.home)}
          
          {match.tieBreaker && match.tieBreaker.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-4">
                  <h3 className="font-bold text-amber-800 mb-2">Showdown Results</h3>
                  {match.tieBreaker.map((tb, idx) => (
                      <div key={idx} className="text-sm text-amber-900 flex justify-between border-b border-amber-200 last:border-0 py-1">
                          <span>Round {tb.roundNumber} ({tb.pitchLimit} Pitches)</span>
                          <span className="font-mono font-bold">Away {tb.awayScores.reduce((a,b)=>a+b,0)} - {tb.homeScores.reduce((a,b)=>a+b,0)} Home</span>
                      </div>
                  ))}
              </div>
          )}
      </main>

      {showFinishModal && !isReadOnly && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-[90%] transform scale-100 animate-in zoom-in-95 duration-200">
                <div className="mb-4 text-center"><h3 className="text-xl font-bold text-slate-800">Finalize Game?</h3><p className="text-slate-500 mt-2 text-sm">Are you sure you want to finalize this game?</p></div>
                <div className="grid grid-cols-2 gap-3"><button onClick={() => setShowFinishModal(false)} className="py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">No</button><button onClick={confirmCompleteGame} className="py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg shadow-green-200 transition-colors">Yes, Finalize</button></div>
            </div>
        </div>
      )}

      {showTieBreaker && tieBreakerRound && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
             <div className="bg-white p-4 sm:p-8 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                 <div className="text-center mb-6">
                     <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight">TIED GAME!</h2>
                     <h3 className="text-xl font-bold text-blue-600 mt-1">SHOWDOWN: Round {tieBreakerRound.roundNumber}</h3>
                     <p className="text-slate-500 text-sm mt-2">Select one player from each team to hit {tieBreakerRound.pitchLimit} pitch{tieBreakerRound.pitchLimit > 1 ? 'es' : ''}.</p>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                         <h4 className="font-bold text-red-800 mb-3">{teams.away?.name} Shooter</h4>
                         <select 
                            className="w-full p-2 mb-4 rounded border border-red-200 text-sm" 
                            value={tieBreakerRound.awayPlayerId}
                            onChange={(e) => setTieBreakerRound({...tieBreakerRound, awayPlayerId: e.target.value})}
                         >
                             {teams.away?.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                         </select>
                         <div className="flex flex-wrap gap-2 justify-center">
                             {tieBreakerRound.awayScores.map((score, idx) => (
                                 <ScoreInput 
                                     key={idx} 
                                     pitchNumber={idx + 1} 
                                     value={score} 
                                     isEditing={true}
                                     readOnly={false}
                                     onOpen={() => {}} 
                                     onClose={() => {}} 
                                     onChange={(val) => handleTieBreakerScore('away', idx, val)} 
                                 />
                             ))}
                         </div>
                         <div className="text-center mt-4 text-2xl font-mono font-bold text-red-800">
                             Total: {tieBreakerRound.awayScores.reduce((a,b)=>a+b,0)}
                         </div>
                     </div>

                     <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                         <h4 className="font-bold text-blue-800 mb-3">{teams.home?.name} Shooter</h4>
                         <select 
                            className="w-full p-2 mb-4 rounded border border-blue-200 text-sm" 
                            value={tieBreakerRound.homePlayerId}
                            onChange={(e) => setTieBreakerRound({...tieBreakerRound, homePlayerId: e.target.value})}
                         >
                             {teams.home?.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                         </select>
                         <div className="flex flex-wrap gap-2 justify-center">
                             {tieBreakerRound.homeScores.map((score, idx) => (
                                 <ScoreInput 
                                     key={idx} 
                                     pitchNumber={idx + 1} 
                                     value={score} 
                                     isEditing={true} 
                                     readOnly={false}
                                     onOpen={() => {}} 
                                     onClose={() => {}} 
                                     onChange={(val) => handleTieBreakerScore('home', idx, val)} 
                                 />
                             ))}
                         </div>
                         <div className="text-center mt-4 text-2xl font-mono font-bold text-blue-800">
                             Total: {tieBreakerRound.homeScores.reduce((a,b)=>a+b,0)}
                         </div>
                     </div>
                 </div>
                 
                 <button onClick={submitTieBreakerRound} className="w-full mt-8 py-4 bg-slate-900 text-white font-bold rounded-xl text-lg hover:bg-slate-800 shadow-xl transition-transform active:scale-[0.98]">
                     Submit Round Results
                 </button>
             </div>
          </div>
      )}
    </div>
  );
};
