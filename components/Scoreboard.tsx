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

  const [showTieBreakerSetup, setShowTieBreakerSetup] = useState(false);
  const [tbHomePlayerId, setTbHomePlayerId] = useState('');
  const [tbAwayPlayerId, setTbAwayPlayerId] = useState('');

  const [isEditingCompleted, setIsEditingCompleted] = useState(false);

  // Lineup Edit State
  const [showEditLineupModal, setShowEditLineupModal] = useState(false);
  const [editSide, setEditSide] = useState<'home' | 'away' | null>(null);
  const [tempLineup, setTempLineup] = useState<Player[]>([]);

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
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && requestWakeLock());
      return () => wakeLock?.release().catch(() => {});
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

  const openEditModal = (side: 'home' | 'away') => {
      setEditSide(side);
      const team = side === 'home' ? teams.home! : teams.away!;
      const inningData = side === 'home' ? currentInning.home : currentInning.away;
      const lineupIds = inningData.playerScores.map(ps => ps.playerId).filter(id => !id.startsWith('ghost-'));
      const currentLineup = lineupIds.map(id => [...team.players, ...(team.subs || [])].find(p => p.id === id)).filter(Boolean) as Player[];
      setTempLineup(currentLineup);
      setShowEditLineupModal(true);
  };

  const saveNewLineup = async () => {
      if (!match || !editSide) return;
      setLoading(true);
      try {
          const updated = await storage.updateMatchLineup(match.id, editSide === 'home' ? match.homeTeamId : match.awayTeamId, activeInningIdx, tempLineup.map(p => p.id));
          setMatch(updated);
          setShowEditLineupModal(false);
          setEditSide(null);
      } catch (e) { alert("Failed to update lineup"); }
      setLoading(false);
  };

  const startTieBreakerRound = async () => {
      if (!teams.home || !teams.away || !tbHomePlayerId || !tbAwayPlayerId) return;
      let nextLimit = 5;
      let roundNum = 1;
      if (match.tieBreaker && match.tieBreaker.length > 0) {
          const lastRound = match.tieBreaker[match.tieBreaker.length - 1];
          roundNum = lastRound.roundNumber + 1;
          nextLimit = lastRound.pitchLimit === 5 ? 3 : 1;
      }
      const newRound: TieBreakerRound = { roundNumber: roundNum, pitchLimit: nextLimit, homePlayerId: tbHomePlayerId, awayPlayerId: tbAwayPlayerId, homeScores: Array(nextLimit).fill(null), awayScores: Array(nextLimit).fill(null) };
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
      await storage.updateMatch(newMatch).catch(err => console.error(err));
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
    let shouldOpenFinishModal = false;

    if (isFinalInning && side === 'home' && !match.isComplete) {
        const isLastPlayer = lineupIdx === teamData.playerScores.length - 1;
        const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
        if (isLastPlayer && pitchIdx === totalPitches - 1) {
            const gameHomeTotal = calculateTeamGameTotal('home', newMatch);
            const gameAwayTotal = calculateTeamGameTotal('away', newMatch);
            if (gameHomeTotal === gameAwayTotal) shouldOpenTieBreaker = true;
            else shouldOpenFinishModal = true;
        }
    }
    let nextCell = null;
    if (!isEdit && !shouldOpenTieBreaker && !shouldOpenFinishModal) {
        if (pitchIdx < teamData.playerScores[lineupIdx].pitches.length - 1) nextCell = { side, lineupIdx, pitchIdx: pitchIdx + 1 };
    }
    setActiveCell(nextCell);
    if (shouldOpenTieBreaker) setTimeout(() => setShowTieBreakerSetup(true), 500);
    else if (shouldOpenFinishModal) setTimeout(() => setShowFinishModal(true), 500);
    else if (!isEdit && activeInningIdx < 5 && !match.isComplete) {
        const currentInningData = newMatch.innings[activeInningIdx];
        if (currentInningData.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null)) && currentInningData.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null))) {
             setTimeout(() => { setActiveInningIdx(prev => prev < 5 ? prev + 1 : prev); setActiveCell(null); }, 700);
        }
    }
    await storage.updateMatch(newMatch).catch(err => console.error(err));
  };

  const confirmCompleteGame = async () => {
    if (isReadOnly) return;
    if (homeTotal === awayTotal) { setShowFinishModal(false); setShowTieBreakerSetup(true); return; }
    const newMatch = { ...match, isComplete: true };
    setMatch(newMatch);
    await storage.updateMatch(newMatch);
    setShowFinishModal(false);
    onExit();
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const headerClass = side === 'home' ? 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 border-red-200 dark:border-red-900' : 'bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900';
    const canEdit = !isReadOnly && !match.isComplete;

    const renderRow = (playerScore: any, lineupIdx: number, player: any) => {
         const isGhostRow = playerScore.playerId.startsWith('ghost-');
         const pitches = playerScore.pitches;
         const taken = pitches.filter((p:any) => p.points !== null).length;
         const limit = 10;
         const pitchesLeft = limit - taken;

         return (
            <tr key={playerScore.playerId} className={`hover:bg-slate-50/50 dark:hover:bg-white/5 border-b border-slate-100 dark:border-slate-800 ${isGhostRow ? 'bg-slate-50/30 dark:bg-slate-950/30' : ''}`}>
                <td className="px-2 py-2 portrait:px-1 portrait:py-1 font-medium sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[100px] portrait:max-w-[80px] sm:w-auto">
                    <div className="flex items-center gap-2 portrait:gap-1">
                        <span className={`text-[10px] portrait:text-[8px] font-bold w-5 h-5 portrait:w-4 portrait:h-4 rounded-full flex items-center justify-center shrink-0 ${isGhostRow ? 'bg-slate-300 dark:bg-slate-800 text-slate-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                            {lineupIdx + 1}
                        </span>
                        <span className="truncate text-sm portrait:text-xs font-bold text-slate-900 dark:text-white">
                            {isGhostRow ? <span className="italic text-slate-400">Ghost Player</span> : formatName(player)}
                        </span>
                    </div>
                </td>
                <td className="px-2 py-2 portrait:px-1 portrait:py-1">
                    <div className="flex gap-2 portrait:gap-1 justify-start overflow-x-auto scrollbar-hide py-1">
                        {pitches.map((pitch: any, idx: number) => {
                            const isEditing = activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === idx;
                            return (
                                <ScoreInput key={idx} pitchNumber={idx+1} value={pitch.points} pitchesRemaining={pitchesLeft} readOnly={isReadOnly || (match.isComplete && !isEditingCompleted)} isEditing={isEditing} onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, lineupIdx, idx, val)} onUndo={idx > 0 ? () => handleUndo(side, lineupIdx, idx) : undefined} />
                            );
                        })}
                    </div>
                </td>
                <td className="px-3 py-2 portrait:px-1 portrait:py-1 text-center font-bold tabular-nums text-slate-800 dark:text-white border-l border-slate-200 dark:border-slate-700 text-sm portrait:text-xs">{pitches.reduce((s:number,p:any)=>s+(p.points||0),0)}</td>
            </tr>
         );
    };

    return (
      <div className="mb-4 sm:mb-8">
        <div className={`p-3 rounded-t-lg border-b flex justify-between items-end shadow-sm ${headerClass}`}>
          <div className="flex items-center gap-3 portrait:gap-2">
             <div>
                <span className="text-xs portrait:text-[10px] font-bold uppercase opacity-80 tracking-wider">Lineup</span>
                <h3 className="text-xl portrait:text-sm font-black leading-tight truncate max-w-[120px] portrait:max-w-[80px] sm:max-w-none">{team.name}</h3>
             </div>
             {canEdit && <button onClick={() => openEditModal(side)} className="bg-white/80 dark:bg-slate-800 text-slate-600 px-3 py-1.5 portrait:px-2 portrait:py-1 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 shadow-sm transition-colors hover:bg-white">Edit</button>}
          </div>
          <div className="text-2xl portrait:text-lg font-bold">{calculateTeamInningTotal(side, currentInning)} <span className="text-sm portrait:text-[10px] font-normal opacity-60">pts</span></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-b-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-x-auto relative">
          <table className="w-full">
            <tbody>
                {inningData.playerScores.map((ps, idx) => {
                    const isGhost = ps.playerId.startsWith('ghost-');
                    const player = isGhost ? undefined : [...team.players, ...(team.subs || [])].find(p=>p.id===ps.playerId);
                    return renderRow(ps, idx, player);
                })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const isFinalizingReady = activeInningIdx === 5 && match.innings[5].home.playerScores.every(p => p.pitches.every(pt => pt.points !== null));

  return (
    <div className="min-h-full w-full bg-transparent pb-24 relative">
      <header className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 sticky top-0 z-[50] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 portrait:py-2 portrait:px-1 flex justify-between items-center gap-4 portrait:gap-2">
          <div className="flex gap-8 portrait:gap-2 items-center flex-1">
            <div className="text-center flex-1 min-w-0">
                <div className="text-xs portrait:text-[10px] text-slate-500 uppercase font-bold">Away</div>
                <div className="text-xl portrait:text-[10px] font-bold text-blue-700 dark:text-blue-400 truncate">{teams.away.name}</div>
                <div className="text-2xl portrait:text-xl font-black dark:text-white tabular-nums">{awayTotal}</div>
            </div>
            <div className="text-slate-300 text-xl portrait:text-base font-light">vs</div>
            <div className="text-center flex-1 min-w-0">
                <div className="text-xs portrait:text-[10px] text-slate-500 uppercase font-bold">Home</div>
                <div className="text-xl portrait:text-[10px] font-bold text-red-700 dark:text-red-400 truncate">{teams.home.name}</div>
                <div className="text-2xl portrait:text-xl font-black dark:text-white tabular-nums">{homeTotal}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 portrait:gap-1 shrink-0">
            {!isReadOnly && match.isComplete && (
                <button onClick={() => setIsEditingCompleted(!isEditingCompleted)} className={`text-sm portrait:text-[10px] font-bold py-2 px-3 portrait:px-1.5 portrait:py-1 rounded-lg border transition-colors ${isEditingCompleted ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 border-slate-300'}`}>
                    {isEditingCompleted ? 'Lock' : 'Edit'}
                </button>
            )}
            <button onClick={onExit} className="text-sm portrait:text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 py-2 px-3 portrait:px-1.5 portrait:py-1 rounded-lg transition-colors">Exit</button>
          </div>
        </div>
        <div className="flex overflow-x-auto border-t border-slate-100 dark:border-slate-800">
            {match.innings.map((ing, idx) => (
                <button key={ing.number} onClick={() => setActiveInningIdx(idx)} className={`flex-1 py-3 portrait:py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${idx === activeInningIdx ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'border-transparent text-slate-400 hover:bg-slate-50'}`}>Inn {ing.number}</button>
            ))}
            {(match.tieBreaker?.length ?? 0) > 0 && <button onClick={() => setActiveInningIdx(6)} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeInningIdx === 6 ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-transparent text-amber-500'}`}>Extra</button>}
        </div>
      </header>
      
      <main className="max-w-5xl mx-auto p-4 portrait:p-2">
          {isExtraInnings ? null : <>{renderTeamSection('away', teams.away)}{renderTeamSection('home', teams.home)}</>}
          
          {!isReadOnly && isFinalizingReady && !match.isComplete && (
              <div className="mt-12 flex justify-center">
                  <button onClick={() => setShowFinishModal(true)} className="px-12 py-5 bg-green-600 hover:bg-green-700 text-white font-black rounded-2xl shadow-xl shadow-green-900/30 transform hover:scale-105 active:scale-95 transition-all uppercase tracking-widest text-lg">Finalize Match</button>
              </div>
          )}
      </main>

      {/* Edit Lineup Modal */}
      {showEditLineupModal && editSide && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4" onClick={() => setShowEditLineupModal(false)}>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h2 className="text-2xl font-bold mb-6 flex justify-between items-center">
                      <span>Edit {editSide === 'home' ? teams.home!.name : teams.away!.name} Lineup</span>
                      <span className="text-xs font-bold bg-slate-100 px-2 py-1 rounded text-slate-500">Inning {activeInningIdx + 1}</span>
                  </h2>

                  <div className="space-y-3 mb-8">
                      {tempLineup.map((p, idx) => (
                          <div key={p.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                              <span className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-950 flex items-center justify-center font-bold text-slate-500">{idx+1}</span>
                              <span className="flex-1 font-bold text-slate-800 dark:text-white">{formatName(p)}</span>
                              <div className="flex gap-1">
                                  <button onClick={() => {
                                      const next = [...tempLineup];
                                      if(idx > 0) { [next[idx], next[idx-1]] = [next[idx-1], next[idx]]; setTempLineup(next); }
                                  }} className="p-2 hover:bg-slate-200 rounded">▲</button>
                                  <button onClick={() => {
                                      const next = [...tempLineup];
                                      if(idx < next.length-1) { [next[idx], next[idx+1]] = [next[idx+1], next[idx]]; setTempLineup(next); }
                                  }} className="p-2 hover:bg-slate-200 rounded">▼</button>
                              </div>
                              <button onClick={() => setTempLineup(tempLineup.filter(x => x.id !== p.id))} className="text-red-500 p-2 hover:bg-red-50 rounded">Remove</button>
                          </div>
                      ))}
                      {tempLineup.length < 3 && (
                          <div className="pt-4 border-t border-dashed">
                              <p className="text-xs text-slate-400 font-bold uppercase mb-2">Available to Add</p>
                              <div className="flex flex-wrap gap-2">
                                  {[...(editSide === 'home' ? teams.home!.players : teams.away!.players), ...(editSide === 'home' ? teams.home!.subs ?? [] : teams.away!.subs ?? []).filter(x => x.id !== undefined)]
                                    .filter(x => !tempLineup.find(l => l.id === x.id))
                                    .map(p => (
                                        <button key={p.id} onClick={() => setTempLineup([...tempLineup, p])} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold border border-blue-200 hover:bg-blue-100 transition-colors">
                                            + {formatName(p)}
                                        </button>
                                    ))
                                  }
                              </div>
                          </div>
                      )}
                  </div>

                  <div className="flex gap-4">
                      <button onClick={() => setShowEditLineupModal(false)} className="flex-1 py-4 bg-slate-100 rounded-xl font-bold text-slate-600">Cancel</button>
                      <button onClick={saveNewLineup} className="flex-1 py-4 bg-blue-600 rounded-xl font-bold text-white shadow-lg">Confirm Lineup</button>
                  </div>
              </div>
          </div>,
          document.body
      )}

      {showFinishModal && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-2xl w-full max-w-sm text-center">
                  <h2 className="text-2xl font-bold mb-4">Finalize Game?</h2>
                  <p className="text-slate-500 mb-8">Scoreboard will be locked and league standings updated.</p>
                  <div className="flex gap-4">
                      <button onClick={() => setShowFinishModal(false)} className="flex-1 py-4 bg-slate-100 rounded-xl font-bold text-slate-600">Back</button>
                      <button onClick={confirmCompleteGame} className="flex-1 py-4 bg-green-600 rounded-xl font-bold text-white shadow-lg shadow-green-900/30">Finish</button>
                  </div>
              </div>
          </div>,
          document.body
      )}
    </div>
  );
};