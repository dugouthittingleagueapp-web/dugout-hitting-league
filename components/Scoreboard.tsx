
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
  const [activeInningIdx, setActiveInningIdx] = useState(0); // 0-5 = Innings 1-6, 6 = Extra Innings
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Track active cell for scoring modal. 
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number } | null>(null);

  // Tie Breaker Setup State
  const [showTieBreakerSetup, setShowTieBreakerSetup] = useState(false);
  const [tbHomePlayerId, setTbHomePlayerId] = useState('');
  const [tbAwayPlayerId, setTbAwayPlayerId] = useState('');

  // Loading
  const loadMatchData = async () => {
      const m = await storage.getMatch(matchId);
      if (m) {
        const allTeams = await storage.getAllTeams();
        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        setMatch(m);
        setTeams({ home, away });
        
        // Default selection for Tie Breaker dropdowns
        if (home && !tbHomePlayerId && home.players.length > 0) setTbHomePlayerId(home.players[0].id);
        if (away && !tbAwayPlayerId && away.players.length > 0) setTbAwayPlayerId(away.players[0].id);
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

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400 font-bold font-sans">Loading Match Data...</div>;
  if (!match || !teams.home || !teams.away) return <div className="text-center p-8 font-sans">Error loading match</div>;

  const currentInning = match.innings[activeInningIdx];
  const isExtraInnings = activeInningIdx === 6;

  // --- Calculations ---

  const calculateTeamInningTotal = (side: 'home' | 'away', inning: Inning) => {
    const teamData = side === 'home' ? inning.home : inning.away;
    return teamData.playerScores.reduce((sum, player) => sum + player.pitches.reduce((pSum, pitch) => pSum + (pitch.points || 0), 0), 0);
  };

  const calculateTeamGameTotal = (side: 'home' | 'away', matchData: Match = match) => {
    const baseScore = matchData.innings.reduce((sum, inning) => sum + calculateTeamInningTotal(side, inning), 0);
    let tieScore = 0;
    if (matchData.tieBreaker) {
        matchData.tieBreaker.forEach(round => {
            const scores = side === 'home' ? round.homeScores : round.awayScores;
            tieScore += scores.reduce((a, b) => (a || 0) + (b || 0), 0);
        });
    }
    return baseScore + tieScore;
  };

  const homeTotal = calculateTeamGameTotal('home');
  const awayTotal = calculateTeamGameTotal('away');

  // --- Actions ---

  const startTieBreakerRound = async () => {
      if (!teams.home || !teams.away || !tbHomePlayerId || !tbAwayPlayerId) return;

      let nextLimit = 5;
      let roundNum = 1;
      
      if (match.tieBreaker && match.tieBreaker.length > 0) {
          const lastRound = match.tieBreaker[match.tieBreaker.length - 1];
          roundNum = lastRound.roundNumber + 1;
          if (lastRound.pitchLimit === 5) nextLimit = 3;
          else nextLimit = 1;
      }

      const newRound: TieBreakerRound = {
          roundNumber: roundNum,
          pitchLimit: nextLimit,
          homePlayerId: tbHomePlayerId,
          awayPlayerId: tbAwayPlayerId,
          homeScores: Array(nextLimit).fill(null),
          awayScores: Array(nextLimit).fill(null)
      };

      const updatedMatch = { ...match };
      if (!updatedMatch.tieBreaker) updatedMatch.tieBreaker = [];
      updatedMatch.tieBreaker.push(newRound);
      updatedMatch.isComplete = false;

      setMatch(updatedMatch);
      await storage.updateMatch(updatedMatch);
      
      setShowTieBreakerSetup(false);
      setActiveInningIdx(6); // Go to Extra Innings tab
  };

  const handleUndo = async (side: 'home' | 'away', lineupIdx: number, currentPitchIdx: number, roundIdx?: number) => {
      const prevPitchIdx = currentPitchIdx - 1;
      if (prevPitchIdx < 0) return;

      const newMatch = { ...match };
      
      if (roundIdx !== undefined && newMatch.tieBreaker) {
          // Tie Breaker
          const round = newMatch.tieBreaker[roundIdx];
          if (side === 'home') round.homeScores[prevPitchIdx] = null;
          else round.awayScores[prevPitchIdx] = null;
          setActiveCell({ side, lineupIdx: 0, pitchIdx: prevPitchIdx, roundIdx });
      } else {
          // Regular Inning
          const inning = newMatch.innings[activeInningIdx];
          const teamData = side === 'home' ? inning.home : inning.away;
          teamData.playerScores[lineupIdx].pitches[prevPitchIdx].points = null;
          setActiveCell({ side, lineupIdx, pitchIdx: prevPitchIdx });
      }
      
      setMatch(newMatch);
      await storage.updateMatch(newMatch).catch(err => console.error("Undo failed", err));
  };

  const handleScoreUpdate = async (side: 'home' | 'away', lineupIdx: number, pitchIdx: number, val: number) => {
    if (isReadOnly) return;
    
    // Optimistic Update for UI Snappiness
    const existingValue = match.innings[activeInningIdx][side].playerScores[lineupIdx].pitches[pitchIdx].points;
    const isEdit = existingValue !== null;

    const newMatch = { ...match };
    const inning = newMatch.innings[activeInningIdx];
    const teamData = side === 'home' ? inning.home : inning.away;
    
    teamData.playerScores[lineupIdx].pitches[pitchIdx].points = val;
    setMatch(newMatch); 
    
    // --- Auto-detect End of Regulation ---
    const isFinalInning = activeInningIdx === 5; 
    let shouldOpenTieBreaker = false;

    if (isFinalInning && side === 'home') {
        const isLastPlayer = lineupIdx === teamData.playerScores.length - 1;
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        const isLastPitch = pitchIdx === totalPitches - 1;

        if (isLastPlayer && isLastPitch) {
            const newHomeTotal = calculateTeamGameTotal('home', newMatch);
            const newAwayTotal = calculateTeamGameTotal('away', newMatch);
            if (newHomeTotal === newAwayTotal) {
                shouldOpenTieBreaker = true;
            }
        }
    }

    // --- Auto-advance logic ---
    let nextCell = null;

    if (!isEdit && !shouldOpenTieBreaker) {
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        // If there are pitches left for THIS player, advance.
        if (pitchIdx < totalPitches - 1) {
            nextCell = { side, lineupIdx, pitchIdx: pitchIdx + 1 };
        } else {
            // We have reached the end of pitches for this player.
            nextCell = null;
        }
    }

    // Apply next cell immediately
    setActiveCell(nextCell);

    if (shouldOpenTieBreaker) {
         setTimeout(() => setShowTieBreakerSetup(true), 500);
    }

    await storage.updateMatch(newMatch).catch(err => {
        console.error("Failed to save score", err);
    });
  };

  const confirmCompleteGame = async () => {
    if (isReadOnly) return;
    
    if (homeTotal === awayTotal) {
        setShowFinishModal(false);
        setShowTieBreakerSetup(true);
        return;
    }

    const newMatch = { ...match, isComplete: true };
    setMatch(newMatch);
    await storage.updateMatch(newMatch);
    setShowFinishModal(false);
    onExit();
  };

  // --- Tie Breaker Logic ---

  const handleTieBreakerScore = async (roundIdx: number, side: 'home'|'away', pitchIdx: number, val: number) => {
      if(!match.tieBreaker) return;
      
      const currentRound = match.tieBreaker[roundIdx];
      const limit = currentRound.pitchLimit;
      
      const newMatch = { ...match };
      const round = newMatch.tieBreaker![roundIdx];
      
      const existingVal = side === 'home' ? round.homeScores[pitchIdx] : round.awayScores[pitchIdx];
      const isEdit = existingVal !== null;

      if (side === 'home') round.homeScores[pitchIdx] = val;
      else round.awayScores[pitchIdx] = val;
      
      setMatch(newMatch); // Optimistic UI update
      
      let nextCell = null;
      if (!isEdit && pitchIdx < limit - 1) {
           nextCell = { side, lineupIdx: 0, pitchIdx: pitchIdx + 1, roundIdx };
      }
      
      setActiveCell(nextCell);

      await storage.updateMatch(newMatch);
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

  // --- Rendering ---

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    
    const headerClass = side === 'home' 
        ? 'bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900' 
        : 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 border-red-200 dark:border-red-900';
    
    const isTwoPlayerGhostMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;
    const isShortHanded = inningData.playerScores.length < team.players.length;
    const canRestore = !isReadOnly && isShortHanded && activeInningIdx >= 1;

    const renderRow = (playerScore: any, lineupIdx: number, player: any, pitchStartIndex: number, pitchEndIndex: number, isGhostRow = false) => {
         const visiblePitches = playerScore.pitches.slice(pitchStartIndex, pitchEndIndex);
         const rowTotal = visiblePitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
         
         let pitchesLeft = 0;
         if (isTwoPlayerGhostMode) {
             const allPitches = playerScore.pitches; 
             const taken = allPitches.filter((p:any) => p.points !== null).length;
             pitchesLeft = 15 - taken;
         } else {
             const taken = playerScore.pitches.filter((p:any) => p.points !== null).length;
             pitchesLeft = playerScore.pitches.length - taken;
         }

         return (
            <tr key={`${playerScore.playerId}-${isGhostRow ? 'ghost' : 'norm'}`} className="hover:bg-slate-50/50 dark:hover:bg-white/5 border-b border-slate-100 dark:border-slate-800">
                <td className="px-2 py-2 sm:py-3 font-medium text-slate-700 dark:text-slate-200 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[100px] sm:w-auto max-w-[120px]">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                        <div className="flex items-center gap-2 w-full">
                            <span className={`text-[9px] sm:text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-sans ${isGhostRow ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-400'}`}>
                                {isGhostRow ? '3' : lineupIdx + 1}
                            </span>
                            <span className="truncate text-xs sm:text-sm font-sans text-slate-900 dark:text-slate-100 font-bold block flex-1">
                                {isGhostRow ? <span className="italic text-slate-400">Ghost</span> : (player ? player.name : 'Unknown')}
                            </span>
                        </div>
                    </div>
                </td>
                <td className="px-1 sm:px-2 py-2 sm:py-3">
                    <div className="flex gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1">
                        {visiblePitches.map((pitch: any, idx: number) => {
                            const realPitchIdx = pitchStartIndex + idx;
                            const displayNum = isGhostRow ? pitchStartIndex + idx + 1 : realPitchIdx + 1;
                            const isEditing = activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === realPitchIdx;
                            
                            return (
                                <ScoreInput 
                                    key={realPitchIdx} 
                                    pitchNumber={displayNum} 
                                    value={pitch.points} 
                                    pitchesRemaining={pitchesLeft}
                                    readOnly={isReadOnly || match.isComplete} 
                                    isEditing={isEditing} 
                                    onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: realPitchIdx })} 
                                    onClose={() => setActiveCell(null)} 
                                    onChange={(val) => handleScoreUpdate(side, lineupIdx, realPitchIdx, val)} 
                                    onUndo={realPitchIdx > 0 ? () => handleUndo(side, lineupIdx, realPitchIdx) : undefined}
                                />
                            );
                        })}
                    </div>
                </td>
                {!isGhostRow && (
                    <td className="px-2 sm:px-3 py-3 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/30">
                        <div className="text-base font-sans font-bold tabular-nums text-slate-800 dark:text-white w-8">{rowTotal}</div>
                    </td>
                )}
            </tr>
         );
    };

    return (
      <div className="mb-8">
        <div className={`p-3 rounded-t-lg border-b flex justify-between items-end shadow-sm ${headerClass}`}>
          <div className="flex items-center gap-3">
             <div>
                <span className="text-xs font-bold uppercase opacity-80 tracking-wider font-sans">{side === 'home' ? 'Home' : 'Away'}</span>
                <h3 className="text-xl font-black leading-none font-sans truncate max-w-[150px] sm:max-w-none">{team.name}</h3>
             </div>
             {canRestore && <button onClick={() => handleRestoreRoster(side)} className="bg-white/80 dark:bg-slate-800 hover:bg-white text-slate-600 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-700 shadow-sm animate-pulse font-sans">+ Reset Roster</button>}
          </div>
          <div className="text-2xl font-sans tabular-nums font-bold">{calculateTeamInningTotal(side, currentInning)} <span className="text-sm font-normal opacity-60 font-sans">pts</span></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-b-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-hide relative">
          <table className="w-full border-collapse">
            <tbody>
              {isTwoPlayerGhostMode ? (
                  <>
                    {renderRow(inningData.playerScores[0], 0, team.players.find(p=>p.id===inningData.playerScores[0].playerId), 0, 10, false)}
                    {renderRow(inningData.playerScores[1], 1, team.players.find(p=>p.id===inningData.playerScores[1].playerId), 0, 10, false)}
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 bg-slate-50/30 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700">
                        <td className="px-2 py-3 font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[100px] sm:w-auto max-w-[120px]">
                            <div className="flex items-center gap-2 w-full">
                                <span className="text-[9px] sm:text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-sans">3</span>
                                <span className="truncate text-xs sm:text-sm italic text-slate-400 dark:text-slate-500 font-sans flex-1">Ghost</span>
                            </div>
                        </td>
                        <td className="px-1 sm:px-2 py-3">
                            <div className="flex items-center gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1">
                                {inningData.playerScores[0].pitches.slice(10, 15).map((pitch, idx) => {
                                    const taken = inningData.playerScores[0].pitches.filter((p:any) => p.points !== null).length;
                                    const left = 15 - taken;
                                    const realPitchIdx = 10 + idx;
                                    const isEditing = activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === realPitchIdx;
                                    return (
                                    <ScoreInput 
                                        key={`p1-${realPitchIdx}`} pitchNumber={11+idx} value={pitch.points} 
                                        pitchesRemaining={left}
                                        readOnly={isReadOnly || match.isComplete} 
                                        isEditing={isEditing} 
                                        onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: realPitchIdx })} onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, 0, realPitchIdx, val)} 
                                        onUndo={realPitchIdx > 0 ? () => handleUndo(side, 0, realPitchIdx) : undefined}
                                    />
                                    );
                                })}
                                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch, idx) => {
                                    const taken = inningData.playerScores[1].pitches.filter((p:any) => p.points !== null).length;
                                    const left = 15 - taken;
                                    const realPitchIdx = 10 + idx;
                                    const isEditing = activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === realPitchIdx;
                                    return (
                                    <ScoreInput 
                                        key={`p2-${realPitchIdx}`} pitchNumber={11+idx} value={pitch.points} 
                                        pitchesRemaining={left}
                                        readOnly={isReadOnly || match.isComplete} 
                                        isEditing={isEditing} 
                                        onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: realPitchIdx })} onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, 1, realPitchIdx, val)} 
                                        onUndo={realPitchIdx > 0 ? () => handleUndo(side, 1, realPitchIdx) : undefined}
                                    />
                                    );
                                })}
                            </div>
                        </td>
                        <td className="px-2 sm:px-3 py-3 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30">
                             <div className="text-base font-sans tabular-nums font-bold text-slate-800 dark:text-slate-200 w-8">
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

  // --- Tie Breaker Render ---
  const renderTieBreakerTab = () => {
      if (!match.tieBreaker || match.tieBreaker.length === 0) {
          return <div className="p-8 text-center text-slate-400 font-sans">Extra Innings Data not available.</div>;
      }
      
      return (
          <div className="space-y-8">
              {match.tieBreaker.map((round, idx) => {
                  const isLastRound = idx === match.tieBreaker!.length - 1;
                  const homePlayer = teams.home?.players.find(p => p.id === round.homePlayerId);
                  const awayPlayer = teams.away?.players.find(p => p.id === round.awayPlayerId);
                  
                  const homeSum = round.homeScores.reduce((a,b)=>(a||0)+(b||0),0);
                  const awaySum = round.awayScores.reduce((a,b)=>(a||0)+(b||0),0);
                  
                  return (
                    <div key={idx}>
                         <div className="bg-amber-50 dark:bg-amber-950 p-3 rounded-t-xl border border-amber-200 dark:border-amber-900 flex justify-between items-center">
                             <h3 className="font-bold text-amber-800 dark:text-amber-100 font-sans text-sm sm:text-base">Extra Innings: Round {round.roundNumber} ({round.pitchLimit} Pitches)</h3>
                             {isLastRound && (
                                 homeSum === awaySum ? (
                                    <button onClick={() => startTieBreakerRound()} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs sm:text-sm shadow font-sans">Next Round</button>
                                 ) : (
                                    <button onClick={confirmCompleteGame} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs sm:text-sm shadow font-sans">Finalize Game</button>
                                 )
                             )}
                         </div>
                         <div className="bg-white dark:bg-slate-900 border-x border-b border-slate-200 dark:border-slate-700 rounded-b-xl overflow-hidden overflow-x-auto">
                             <table className="w-full min-w-[300px]">
                                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                     {/* Away Player Row */}
                                     <tr className="bg-red-50/10 dark:bg-red-900/10">
                                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 w-[120px] sm:w-[150px]">
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                                                <span className="text-[10px] font-bold bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300 px-2 py-0.5 rounded font-sans">Away</span>
                                                <span className="font-bold text-sm truncate font-sans text-slate-900 dark:text-slate-100 max-w-[80px] sm:max-w-none">{awayPlayer?.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                                                {round.awayScores.map((score, pIdx) => {
                                                    const isEditing = activeCell?.side === 'away' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pIdx;
                                                    return (
                                                    <ScoreInput 
                                                        key={`ot-away-${idx}-${pIdx}`} pitchNumber={pIdx+1} value={score}
                                                        readOnly={isReadOnly || (!isLastRound && match.isComplete)}
                                                        isEditing={isEditing}
                                                        onOpen={() => setActiveCell({ side: 'away', lineupIdx: 0, pitchIdx: pIdx, roundIdx: idx })}
                                                        onClose={() => setActiveCell(null)}
                                                        onChange={(val) => handleTieBreakerScore(idx, 'away', pIdx, val)}
                                                        onUndo={pIdx > 0 ? () => handleUndo('away', 0, pIdx, idx) : undefined}
                                                    />
                                                    );
                                                })}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-bold text-xl text-center font-sans tabular-nums bg-slate-50/50 dark:bg-slate-800/50 dark:text-white">{awaySum}</td>
                                     </tr>
                                     {/* Home Player Row */}
                                     <tr className="bg-blue-50/10 dark:bg-blue-900/10">
                                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 w-[120px] sm:w-[150px]">
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                                                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded font-sans">Home</span>
                                                <span className="font-bold text-sm truncate font-sans text-slate-900 dark:text-slate-100 max-w-[80px] sm:max-w-none">{homePlayer?.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                                                {round.homeScores.map((score, pIdx) => {
                                                    const isEditing = activeCell?.side === 'home' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pIdx;
                                                    return (
                                                    <ScoreInput 
                                                        key={`ot-home-${idx}-${pIdx}`} pitchNumber={pIdx+1} value={score}
                                                        readOnly={isReadOnly || (!isLastRound && match.isComplete)}
                                                        isEditing={isEditing}
                                                        onOpen={() => setActiveCell({ side: 'home', lineupIdx: 0, pitchIdx: pIdx, roundIdx: idx })}
                                                        onClose={() => setActiveCell(null)}
                                                        onChange={(val) => handleTieBreakerScore(idx, 'home', pIdx, val)}
                                                        onUndo={pIdx > 0 ? () => handleUndo('home', 0, pIdx, idx) : undefined}
                                                    />
                                                    );
                                                })}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-bold text-xl text-center font-sans tabular-nums bg-slate-50/50 dark:bg-slate-800/50 dark:text-white">{homeSum}</td>
                                     </tr>
                                 </tbody>
                             </table>
                         </div>
                    </div>
                  );
              })}
          </div>
      );
  };

  return (
    <div className="min-h-screen bg-transparent pb-20 font-sans">
      <header className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 sticky top-0 z-[50] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center gap-2 sm:gap-4">
          <div className="flex gap-2 sm:gap-8 items-center flex-1 min-w-0">
            <div className="text-center flex-1 min-w-0">
                <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 uppercase font-bold font-sans">Away</div>
                <div className="text-lg sm:text-xl font-bold text-red-700 dark:text-red-400 truncate w-full font-sans px-1">{teams.away.name}</div>
                <div className="text-xl sm:text-2xl font-sans tabular-nums leading-none dark:text-white">{awayTotal}</div>
            </div>
            <div className="text-slate-300 dark:text-slate-600 text-xl font-light font-sans">vs</div>
            <div className="text-center flex-1 min-w-0">
                <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 uppercase font-bold font-sans">Home</div>
                <div className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-400 truncate w-full font-sans px-1">{teams.home.name}</div>
                <div className="text-xl sm:text-2xl font-sans tabular-nums leading-none dark:text-white">{homeTotal}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isReadOnly && <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider animate-pulse font-sans"><span className="w-2 h-2 rounded-full bg-red-600"></span>LIVE</div>}
            {!isReadOnly && !match.isComplete && !isExtraInnings && <button onClick={() => setShowFinishModal(true)} className="bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm font-bold py-2 px-3 sm:px-4 rounded-lg shadow-sm transition-colors font-sans">Complete</button>}
            <button onClick={onExit} className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 py-2 px-3 rounded-lg transition-colors font-sans">Exit</button>
          </div>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide border-t border-slate-100 dark:border-slate-800">
            {match.innings.map((ing, idx) => (
                <button key={ing.number} onClick={() => setActiveInningIdx(idx)} className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors min-w-[80px] font-sans ${idx === activeInningIdx ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'border-transparent text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>Inning {ing.number}</button>
            ))}
            {(match.tieBreaker && match.tieBreaker.length > 0) && (
                <button onClick={() => setActiveInningIdx(6)} className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors min-w-[120px] font-sans ${activeInningIdx === 6 ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-transparent text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10'}`}>Extra Innings</button>
            )}
        </div>
      </header>
      
      <main className="max-w-5xl mx-auto p-2 sm:p-4 mt-2 sm:mt-4">
          {isExtraInnings ? renderTieBreakerTab() : (
              <>
                {renderTeamSection('away', teams.away)}
                {renderTeamSection('home', teams.home)}
              </>
          )}
      </main>

      {/* Tie Breaker Setup Modal */}
      {showTieBreakerSetup && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl shadow-2xl w-[90%] max-w-md font-sans transform scale-100 animate-in zoom-in-95 border border-slate-200 dark:border-slate-700">
                  <h2 className="text-2xl font-black text-amber-600 mb-2 text-center font-sans">TIE GAME!</h2>
                  <p className="text-slate-500 dark:text-slate-400 text-center mb-6 font-sans">Select one player from each team for Extra Innings.</p>
                  
                  <div className="space-y-4 mb-8">
                      <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-1 font-sans">Away Shooter ({teams.away.name})</label>
                          <select className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl font-bold text-slate-800 dark:text-white font-sans" value={tbAwayPlayerId} onChange={e => setTbAwayPlayerId(e.target.value)}>
                              {teams.away.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-1 font-sans">Home Shooter ({teams.home.name})</label>
                          <select className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl font-bold text-slate-800 dark:text-white font-sans" value={tbHomePlayerId} onChange={e => setTbHomePlayerId(e.target.value)}>
                              {teams.home.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                      </div>
                  </div>
                  
                  <button onClick={startTieBreakerRound} className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-widest rounded-xl shadow-lg shadow-amber-200 dark:shadow-none transition-colors font-sans">
                      Start Extra Innings
                  </button>
              </div>
          </div>
      )}

      {showFinishModal && !isReadOnly && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl max-w-sm w-[90%] transform scale-100 animate-in zoom-in-95 duration-200 font-sans border border-slate-200 dark:border-slate-700">
                <div className="mb-4 text-center"><h3 className="text-xl font-bold text-slate-800 dark:text-white font-sans">Finalize Game?</h3><p className="text-slate-500 dark:text-slate-400 mt-2 text-sm font-sans">Are you sure you want to finalize this game?</p></div>
                <div className="grid grid-cols-2 gap-3"><button onClick={() => setShowFinishModal(false)} className="py-3 rounded-xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors font-sans">No</button><button onClick={confirmCompleteGame} className="py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg shadow-green-200 dark:shadow-none transition-colors font-sans">Yes, Finalize</button></div>
            </div>
        </div>
      )}
    </div>
  );
};
