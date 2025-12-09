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
  
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number } | null>(null);

  // Tie Breaker Setup State
  const [showTieBreakerSetup, setShowTieBreakerSetup] = useState(false);
  const [tbHomePlayerId, setTbHomePlayerId] = useState('');
  const [tbAwayPlayerId, setTbAwayPlayerId] = useState('');

  // Roster Editing State
  const [rosterSide, setRosterSide] = useState<'home' | 'away' | null>(null);

  // Edit Completed Game State
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
      let wakeLock: any = null;
      const requestWakeLock = async () => {
          try {
              if ('wakeLock' in navigator) {
                  wakeLock = await (navigator as any).wakeLock.request('screen');
              }
          } catch (err) {}
      };
      requestWakeLock();
      const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') requestWakeLock();
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          if (wakeLock) wakeLock.release().catch(() => {});
      };
  }, []);

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
    
    let shouldOpenTieBreaker = false;
    if (activeInningIdx === 5 && side === 'home' && !match.isComplete) {
        const isLastPlayer = lineupIdx === teamData.playerScores.length - 1;
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        if (isLastPlayer && pitchIdx === totalPitches - 1) {
            const hT = calculateTeamGameTotal('home', newMatch);
            const aT = calculateTeamGameTotal('away', newMatch);
            if (hT === aT) shouldOpenTieBreaker = true;
        }
    }

    let nextCell = null;
    if (!isEdit && !shouldOpenTieBreaker) {
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        if (pitchIdx < totalPitches - 1) nextCell = { side, lineupIdx, pitchIdx: pitchIdx + 1 };
    }
    setActiveCell(nextCell);

    if (shouldOpenTieBreaker) setTimeout(() => setShowTieBreakerSetup(true), 500);
    else if (!isEdit && activeInningIdx < 5 && !match.isComplete) {
        const cur = newMatch.innings[activeInningIdx];
        if (cur.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null)) && 
            cur.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null))) {
             setTimeout(() => { setActiveInningIdx(p => (p < 5 ? p + 1 : p)); setActiveCell(null); }, 700);
        }
    }
    await storage.updateMatch(newMatch).catch(err => console.error(err));
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
      const round = match.tieBreaker[roundIdx];
      const newMatch = { ...match };
      const cur = newMatch.tieBreaker![roundIdx];
      const limit = cur.pitchLimit;
      const existing = side === 'home' ? cur.homeScores[pitchIdx] : cur.awayScores[pitchIdx];
      const isEdit = existing !== null;
      if (side === 'home') cur.homeScores[pitchIdx] = val; else cur.awayScores[pitchIdx] = val;
      setMatch(newMatch);
      let next = null;
      if (!isEdit && pitchIdx < limit - 1) next = { side, lineupIdx: 0, pitchIdx: pitchIdx + 1, roundIdx };
      setActiveCell(next);
      await storage.updateMatch(newMatch);
  };

  const saveRosterChange = async (side: 'home' | 'away', playerIds: string[]) => {
      if (isReadOnly || !match) return;
      setLoading(true);
      const newMatch = { ...match };
      
      const updateInningStructure = (ing: Inning, hIds: string[], aIds: string[]): Inning => {
          const hC = hIds.length;
          const aC = aIds.length;
          let hP = 10, aP = 10;
          if (hC === 2 && aC === 3) hP = 15;
          else if (aC === 2 && hC === 3) aP = 15;

          const syncScores = (existingScores: any, newIds: string[], pitchCount: number) => {
              return newIds.map(id => {
                  const found = existingScores.playerScores.find((p: any) => p.playerId === id);
                  if (found) {
                      const curLen = found.pitches.length;
                      if (curLen === pitchCount) return found;
                      if (curLen < pitchCount) return { ...found, pitches: [...found.pitches, ...Array(pitchCount - curLen).fill({ points: null })] };
                      return { ...found, pitches: found.pitches.slice(0, pitchCount) };
                  }
                  return { playerId: id, pitches: Array(pitchCount).fill(null).map(() => ({ points: null })) };
              });
          };

          return {
              ...ing,
              home: { teamId: 'home', playerScores: syncScores(ing.home, hIds, hP) },
              away: { teamId: 'away', playerScores: syncScores(ing.away, aIds, aP) }
          };
      };

      for (let i = activeInningIdx; i < 6; i++) {
          const curH = i === activeInningIdx && side === 'away' ? newMatch.innings[i].home.playerScores.map(p => p.playerId) : (side === 'home' ? playerIds : newMatch.innings[i].home.playerScores.map(p => p.playerId));
          const curA = i === activeInningIdx && side === 'home' ? newMatch.innings[i].away.playerScores.map(p => p.playerId) : (side === 'away' ? playerIds : newMatch.innings[i].away.playerScores.map(p => p.playerId));
          newMatch.innings[i] = updateInningStructure(newMatch.innings[i], curH, curA);
      }

      setMatch(newMatch);
      await storage.updateMatch(newMatch);
      setRosterSide(null);
      setLoading(false);
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const headerClass = side === 'home' 
        ? 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 border-red-200 dark:border-red-900' 
        : 'bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900';
    
    const isTwoPlayerGhostMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;
    const canEdit = !isReadOnly && !match.isComplete;

    const renderRow = (playerScore: any, lineupIdx: number, player: any, pitchStartIndex: number, pitchEndIndex: number, isGhostRow = false) => {
         const visiblePitches = playerScore.pitches.slice(pitchStartIndex, pitchEndIndex);
         const rowTotal = visiblePitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
         const pitchesLeft = isTwoPlayerGhostMode ? 15 - playerScore.pitches.filter((p:any) => p.points !== null).length : playerScore.pitches.length - playerScore.pitches.filter((p:any) => p.points !== null).length;

         return (
            <tr key={`${playerScore.playerId}-${isGhostRow ? 'ghost' : 'norm'}`} className="hover:bg-slate-50/50 dark:hover:bg-white/5 border-b border-slate-100 dark:border-slate-800">
                <td className="px-0.5 sm:px-2 py-1 sm:py-2 font-medium text-slate-700 dark:text-slate-200 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto max-w-[120px]">
                    <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                        <span className={`text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 font-sans ${isGhostRow ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-400'}`}>{isGhostRow ? '3' : lineupIdx + 1}</span>
                        <span className="truncate text-[10px] sm:text-sm font-sans text-slate-900 dark:text-slate-100 font-bold block flex-1">{isGhostRow ? <span className="italic text-slate-400">Ghost</span> : formatName(player)}</span>
                    </div>
                </td>
                <td className="px-0.5 sm:px-2 py-1 sm:py-2">
                    <div className="flex w-full landscape:justify-between gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto">
                        {visiblePitches.map((pitch: any, idx: number) => {
                            const realIdx = pitchStartIndex + idx;
                            return (
                                <ScoreInput key={realIdx} pitchNumber={isGhostRow ? pitchStartIndex+idx+1 : realIdx+1} value={pitch.points} pitchesRemaining={pitchesLeft} readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} isEditing={activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === realIdx} onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: realIdx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, lineupIdx, realIdx, val)} onUndo={realIdx > 0 ? () => handleUndo(side, lineupIdx, realIdx) : undefined} />
                            );
                        })}
                    </div>
                </td>
                {!isGhostRow && <td className="px-1 sm:px-3 py-1 sm:py-2 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/30"><div className="text-sm sm:text-base font-sans font-bold tabular-nums text-slate-800 dark:text-white w-5 sm:w-8">{rowTotal}</div></td>}
            </tr>
         );
    };

    return (
      <div className="mb-4 sm:mb-8">
        <div className={`p-1.5 sm:p-3 rounded-t-lg border-b flex justify-between items-end shadow-sm ${headerClass}`}>
          <div className="flex items-center gap-2 sm:gap-3">
             <div><span className="text-[9px] sm:text-xs font-bold uppercase opacity-80 tracking-wider font-sans">{side === 'home' ? 'Home' : 'Away'}</span><h3 className="text-[9px] sm:text-xl font-black leading-tight font-sans whitespace-normal">{team.name}</h3></div>
             {canEdit && <button onClick={() => setRosterSide(side)} className="bg-white/80 dark:bg-slate-800 hover:bg-white text-slate-600 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-700 shadow-sm font-sans">Edit Roster</button>}
          </div>
          <div className="text-lg sm:text-2xl font-sans tabular-nums font-bold">{calculateTeamInningTotal(side, currentInning)} <span className="text-xs sm:text-sm font-normal opacity-60 font-sans">pts</span></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-b-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-hide relative touch-auto">
          <table className="w-full border-collapse">
            <tbody>
              {isTwoPlayerGhostMode ? (
                  <>{renderRow(inningData.playerScores[0], 0, team.players.find(p=>p.id===inningData.playerScores[0].playerId), 0, 10, false)}{renderRow(inningData.playerScores[1], 1, team.players.find(p=>p.id===inningData.playerScores[1].playerId), 0, 10, false)}
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 bg-slate-50/30 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700">
                        <td className="px-0.5 sm:px-2 py-1 sm:py-2 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto">
                            <div className="flex items-center gap-1.5 sm:gap-2 w-full"><span className="text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-sans">3</span><span className="truncate text-[10px] sm:text-sm italic text-slate-400 dark:text-slate-500 font-sans flex-1">Ghost</span></div>
                        </td>
                        <td className="px-0.5 sm:px-2 py-1 sm:py-2"><div className="flex w-full landscape:justify-between items-center gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto">
                                {inningData.playerScores[0].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput key={`p1-${10+idx}`} pitchNumber={11+idx} value={pitch.points} readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} isEditing={activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === 10+idx} onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, 0, 10+idx, val)} onUndo={() => handleUndo(side, 0, 10+idx)} />
                                ))}<div className="w-px h-10 sm:h-14 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput key={`p2-${10+idx}`} pitchNumber={11+idx} value={pitch.points} readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} isEditing={activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === 10+idx} onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, 1, 10+idx, val)} onUndo={() => handleUndo(side, 1, 10+idx)} />
                                ))}</div></td>
                        <td className="px-1 sm:px-3 py-1 sm:py-2 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30">
                             <div className="text-sm sm:text-base font-sans tabular-nums font-bold text-slate-800 dark:text-slate-200 w-5 sm:w-8">{inningData.playerScores[0].pitches.slice(10, 15).reduce((s,p)=>s+(p.points||0),0) + inningData.playerScores[1].pitches.slice(10, 15).reduce((s,p)=>s+(p.points||0),0)}</div>
                        </td>
                    </tr>
                  </>
              ) : (inningData.playerScores.map((playerScore, idx) => renderRow(playerScore, idx, team.players.find(p => p.id === playerScore.playerId), 0, playerScore.pitches.length, false)))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTieBreakerTab = () => {
      if (!match.tieBreaker || match.tieBreaker.length === 0) return <div className="p-8 text-center text-slate-400 font-sans">Extra Innings Data not available.</div>;
      return (
          <div className="space-y-8">
              {match.tieBreaker.map((round, idx) => {
                  const hS = round.homeScores.reduce((a,b)=>(a||0)+(b||0),0);
                  const aS = round.awayScores.reduce((a,b)=>(a||0)+(b||0),0);
                  return (
                    <div key={idx}>
                         <div className="bg-amber-50 dark:bg-amber-950 p-3 rounded-t-xl border border-amber-200 flex justify-between items-center"><h3 className="font-bold text-amber-800 font-sans">Extra Round {round.roundNumber}</h3>{idx === match.tieBreaker!.length - 1 && !match.isComplete && (hS === aS ? <button onClick={() => startTieBreakerRound()} className="bg-amber-600 text-white font-bold px-4 py-2 rounded-lg">Next Round</button> : <button onClick={confirmCompleteGame} className="bg-green-600 text-white font-bold px-4 py-2 rounded-lg">Finalize</button>)}</div>
                         <div className="bg-white dark:bg-slate-900 border-x border-b border-slate-200 rounded-b-xl overflow-x-auto"><table className="w-full"><tbody>
                            <tr className="bg-blue-50/10">
                                <td className="px-4 py-3 font-medium w-[150px]"><span className="font-bold">{formatName(teams.away?.players.find(p => p.id === round.awayPlayerId))}</span></td>
                                <td className="px-2 py-3"><div className="flex gap-2">{round.awayScores.map((s, pI) => (<ScoreInput key={pI} pitchNumber={pI+1} value={s} readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} isEditing={activeCell?.side === 'away' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pI} onOpen={() => setActiveCell({ side: 'away', lineupIdx: 0, pitchIdx: pI, roundIdx: idx })} onClose={() => setActiveCell(null)} onChange={v => handleTieBreakerScore(idx, 'away', pI, v)} onUndo={() => handleUndo('away', 0, pI, idx)} />))}</div></td>
                                <td className="px-4 py-3 font-bold text-xl text-center tabular-nums">{aS}</td>
                            </tr>
                            <tr className="bg-red-50/10">
                                <td className="px-4 py-3 font-medium w-[150px]"><span className="font-bold">{formatName(teams.home?.players.find(p => p.id === round.homePlayerId))}</span></td>
                                <td className="px-2 py-3"><div className="flex gap-2">{round.homeScores.map((s, pI) => (<ScoreInput key={pI} pitchNumber={pI+1} value={s} readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} isEditing={activeCell?.side === 'home' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pI} onOpen={() => setActiveCell({ side: 'home', lineupIdx: 0, pitchIdx: pI, roundIdx: idx })} onClose={() => setActiveCell(null)} onChange={v => handleTieBreakerScore(idx, 'home', pI, v)} onUndo={() => handleUndo('home', 0, pI, idx)} />))}</div></td>
                                <td className="px-4 py-3 font-bold text-xl text-center tabular-nums">{hS}</td>
                            </tr>
                         </tbody></table></div>
                    </div>
                  );
              })}
          </div>
      );
  };

  return (
    <div className="min-h-full w-full overflow-x-hidden pb-20 font-sans">
      <header className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b sticky top-0 z-[50] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center gap-4">
          <div className="flex gap-8 items-center flex-1 min-w-0">
            <div className="text-center flex-1 min-w-0"><div className="text-[10px] uppercase font-bold text-slate-500">Away</div><div className="text-xl font-bold text-blue-700 truncate">{teams.away.name}</div><div className="text-2xl font-sans tabular-nums font-bold dark:text-white">{awayTotal}</div></div>
            <div className="text-slate-300 text-xl font-light">vs</div>
            <div className="text-center flex-1 min-w-0"><div className="text-[10px] uppercase font-bold text-slate-500">Home</div><div className="text-xl font-bold text-red-700 truncate">{teams.home.name}</div><div className="text-2xl font-sans tabular-nums font-bold dark:text-white">{homeTotal}</div></div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isReadOnly && <div className="text-red-600 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider animate-pulse">LIVE</div>}
            {!isReadOnly && !match.isComplete && !isExtraInnings && <button onClick={() => setShowFinishModal(true)} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg">Complete</button>}
            <button onClick={onExit} className="text-sm font-bold text-slate-500 bg-slate-100 py-2 px-3 rounded-lg">Exit</button>
          </div>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide border-t touch-auto">
            {match.innings.map((ing, idx) => (
                <button key={ing.number} onClick={() => setActiveInningIdx(idx)} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors min-w-[80px] ${idx === activeInningIdx ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>Inning {ing.number}</button>
            ))}
            {(match.tieBreaker && match.tieBreaker.length > 0) && (
                <button onClick={() => setActiveInningIdx(6)} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 ${activeInningIdx === 6 ? 'border-amber-500 text-amber-600' : 'border-transparent text-amber-500'}`}>Extras</button>
            )}
        </div>
      </header>
      
      <main className="max-w-5xl mx-auto p-4 mt-4">
          {isExtraInnings ? renderTieBreakerTab() : (
              <>{renderTeamSection('away', teams.away)}{renderTeamSection('home', teams.home)}</>
          )}
      </main>

      {/* Roster Modal */}
      {rosterSide && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Edit Roster: {rosterSide === 'home' ? teams.home?.name : teams.away?.name}</h3>
                  <div className="space-y-3 mb-6">
                      {(rosterSide === 'home' ? teams.home?.players : teams.away?.players)?.map(p => {
                          const lineup = currentInning[rosterSide!].playerScores.map(x => x.playerId);
                          const isIn = lineup.includes(p.id);
                          return (
                              <button key={p.id} onClick={() => {
                                  const newList = isIn ? lineup.filter(id => id !== p.id) : [...lineup, p.id];
                                  if (newList.length >= 2 && newList.length <= 3) saveRosterChange(rosterSide!, newList);
                                  else alert("Must have 2 or 3 players.");
                              }} className={`w-full flex justify-between items-center p-3 rounded-xl border-2 transition-all ${isIn ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100 hover:border-slate-300'}`}>
                                  <span className="font-bold">{formatName(p)}</span>
                                  <span className="text-xs font-bold">{isIn ? 'Active' : 'Add'}</span>
                              </button>
                          );
                      })}
                  </div>
                  <button onClick={() => setRosterSide(null)} className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl">Cancel</button>
              </div>
          </div>,
          document.body
      )}

      {showTieBreakerSetup && createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/80 p-4">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl w-[90%] max-w-md">
                  <h2 className="text-xl font-bold mb-4 text-center">Tie Breaker Setup</h2>
                  <div className="space-y-4 mb-6">
                      <div><label className="block text-xs uppercase text-slate-500 mb-1 font-bold">Home</label><select className="w-full p-3 border rounded-lg font-bold" value={tbHomePlayerId} onChange={e => setTbHomePlayerId(e.target.value)}>{teams.home?.players.map(p => <option key={p.id} value={p.id}>{formatName(p)}</option>)}</select></div>
                      <div><label className="block text-xs uppercase text-slate-500 mb-1 font-bold">Away</label><select className="w-full p-3 border rounded-lg font-bold" value={tbAwayPlayerId} onChange={e => setTbAwayPlayerId(e.target.value)}>{teams.away?.players.map(p => <option key={p.id} value={p.id}>{formatName(p)}</option>)}</select></div>
                  </div>
                  <button onClick={startTieBreakerRound} className="w-full py-3 bg-amber-600 text-white font-bold rounded-xl">Start Extras</button>
              </div>
          </div>,
          document.body
      )}

      {showFinishModal && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl max-w-sm text-center">
                  <h2 className="text-2xl font-bold mb-4">Finish Match?</h2>
                  <div className="flex gap-3"><button onClick={() => setShowFinishModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl">Cancel</button><button onClick={confirmCompleteGame} className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl">Confirm</button></div>
              </div>
          </div>,
          document.body
      )}
    </div>
  );
};