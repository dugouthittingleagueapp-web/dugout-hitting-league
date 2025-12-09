
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Match, Inning, Team, TieBreakerRound, Player } from '../types';
import * as storage from '../services/storageService';
import { ScoreInput } from './ScoreInput';

interface ScoreboardProps {
  matchId: string;
  onExit: () => void;
  isReadOnly?: boolean;
}

const getLiveInningIndex = (m: Match): number => {
    if (m.tieBreaker && m.tieBreaker.length > 0) return 6;
    for (let i = 0; i < 6; i++) {
        const ing = m.innings[i];
        const isHomeDone = ing.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
        const isAwayDone = ing.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
        if (!isHomeDone || !isAwayDone) return i;
    }
    return 5;
};

export const Scoreboard: React.FC<ScoreboardProps> = ({ matchId, onExit, isReadOnly = false }) => {
  const [match, setMatch] = useState<Match | null>(null);
  const [teams, setTeams] = useState<{ home?: Team, away?: Team }>({});
  const [activeInningIdx, setActiveInningIdx] = useState(0); 
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number } | null>(null);

  const [showTieBreakerSetup, setShowTieBreakerSetup] = useState(false);
  const [tbHomePlayerId, setTbHomePlayerId] = useState('');
  const [tbAwayPlayerId, setTbAwayPlayerId] = useState('');

  const [isEditingCompleted, setIsEditingCompleted] = useState(false);

  const activeInningRef = useRef(activeInningIdx);
  const lastLiveInningRef = useRef<number>(-1);

  useEffect(() => {
      activeInningRef.current = activeInningIdx;
  }, [activeInningIdx]);

  const formatName = (p: { name: string, lastName?: string } | undefined) => {
      if (!p) return 'Unknown';
      return `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;
  };

  const loadMatchData = async () => {
      const m = await storage.getMatch(matchId);
      if (m) {
        const allTeams = await storage.getAllTeams();
        const home = allTeams.find(t => t.id === m.homeTeamId);
        const away = allTeams.find(t => t.id === m.awayTeamId);
        setMatch(m);
        setTeams({ home, away });
        
        if (home && !tbHomePlayerId && home.players.length > 0) setTbHomePlayerId(home.players[0].id);
        if (away && !tbAwayPlayerId && away.players.length > 0) setTbAwayPlayerId(away.players[0].id);

        if (isReadOnly) {
            const liveIdx = getLiveInningIndex(m);
            const currentTab = activeInningRef.current;
            const lastLive = lastLiveInningRef.current;
            
            if (lastLive === -1) {
                lastLiveInningRef.current = liveIdx;
                setActiveInningIdx(liveIdx);
            } else if (liveIdx > lastLive) {
                if (currentTab === lastLive) {
                     setActiveInningIdx(liveIdx);
                }
                lastLiveInningRef.current = liveIdx;
            }
        }
      }
  };

  useEffect(() => {
    const init = async () => {
        setLoading(true);
        lastLiveInningRef.current = -1; 
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

  const currentInning = match.innings[activeInningIdx] || match.innings[0];
  const isExtraInnings = activeInningIdx === 6;

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
      setActiveInningIdx(6); 
  };

  const handleUndo = async (side: 'home' | 'away', lineupIdx: number, currentPitchIdx: number, roundIdx?: number) => {
      const prevPitchIdx = currentPitchIdx - 1;
      if (prevPitchIdx < 0) return;
      const newMatch = { ...match };
      if (roundIdx !== undefined && newMatch.tieBreaker) {
          const round = newMatch.tieBreaker[roundIdx];
          if (side === 'home') round.homeScores[prevPitchIdx] = null;
          else round.awayScores[prevPitchIdx] = null;
          setActiveCell({ side, lineupIdx: 0, pitchIdx: prevPitchIdx, roundIdx });
      } else {
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
    const existingValue = match.innings[activeInningIdx][side].playerScores[lineupIdx].pitches[pitchIdx].points;
    const isEdit = existingValue !== null;
    const newMatch = { ...match };
    const inning = newMatch.innings[activeInningIdx];
    const teamData = side === 'home' ? inning.home : inning.away;
    teamData.playerScores[lineupIdx].pitches[pitchIdx].points = val;
    setMatch(newMatch); 
    const isFinalInning = activeInningIdx === 5; 
    let shouldOpenTieBreaker = false;
    if (isFinalInning && side === 'home' && !match.isComplete) {
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
    let nextCell = null;
    if (!isEdit && !shouldOpenTieBreaker) {
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        if (pitchIdx < totalPitches - 1) {
            nextCell = { side, lineupIdx, pitchIdx: pitchIdx + 1 };
        }
    }
    setActiveCell(nextCell);
    if (shouldOpenTieBreaker) {
         setTimeout(() => setShowTieBreakerSetup(true), 500);
    } else if (!isEdit && activeInningIdx < 5 && !match.isComplete) {
        const currentInningData = newMatch.innings[activeInningIdx];
        const isHomeComplete = currentInningData.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
        const isAwayComplete = currentInningData.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
        if (isHomeComplete && isAwayComplete) {
             setTimeout(() => {
                 setActiveInningIdx(prev => prev < 5 ? prev + 1 : prev);
                 setActiveCell(null); 
             }, 700);
        }
    }
    await storage.updateMatch(newMatch).catch(err => console.error("Failed to save score", err));
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
      setMatch(newMatch); 
      let nextCell = null;
      if (!isEdit && pitchIdx < limit - 1) {
           nextCell = { side, lineupIdx: 0, pitchIdx: pitchIdx + 1, roundIdx };
      }
      setActiveCell(nextCell);
      await storage.updateMatch(newMatch);
  };

  const updateLineup = async (teamId: string, player: Player) => {
      setLoading(true);
      try {
          const updated = await storage.updateMatchLineup(match.id, teamId, player, activeInningIdx);
          setMatch(updated);
          setShowEditModal(false);
      } catch (e) {
          alert("Failed to update lineup");
      }
      setLoading(false);
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const headerClass = side === 'home' 
        ? 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 border-red-200 dark:border-red-900' 
        : 'bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900';
    
    const isShortHanded = inningData.playerScores.length < 3;

    const renderRow = (playerScore: any, lineupIdx: number, player: any) => {
         const rowTotal = playerScore.pitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
         const taken = playerScore.pitches.filter((p:any) => p.points !== null).length;
         const pitchesLeft = playerScore.pitches.length - taken;

         return (
            <tr key={`${playerScore.playerId}`} className="hover:bg-slate-50/50 dark:hover:bg-white/5 border-b border-slate-100 dark:border-slate-800">
                <td className="px-0.5 sm:px-2 py-1 sm:py-2 font-medium text-slate-700 dark:text-slate-200 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto max-w-[120px]">
                    <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                        <span className={`text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 font-sans bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-400`}>
                            {lineupIdx + 1}
                        </span>
                        <span className="truncate text-[10px] sm:text-sm font-sans text-slate-900 dark:text-slate-100 font-bold block flex-1">
                            {formatName(player)}
                        </span>
                    </div>
                </td>
                <td className="px-0.5 sm:px-2 py-1 sm:py-2">
                    <div className="flex w-full landscape:justify-between gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto items-center">
                        {playerScore.pitches.map((pitch: any, idx: number) => {
                            const isEditing = activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === idx;
                            return (
                                <React.Fragment key={idx}>
                                    <ScoreInput 
                                        pitchNumber={idx + 1} 
                                        value={pitch.points} 
                                        pitchesRemaining={pitchesLeft}
                                        readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} 
                                        isEditing={isEditing} 
                                        onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: idx })} 
                                        onClose={() => setActiveCell(null)} 
                                        onChange={(val) => handleScoreUpdate(side, lineupIdx, idx, val)} 
                                        onUndo={idx > 0 ? () => handleUndo(side, lineupIdx, idx) : undefined}
                                    />
                                    {playerScore.pitches.length === 15 && idx === 4 && <div className="w-px h-8 bg-slate-300 dark:bg-slate-700 mx-1"></div>}
                                    {playerScore.pitches.length === 15 && idx === 9 && <div className="w-px h-8 bg-slate-300 dark:bg-slate-700 mx-1"></div>}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </td>
                <td className="px-1 sm:px-3 py-1 sm:py-2 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/30">
                    <div className="text-sm sm:text-base font-sans font-bold tabular-nums text-slate-800 dark:text-white w-5 sm:w-8">{rowTotal}</div>
                </td>
            </tr>
         );
    };

    return (
      <div className="mb-4 sm:mb-8">
        <div className={`p-1.5 sm:p-3 rounded-t-lg border-b flex justify-between items-end shadow-sm ${headerClass}`}>
          <div className="flex items-center gap-2 sm:gap-3">
             <div>
                <span className="text-[9px] sm:text-xs font-bold uppercase opacity-80 tracking-wider font-sans">{side === 'home' ? 'Home' : 'Away'}</span>
                <h3 className="text-[9px] sm:text-xl font-black leading-tight font-sans break-words whitespace-normal">{team.name}</h3>
             </div>
          </div>
          <div className="text-lg sm:text-2xl font-sans tabular-nums font-bold">{calculateTeamInningTotal(side, currentInning)} <span className="text-xs sm:text-sm font-normal opacity-60 font-sans">pts</span></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-b-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-hide relative touch-auto">
          <table className="w-full border-collapse">
            <tbody>
              {inningData.playerScores.map((playerScore, lineupIdx) => {
                 const player = team.players.find(p => p.id === playerScore.playerId);
                 return renderRow(playerScore, lineupIdx, player);
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTieBreakerTab = () => {
      if (!match.tieBreaker || match.tieBreaker.length === 0) return <div className="p-8 text-center text-slate-400 font-sans">No data.</div>;
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
                             <h3 className="font-bold text-amber-800 dark:text-amber-100 font-sans text-xs sm:text-base">Round {round.roundNumber} ({round.pitchLimit})</h3>
                             {isLastRound && !match.isComplete && (
                                 homeSum === awaySum ? (
                                    <button onClick={() => startTieBreakerRound()} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs sm:text-sm font-sans">Next Round</button>
                                 ) : (
                                    <button onClick={confirmCompleteGame} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs sm:text-sm font-sans">Finalize Game</button>
                                 )
                             )}
                         </div>
                         <div className="bg-white dark:bg-slate-900 border-x border-b border-slate-200 dark:border-slate-700 rounded-b-xl overflow-hidden overflow-x-auto">
                             <table className="w-full min-w-[300px]">
                                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                     <tr className="bg-blue-50/10 dark:bg-blue-900/10">
                                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 w-[120px] sm:w-[150px]">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded font-sans">Away</span>
                                                <span className="font-bold text-sm truncate font-sans text-slate-900 dark:text-slate-100">{formatName(awayPlayer)}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                                                {round.awayScores.map((score, pIdx) => {
                                                    const isEditing = activeCell?.side === 'away' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pIdx;
                                                    return (
                                                    <ScoreInput 
                                                        key={pIdx} pitchNumber={pIdx+1} value={score}
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
                                        <td className="px-4 py-3 font-bold text-xl text-center tabular-nums bg-slate-50/50 dark:bg-slate-800/50 dark:text-white">{awaySum}</td>
                                     </tr>
                                     <tr className="bg-red-50/10 dark:bg-red-900/10">
                                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 w-[120px] sm:w-[150px]">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300 px-2 py-0.5 rounded font-sans">Home</span>
                                                <span className="font-bold text-sm truncate font-sans text-slate-900 dark:text-slate-100">{formatName(homePlayer)}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                                                {round.homeScores.map((score, pIdx) => {
                                                    const isEditing = activeCell?.side === 'home' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pIdx;
                                                    return (
                                                    <ScoreInput 
                                                        key={pIdx} pitchNumber={pIdx+1} value={score}
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
                                        <td className="px-4 py-3 font-bold text-xl text-center tabular-nums bg-slate-50/50 dark:bg-slate-800/50 dark:text-white">{homeSum}</td>
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
          <div className="flex gap-2 sm:gap-8 items-center flex-1 min-w-0">
            <div className="text-center flex-1 min-w-0">
                <div className="text-[8px] sm:text-xs text-slate-500 font-bold font-sans">Away</div>
                <div className="text-[9px] sm:text-xl font-bold text-blue-700 dark:text-blue-400 font-sans truncate">{teams.away.name}</div>
                <div className="text-lg sm:text-2xl font-sans tabular-nums leading-none dark:text-white">{awayTotal}</div>
            </div>
            <div className="text-slate-300 dark:text-slate-600 text-base sm:text-xl font-light font-sans">vs</div>
            <div className="text-center flex-1 min-w-0">
                <div className="text-[8px] sm:text-xs text-slate-500 font-bold font-sans">Home</div>
                <div className="text-[9px] sm:text-xl font-bold text-red-700 dark:text-red-400 font-sans truncate">{teams.home.name}</div>
                <div className="text-lg sm:text-2xl font-sans tabular-nums leading-none dark:text-white">{homeTotal}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isReadOnly && <div className="flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase animate-pulse font-sans"><span className="w-2 h-2 rounded-full bg-red-600"></span>LIVE</div>}
            
            {!isReadOnly && !match.isComplete && <button onClick={() => setShowEditModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold py-2 px-3 rounded-lg shadow-sm font-sans">Edit Lineup</button>}
            
            {!isReadOnly && match.isComplete && (
                <button onClick={() => setIsEditingCompleted(!isEditingCompleted)} className={`text-xs sm:text-sm font-bold py-2 px-3 rounded-lg transition-colors border ${isEditingCompleted ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>{isEditingCompleted ? 'Lock' : 'Edit'}</button>
            )}

            {!isReadOnly && !match.isComplete && !isExtraInnings && <button onClick={() => setShowFinishModal(true)} className="bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm font-bold py-2 px-3 rounded-lg shadow-sm font-sans">Complete</button>}
            <button onClick={onExit} className="text-xs sm:text-sm font-bold text-slate-500 bg-slate-100 py-2 px-3 rounded-lg font-sans">Exit</button>
          </div>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide border-t border-slate-100 dark:border-slate-800 touch-auto">
            {match.innings.map((ing, idx) => (
                <button key={ing.number} onClick={() => setActiveInningIdx(idx)} className={`flex-1 py-1.5 sm:py-3 text-[10px] sm:text-sm font-bold uppercase border-b-2 transition-colors min-w-[60px] font-sans ${idx === activeInningIdx ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-400 hover:bg-slate-50'}`}>Inning {ing.number}</button>
            ))}
            {(match.tieBreaker && match.tieBreaker.length > 0) && (
                <button onClick={() => setActiveInningIdx(6)} className={`flex-1 py-1.5 sm:py-3 text-[10px] sm:text-sm font-bold uppercase border-b-2 transition-colors min-w-[100px] font-sans ${activeInningIdx === 6 ? 'border-amber-500 text-amber-600 bg-amber-50' : 'border-transparent text-amber-500 hover:bg-amber-50'}`}>Extra Innings</button>
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

      {showEditModal && createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4" onClick={() => setShowEditModal(false)}>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h2 className="text-xl font-bold mb-4">Edit Team Lineup</h2>
                  <div className="grid md:grid-cols-2 gap-8">
                      {['home', 'away'].map((side) => {
                          const team = side === 'home' ? teams.home! : teams.away!;
                          const scoreIds = match.innings[activeInningIdx][side as 'home'|'away'].playerScores.map(p => p.playerId);
                          const availablePlayers = team.players.filter(p => !scoreIds.includes(p.id));
                          const availableSubs = (team.subs || []).filter(s => !scoreIds.includes(s.id));
                          const canAdd = scoreIds.length < 3;
                          return (
                            <div key={side}>
                                <h3 className="font-bold mb-2 uppercase text-xs text-slate-500">{team.name} Roster</h3>
                                <div className="space-y-2">
                                    {canAdd && [...availablePlayers, ...availableSubs].map(p => (
                                        <button key={p.id} onClick={() => updateLineup(team.id, p)} className="w-full p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-left hover:bg-blue-100 dark:hover:bg-blue-900 font-medium transition-colors">+ Add {formatName(p)}</button>
                                    ))}
                                    {!canAdd && <p className="text-sm italic text-slate-500">Roster Full</p>}
                                </div>
                            </div>
                          );
                      })}
                  </div>
                  <button onClick={() => setShowEditModal(false)} className="mt-8 w-full py-3 bg-slate-200 dark:bg-slate-800 rounded-xl font-bold">Close</button>
              </div>
          </div>,
          document.body
      )}

      {showFinishModal && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl shadow-2xl w-[90%] max-w-sm text-center font-sans border border-slate-200 dark:border-slate-700">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2 font-sans">Finish Match?</h2>
                  <p className="text-slate-500 mb-6 font-sans">Finalize the score. Standings will update.</p>
                  <div className="flex gap-3">
                      <button onClick={() => setShowFinishModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl font-bold">Cancel</button>
                      <button onClick={confirmCompleteGame} className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg">Confirm</button>
                  </div>
              </div>
          </div>,
          document.body
      )}
    </div>
  );
};
