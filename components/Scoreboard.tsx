
import React, { useState } from 'react';
import { Match, Team, Player, Inning, PitchScore, TieBreakerRound, PlayerInningScore } from '../types';
import { ScoreInput } from './ScoreInput';

interface ScoreboardProps {
  match: Match;
  teams: { home: Team; away: Team };
  isReadOnly?: boolean;
  onUpdateScore: (inningIdx: number, teamId: string, playerIdx: number, pitchIdx: number, score: number) => void;
  onUpdateTieBreaker: (roundIdx: number, teamId: string, pitchIdx: number, score: number) => void;
  onCompleteGame: () => void;
  onAddTieBreakerRound: () => void;
  onRestoreRoster: (teamId: string, inningIdx: number) => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  match,
  teams,
  isReadOnly = false,
  onUpdateScore,
  onUpdateTieBreaker,
  onCompleteGame,
  onAddTieBreakerRound,
  onRestoreRoster,
}) => {
  const [activeTab, setActiveTab] = useState<number | 'tiebreaker'>((match.isComplete && match.tieBreaker?.length) ? 'tiebreaker' : 0);
  const [isEditingCompleted, setIsEditingCompleted] = useState(false);
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away', lineupIdx: number, pitchIdx: number, roundIdx?: number } | null>(null);

  const calculateTeamInningTotal = (side: 'home' | 'away', inningIdx: number) => {
    if (!match.innings[inningIdx]) return 0;
    const inning = match.innings[inningIdx];
    const data = side === 'home' ? inning.home : inning.away;
    return data.playerScores.reduce((sum, ps) => 
      sum + ps.pitches.reduce((pSum, p) => pSum + (p.points || 0), 0), 0
    );
  };

  const handleScoreUpdate = (side: 'home' | 'away', lineupIdx: number, pitchIdx: number, val: number) => {
      // In strict typing, we might need to handle nulls, but here we assume the input gives valid scores 0-4
      onUpdateScore(activeTab as number, side === 'home' ? match.homeTeamId : match.awayTeamId, lineupIdx, pitchIdx, val);
      setActiveCell(null);
  };

  const handleTieBreakerScore = (roundIdx: number, side: 'home' | 'away', pitchIdx: number, val: number) => {
      onUpdateTieBreaker(roundIdx, side === 'home' ? match.homeTeamId : match.awayTeamId, pitchIdx, val);
      setActiveCell(null);
  };
  
  const handleUndo = (side: 'home'|'away', lineupIdx: number, currentPitchIdx: number, roundIdx?: number) => {
       // Logic to clear the SPECIFIC pitch index requested (which is usually current - 1)
       // We pass 0 (or we could pass null if API supported it, but 0 clears the score value effectively)
       // Ideally this would be null to show '-', but 0 is acceptable fallback if strict types required
       if(roundIdx !== undefined) {
           // We cast to any to allow passing null if backend supports it, otherwise 0
           onUpdateTieBreaker(roundIdx, side === 'home' ? match.homeTeamId : match.awayTeamId, currentPitchIdx, 0); 
       } else {
           onUpdateScore(activeTab as number, side === 'home' ? match.homeTeamId : match.awayTeamId, lineupIdx, currentPitchIdx, 0);
       }
  };
  
  const confirmCompleteGame = () => {
      if(confirm("Finalize Game? This will lock scores.")) {
          onCompleteGame();
      }
  };

  const startTieBreakerRound = () => {
      onAddTieBreakerRound();
      setActiveTab('tiebreaker');
  };

  const handleRestoreRoster = (side: 'home'|'away') => {
      if(confirm(`Reset roster for ${side === 'home' ? teams.home.name : teams.away.name}? This will restore the original lineup for future innings.`)) {
          onRestoreRoster(side === 'home' ? teams.home.id : teams.away.id, activeTab as number);
      }
  };
  
  // Totals
  const getTotals = () => {
      let h = 0, a = 0;
      match.innings.forEach(i => {
          h += i.home.playerScores.reduce((s, ps) => s + ps.pitches.reduce((p, v) => p + (v.points || 0), 0), 0);
          a += i.away.playerScores.reduce((s, ps) => s + ps.pitches.reduce((p, v) => p + (v.points || 0), 0), 0);
      });
      if(match.tieBreaker) {
          match.tieBreaker.forEach(tb => {
              h += tb.homeScores.reduce((s, v) => s + (v||0), 0);
              a += tb.awayScores.reduce((s, v) => s + (v||0), 0);
          });
      }
      return { homeTotal: h, awayTotal: a };
  };
  
  const { homeTotal, awayTotal } = getTotals();

  const formatName = (p?: Player) => {
      if (!p) return 'Unknown';
      return `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;
  };

  const renderRow = (playerScore: PlayerInningScore, lineupIdx: number, player: Player | undefined, startPitchIdx: number, endPitchIdx: number, isGhost: boolean) => {
     return (
         <tr key={`${playerScore.playerId}-${startPitchIdx}`} className="border-t border-slate-100 dark:border-slate-800">
             <td className="px-0.5 sm:px-2 py-1 sm:py-2 font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto max-w-[120px]">
                 <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                     <span className={`text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 font-sans ${isGhost ? 'bg-slate-200 dark:bg-slate-800 text-slate-500' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'}`}>{lineupIdx + 1}</span>
                     <span className="truncate text-[10px] sm:text-sm font-bold font-sans flex-1" title={formatName(player)}>{formatName(player)}</span>
                 </div>
             </td>
             <td className="px-0.5 sm:px-2 py-1 sm:py-2">
                 <div className="flex items-center gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto">
                    {playerScore.pitches.slice(startPitchIdx, endPitchIdx).map((pitch, idx) => {
                        const realPitchIdx = startPitchIdx + idx;
                        const pitchesTaken = playerScore.pitches.filter(p => p.points !== null).length;
                        const remaining = playerScore.pitches.length - pitchesTaken;
                        
                        // Check if this specific cell is being edited
                        const isEditing = activeCell?.lineupIdx === lineupIdx && activeCell?.pitchIdx === realPitchIdx && 
                                          activeCell?.side === (teams.home.players.some(p=>p.id === playerScore.playerId) || playerScore.playerId.includes(teams.home.id) ? 'home' : 'away'); 
                        
                        return (
                             <ScoreInput 
                                key={realPitchIdx} 
                                pitchNumber={realPitchIdx + 1}
                                value={pitch.points}
                                pitchesRemaining={remaining}
                                readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)}
                                isEditing={isEditing}
                                onOpen={() => setActiveCell({ 
                                    side: (teams.home.players.some(p=>p.id === playerScore.playerId) || playerScore.playerId.includes(teams.home.id)) ? 'home' : 'away', 
                                    lineupIdx, 
                                    pitchIdx: realPitchIdx 
                                })}
                                onClose={() => setActiveCell(null)}
                                onChange={(val) => handleScoreUpdate(
                                    (teams.home.players.some(p=>p.id === playerScore.playerId) || playerScore.playerId.includes(teams.home.id)) ? 'home' : 'away',
                                    lineupIdx, 
                                    realPitchIdx, 
                                    val
                                )}
                                onUndo={realPitchIdx > 0 ? () => handleUndo(
                                    (teams.home.players.some(p=>p.id === playerScore.playerId) || playerScore.playerId.includes(teams.home.id)) ? 'home' : 'away',
                                    lineupIdx, 
                                    realPitchIdx
                                ) : undefined}
                             />
                        );
                    })}
                 </div>
             </td>
             <td className="px-1 sm:px-3 py-1 sm:py-2 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30">
                 <div className="text-sm sm:text-base font-sans tabular-nums font-bold text-slate-800 dark:text-slate-200 w-5 sm:w-8">
                     {playerScore.pitches.slice(startPitchIdx, endPitchIdx).reduce((s, p) => s + (p.points || 0), 0)}
                 </div>
             </td>
         </tr>
     );
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team, inningData: any) => {
    // Check for Ghost Mode (2 players getting 15 pitches each)
    // If team has 2 players, logic uses 15 pitches.
    // If team has 3 players, logic uses 10 pitches.
    // inningData.playerScores follows the match structure logic.
    const isTwoPlayerGhostMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;
    const canRestore = match.innings[activeTab as number].number > 1 && isTwoPlayerGhostMode && !isReadOnly && !match.isComplete;
    
    // Header Color
    const headerClass = side === 'home' ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/30 text-red-800 dark:text-red-300' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/30 text-blue-800 dark:text-blue-300';

    return (
      <div className="mb-4 sm:mb-8">
        <div className={`p-1.5 sm:p-3 rounded-t-lg border-b flex justify-between items-end shadow-sm ${headerClass}`}>
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
             <div className="flex-1 min-w-0">
                <span className="text-[9px] sm:text-xs font-bold uppercase opacity-80 tracking-wider font-sans">{side === 'home' ? 'Home' : 'Away'}</span>
                {/* MODIFIED: Wraps team name instead of truncating */}
                <h3 className="text-base sm:text-xl font-black leading-tight font-sans break-words w-full">{team.name}</h3>
             </div>
             {canRestore && <button onClick={() => handleRestoreRoster(side)} className="shrink-0 bg-white/80 dark:bg-slate-800 hover:bg-white text-slate-600 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-700 shadow-sm animate-pulse font-sans">+ Reset Roster</button>}
          </div>
          <div className="text-lg sm:text-2xl font-sans tabular-nums font-bold shrink-0 ml-2">{calculateTeamInningTotal(side, activeTab as number)} <span className="text-xs sm:text-sm font-normal opacity-60 font-sans">pts</span></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-b-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-hide relative touch-auto">
          <table className="w-full border-collapse">
            <tbody>
              {isTwoPlayerGhostMode ? (
                  <>
                    {renderRow(inningData.playerScores[0], 0, team.players.find(p=>p.id===inningData.playerScores[0].playerId), 0, 10, false)}
                    {renderRow(inningData.playerScores[1], 1, team.players.find(p=>p.id===inningData.playerScores[1].playerId), 0, 10, false)}
                    {/* Ghost Row: Combines P1(11-15) and P2(11-15) */}
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 bg-slate-50/30 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700">
                        <td className="px-0.5 sm:px-2 py-1 sm:py-2 font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto max-w-[120px]">
                            <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                                <span className="text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-sans">3</span>
                                <span className="truncate text-[10px] sm:text-sm italic text-slate-400 dark:text-slate-500 font-sans flex-1">Ghost</span>
                            </div>
                        </td>
                        <td className="px-0.5 sm:px-2 py-1 sm:py-2">
                            <div className="flex items-center gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto">
                                {inningData.playerScores[0].pitches.slice(10, 15).map((pitch: any, idx: number) => {
                                    const taken = inningData.playerScores[0].pitches.filter((p:any) => p.points !== null).length;
                                    const left = 15 - taken;
                                    const realPitchIdx = 10 + idx;
                                    const isEditing = activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === realPitchIdx;
                                    return (
                                    <ScoreInput 
                                        key={`p1-${realPitchIdx}`} pitchNumber={11+idx} value={pitch.points} 
                                        pitchesRemaining={left}
                                        readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} 
                                        isEditing={isEditing} 
                                        onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: realPitchIdx })} onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, 0, realPitchIdx, val)} 
                                        onUndo={realPitchIdx > 0 ? () => handleUndo(side, 0, realPitchIdx) : undefined}
                                    />
                                    );
                                })}
                                <div className="w-px h-10 sm:h-14 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch: any, idx: number) => {
                                    const taken = inningData.playerScores[1].pitches.filter((p:any) => p.points !== null).length;
                                    const left = 15 - taken;
                                    const realPitchIdx = 10 + idx;
                                    const isEditing = activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === realPitchIdx;
                                    return (
                                    <ScoreInput 
                                        key={`p2-${realPitchIdx}`} pitchNumber={11+idx} value={pitch.points} 
                                        pitchesRemaining={left}
                                        readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} 
                                        isEditing={isEditing} 
                                        onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: realPitchIdx })} onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, 1, realPitchIdx, val)} 
                                        onUndo={realPitchIdx > 0 ? () => handleUndo(side, 1, realPitchIdx) : undefined}
                                    />
                                    );
                                })}
                            </div>
                        </td>
                        <td className="px-1 sm:px-3 py-1 sm:py-2 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30">
                             <div className="text-sm sm:text-base font-sans tabular-nums font-bold text-slate-800 dark:text-slate-200 w-5 sm:w-8">
                                 {inningData.playerScores[0].pitches.slice(10, 15).reduce((s:any,p:any)=>s+(p.points||0),0) + inningData.playerScores[1].pitches.slice(10, 15).reduce((s:any,p:any)=>s+(p.points||0),0)}
                             </div>
                        </td>
                    </tr>
                  </>
              ) : (
                  inningData.playerScores.map((playerScore: any, lineupIdx: number) => {
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
                             {isLastRound && !match.isComplete && (
                                 homeSum === awaySum ? (
                                    <button onClick={() => startTieBreakerRound()} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs sm:text-sm shadow font-sans">Next Round</button>
                                 ) : (
                                    <button onClick={confirmCompleteGame} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs sm:text-sm shadow font-sans">Finalize Game</button>
                                 )
                             )}
                         </div>
                         <div className="bg-white dark:bg-slate-900 border-x border-b border-slate-200 dark:border-slate-700 rounded-b-xl overflow-hidden overflow-x-auto touch-auto">
                             <table className="w-full min-w-[300px]">
                                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                     {/* Away Player Row (Blue) */}
                                     <tr className="bg-blue-50/10 dark:bg-blue-900/10">
                                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 w-[120px] sm:w-[150px]">
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                                                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded font-sans">Away</span>
                                                <span className="font-bold text-sm truncate font-sans text-slate-900 dark:text-slate-100 max-w-[80px] sm:max-w-none">{formatName(awayPlayer)}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex gap-2 overflow-x-auto scrollbar-hide touch-auto">
                                                {round.awayScores.map((score, pIdx) => {
                                                    const isEditing = activeCell?.side === 'away' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pIdx;
                                                    return (
                                                    <ScoreInput 
                                                        key={`ot-away-${idx}-${pIdx}`} pitchNumber={pIdx+1} value={score}
                                                        readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)}
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
                                     {/* Home Player Row (Red) */}
                                     <tr className="bg-red-50/10 dark:bg-red-900/10">
                                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 w-[120px] sm:w-[150px]">
                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                                                <span className="text-[10px] font-bold bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300 px-2 py-0.5 rounded font-sans">Home</span>
                                                <span className="font-bold text-sm truncate font-sans text-slate-900 dark:text-slate-100 max-w-[80px] sm:max-w-none">{formatName(homePlayer)}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex gap-2 overflow-x-auto scrollbar-hide touch-auto">
                                                {round.homeScores.map((score, pIdx) => {
                                                    const isEditing = activeCell?.side === 'home' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pIdx;
                                                    return (
                                                    <ScoreInput 
                                                        key={`ot-home-${idx}-${pIdx}`} pitchNumber={pIdx+1} value={score}
                                                        readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)}
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
    <div className="min-h-full w-full overflow-x-hidden bg-transparent pb-20 font-sans">
      <header className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 sticky top-0 z-[50] shadow-sm">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 py-1.5 sm:py-3 flex justify-between items-center gap-2 sm:gap-4">
          {/* Main Score Display with Wrapped Names */}
          <div className="flex gap-2 sm:gap-8 items-center flex-1 min-w-0">
            <div className="text-center flex-1 min-w-0">
                <div className="text-[8px] sm:text-xs text-slate-500 dark:text-slate-400 uppercase font-bold font-sans">Away</div>
                {/* MODIFIED: Replaced truncate with multi-line wrapping */}
                <div className="text-xs sm:text-xl font-bold text-blue-700 dark:text-blue-400 leading-tight line-clamp-2 w-full font-sans px-1 break-words">{teams.away.name}</div>
                <div className="text-lg sm:text-2xl font-sans tabular-nums leading-none dark:text-white">{awayTotal}</div>
            </div>
            <div className="text-slate-300 dark:text-slate-600 text-base sm:text-xl font-light font-sans">vs</div>
            <div className="text-center flex-1 min-w-0">
                <div className="text-[8px] sm:text-xs text-slate-500 dark:text-slate-400 uppercase font-bold font-sans">Home</div>
                {/* MODIFIED: Replaced truncate with multi-line wrapping */}
                <div className="text-xs sm:text-xl font-bold text-red-700 dark:text-red-400 leading-tight line-clamp-2 w-full font-sans px-1 break-words">{teams.home.name}</div>
                <div className="text-lg sm:text-2xl font-sans tabular-nums leading-none dark:text-white">{homeTotal}</div>
            </div>
          </div>
          
          {/* Action Button: Edit or Lock */}
          {(isReadOnly && match.isComplete && !isEditingCompleted) ? null : (
              <div className="shrink-0">
                  {match.isComplete ? (
                     <button onClick={() => setIsEditingCompleted(!isEditingCompleted)} className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg font-bold text-[10px] sm:text-xs transition-colors border ${isEditingCompleted ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                         {isEditingCompleted ? 'Lock Score' : 'Edit Score'}
                     </button>
                  ) : null}
              </div>
          )}
        </div>

        {/* Inning Tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur">
            {match.innings.map((inning, idx) => (
                <button 
                    key={inning.number}
                    onClick={() => setActiveTab(idx)}
                    className={`flex-1 min-w-[60px] py-3 text-sm font-bold font-sans transition-colors relative ${activeTab === idx ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                    {inning.number}
                    {activeTab === idx && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>}
                </button>
            ))}
            {match.tieBreaker && match.tieBreaker.length > 0 && (
                <button 
                    onClick={() => setActiveTab('tiebreaker')}
                    className={`flex-1 min-w-[80px] py-3 text-sm font-bold font-sans transition-colors relative ${activeTab === 'tiebreaker' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    Extras
                    {activeTab === 'tiebreaker' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-600 dark:bg-amber-400"></div>}
                </button>
            )}
        </div>
      </header>
      
      {/* Main Content */}
      <div className="p-2 sm:p-4 pb-24">
          {activeTab === 'tiebreaker' ? (
              renderTieBreakerTab()
          ) : (
             <div className="space-y-4">
                 {/* Away Team Row */}
                 {renderTeamSection('away', teams.away, match.innings[activeTab as number].away)}
                 
                 {/* Home Team Row */}
                 {renderTeamSection('home', teams.home, match.innings[activeTab as number].home)}
             </div>
          )}
      </div>
      
      {/* Footer Final Score */}
      {match.isComplete && !isEditingCompleted && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-t border-slate-200 dark:border-slate-800 flex justify-center z-40">
              <div className="text-slate-500 font-bold font-sans">Final Score</div>
          </div>
      )}
    </div>
  );
};
