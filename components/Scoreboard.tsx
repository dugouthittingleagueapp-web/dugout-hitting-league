import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Match, Inning, Team, TieBreakerRound, Player } from '../types';
import * as storage from '../services/storageService';
import { ScoreInput } from './ScoreInput';
import { useVoiceScoring, triggerHaptic, unlockAudio } from '../hooks/useVoiceScoring';

interface ScoreboardProps {
  matchId: string;
  onExit: () => void;
  isReadOnly?: boolean;
  userRole?: 'fan' | 'umpire' | 'admin';
  onPlayerClick?: (playerName: string) => void;
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

export const Scoreboard: React.FC<ScoreboardProps> = ({ matchId, onExit, isReadOnly = false, userRole = 'fan', onPlayerClick }) => {
  const [match, setMatch] = useState<Match | null>(null);
  const [teams, setTeams] = useState<{ home?: Team, away?: Team }>({});
  const [activeInningIdx, setActiveInningIdx] = useState(0); 
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voicePermissionError, setVoicePermissionError] = useState<string | null>(null);
  
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number } | null>(null);

  // Tie Breaker Setup State
  const [showTieBreakerSetup, setShowTieBreakerSetup] = useState(false);
  const [tbHomePlayerId, setTbHomePlayerId] = useState('');
  const [tbAwayPlayerId, setTbAwayPlayerId] = useState('');

  // Roster Editing State
  const [rosterSide, setRosterSide] = useState<'home' | 'away' | null>(null);
  const [newSubNameInput, setNewSubNameInput] = useState('');

  const activeInningRef = useRef(activeInningIdx);
  const lastLiveInningRef = useRef<number>(-1);

  useEffect(() => {
      activeInningRef.current = activeInningIdx;
  }, [activeInningIdx]);

  // Guard against accidental exits via browser back button/gestures during live scoring
  useEffect(() => {
      const handleBackAttempt = () => {
          if (!isReadOnly && userRole !== 'fan' && match && !match.isComplete) {
              setShowExitConfirmModal(true);
          }
      };
      window.addEventListener('dugout:umpire-back-attempt', handleBackAttempt);
      return () => {
          window.removeEventListener('dugout:umpire-back-attempt', handleBackAttempt);
      };
  }, [isReadOnly, userRole, match]);

  const handleExitRequest = () => {
      if (!isReadOnly && userRole !== 'fan' && match && !match.isComplete) {
          setShowExitConfirmModal(true);
      } else {
          onExit();
      }
  };

  const formatName = (p: { name: string, lastName?: string } | undefined) => {
      if (!p) return 'Unknown';
      return `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;
  };

  const loadMatchData = async () => {
      const m = await storage.getMatch(matchId);
      if (m) {
        const allTeams = await storage.getAllTeams();
        let home = allTeams.find(t => t.id === m.homeTeamId);
        let away = allTeams.find(t => t.id === m.awayTeamId);

        // Offline team resolution fallback from localStorage
        if (!home && typeof window !== 'undefined') {
            try {
                const cachedHome = localStorage.getItem(`dugout_team_${m.homeTeamId}`);
                if (cachedHome) home = JSON.parse(cachedHome);
            } catch (e) {}
        }
        if (!away && typeof window !== 'undefined') {
            try {
                const cachedAway = localStorage.getItem(`dugout_team_${m.awayTeamId}`);
                if (cachedAway) away = JSON.parse(cachedAway);
            } catch (e) {}
        }

        // Ensure home and away teams are cached for offline mode
        if (home && typeof window !== 'undefined') {
            try { localStorage.setItem(`dugout_team_${home.id}`, JSON.stringify(home)); } catch (e) {}
        }
        if (away && typeof window !== 'undefined') {
            try { localStorage.setItem(`dugout_team_${away.id}`, JSON.stringify(away)); } catch (e) {}
        }

        setMatch(m);
        setTeams({ home, away });
        
        if (home && !tbHomePlayerId && home.players.length > 0) setTbHomePlayerId(home.players[0].id);
        if (away && !tbAwayPlayerId && away.players.length > 0) setTbAwayPlayerId(away.players[0].id);

        if (!isReadOnly && !m.isComplete) {
            try {
                if (typeof window !== 'undefined') localStorage.setItem('dugout_active_match_id', m.id);
            } catch (e) {}
        }

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

  useEffect(() => {
      const handleOnline = () => {
          storage.syncOfflineData();
      };
      window.addEventListener('online', handleOnline);
      return () => window.removeEventListener('online', handleOnline);
  }, []);

  const calculateTeamInningTotal = (side: 'home' | 'away', inning?: Inning) => {
    if (!inning) return 0;
    const teamData = side === 'home' ? inning.home : inning.away;
    if (!teamData?.playerScores) return 0;
    return teamData.playerScores.reduce((sum, player) => sum + player.pitches.reduce((pSum, pitch) => pSum + (pitch.points || 0), 0), 0);
  };

  const calculateTeamGameTotal = (side: 'home' | 'away', matchData?: Match | null) => {
    const target = matchData || match;
    if (!target?.innings) return 0;
    const baseScore = target.innings.reduce((sum, inning) => sum + calculateTeamInningTotal(side, inning), 0);
    let tieScore = 0;
    if (target.tieBreaker && Array.isArray(target.tieBreaker)) {
        target.tieBreaker.forEach(round => {
            const scores = side === 'home' ? round.homeScores : round.awayScores;
            if (Array.isArray(scores)) {
                tieScore += scores.reduce<number>((a, b) => (a || 0) + (b || 0), 0);
            }
        });
    }
    return baseScore + tieScore;
  };

  const startTieBreakerRound = async () => {
      if (!match || !teams.home || !teams.away || !tbHomePlayerId || !tbAwayPlayerId) return;
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
      const updatedMatch: Match = JSON.parse(JSON.stringify(match));
      if (!updatedMatch.tieBreaker) updatedMatch.tieBreaker = [];
      updatedMatch.tieBreaker.push(newRound);
      updatedMatch.isComplete = false;
      setMatch(updatedMatch);
      await storage.updateMatch(updatedMatch);
      setShowTieBreakerSetup(false);
      setActiveInningIdx(6);
  };

  const handleUndo = async (side: 'home' | 'away', lineupIdx: number, currentPitchIdx: number, roundIdx?: number) => {
      if (!match) return;
      const prevPitchIdx = currentPitchIdx - 1;
      if (prevPitchIdx < 0) return;
      const newMatch: Match = JSON.parse(JSON.stringify(match));
      if (roundIdx !== undefined && newMatch.tieBreaker) {
          const round = newMatch.tieBreaker[roundIdx];
          if (round) {
              if (side === 'home') round.homeScores[prevPitchIdx] = null;
              else round.awayScores[prevPitchIdx] = null;
              setActiveCell({ side, lineupIdx: 0, pitchIdx: prevPitchIdx, roundIdx });
          }
      } else {
          const inning = newMatch.innings?.[activeInningIdx];
          if (inning) {
              const teamData = side === 'home' ? inning.home : inning.away;
              if (teamData?.playerScores?.[lineupIdx]?.pitches?.[prevPitchIdx]) {
                  teamData.playerScores[lineupIdx].pitches[prevPitchIdx].points = null;
                  setActiveCell({ side, lineupIdx, pitchIdx: prevPitchIdx });
              }
          }
      }
      setMatch(newMatch);
      await storage.updateMatch(newMatch).catch(err => console.error("Undo failed", err));
  };

  const handleScoreUpdate = async (
    side: 'home' | 'away', 
    lineupIdx: number, 
    pitchIdx: number, 
    val: number,
    targetInningIdx: number = activeInningIdx
  ) => {
    if (isReadOnly || !match) return;
    const inning = match.innings?.[targetInningIdx];
    if (!inning) return;
    const teamData = side === 'home' ? inning.home : inning.away;
    if (!teamData?.playerScores?.[lineupIdx]?.pitches?.[pitchIdx]) return;
    const existingValue = teamData.playerScores[lineupIdx].pitches[pitchIdx].points;
    const isEdit = existingValue !== null;
    const newMatch: Match = JSON.parse(JSON.stringify(match));
    const curInning = newMatch.innings[targetInningIdx];
    const curTeamData = side === 'home' ? curInning.home : curInning.away;
    curTeamData.playerScores[lineupIdx].pitches[pitchIdx].points = val;
    setMatch(newMatch); 
    
    // Automated Completion Flow Check
    const totalPitches = teamData.playerScores[lineupIdx].pitches.length;
    const isLastPitchOfRegulation = targetInningIdx === 5 && side === 'home' && lineupIdx === teamData.playerScores.length - 1 && pitchIdx === totalPitches - 1;

    if (isLastPitchOfRegulation && !isEdit) {
        const hT = calculateTeamGameTotal('home', newMatch);
        const aT = calculateTeamGameTotal('away', newMatch);
        if (hT === aT) {
            setTimeout(() => setShowTieBreakerSetup(true), 500);
        } else {
            setTimeout(() => setShowFinishModal(true), 500);
        }
        setActiveCell(null);
    } else {
        let nextCell: { side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number } | null = null;
        if (activeCell) {
            if (pitchIdx < totalPitches - 1) {
                nextCell = { side, lineupIdx, pitchIdx: pitchIdx + 1 };
            } else if (lineupIdx < curTeamData.playerScores.length - 1) {
                nextCell = { side, lineupIdx: lineupIdx + 1, pitchIdx: 0 };
            } else if (side === 'away') {
                nextCell = { side: 'home', lineupIdx: 0, pitchIdx: 0 };
            } else if (targetInningIdx < 5) {
                setActiveInningIdx(prev => prev + 1);
                nextCell = { side: 'away', lineupIdx: 0, pitchIdx: 0 };
            }
        }
        setActiveCell(nextCell);

        if (!isEdit && targetInningIdx < 5 && !match.isComplete) {
            const curIng = newMatch.innings[targetInningIdx];
            if (curIng.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null)) && 
                curIng.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null))) {
                 setTimeout(() => { setActiveInningIdx(p => (p < 5 ? p + 1 : p)); setActiveCell(null); }, 700);
            }
        }
    }
    await storage.updateMatch(newMatch).catch(err => console.error(err));
  };

  const confirmCompleteGame = async () => {
    if (isReadOnly || !match) return;
    const hT = calculateTeamGameTotal('home', match);
    const aT = calculateTeamGameTotal('away', match);
    if (hT === aT) {
        setShowFinishModal(false);
        setShowTieBreakerSetup(true);
        return;
    }
    const newMatch = { ...match, isComplete: true };
    setMatch(newMatch);
    await storage.updateMatch(newMatch);
    try {
        if (typeof window !== 'undefined') localStorage.removeItem('dugout_active_match_id');
    } catch (e) {}
    setShowFinishModal(false);
    onExit();
  };

  const handleToggleComplete = async () => {
    if (!match || userRole !== 'admin') return;
    const updated = { ...match, isComplete: !match.isComplete };
    setMatch(updated);
    await storage.updateMatch(updated);
  };

  const handleTieBreakerScore = async (roundIdx: number, side: 'home'|'away', pitchIdx: number, val: number) => {
      if(!match?.tieBreaker) return;
      const newMatch: Match = JSON.parse(JSON.stringify(match));
      const cur = newMatch.tieBreaker?.[roundIdx];
      if (!cur) return;
      const limit = cur.pitchLimit;
      const existing = side === 'home' ? cur.homeScores[pitchIdx] : cur.awayScores[pitchIdx];
      const isEdit = existing !== null;
      if (side === 'home') cur.homeScores[pitchIdx] = val; else cur.awayScores[pitchIdx] = val;
      setMatch(newMatch);
      
      // Auto-Completion for tie breakers
      const isFinalPitchOfRound = side === 'home' && pitchIdx === limit - 1;
      if (isFinalPitchOfRound && !isEdit) {
          const hT = calculateTeamGameTotal('home', newMatch);
          const aT = calculateTeamGameTotal('away', newMatch);
          if (hT !== aT) {
              setTimeout(() => setShowFinishModal(true), 500);
          }
          setActiveCell(null);
      } else {
          let next = null;
          if (!isEdit && pitchIdx < limit - 1) next = { side, lineupIdx: 0, pitchIdx: pitchIdx + 1, roundIdx };
          setActiveCell(next);
      }
      await storage.updateMatch(newMatch);
  };

  const getFirstUnscoredCell = (): { side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number; inningIdx?: number } | null => {
    if (activeCell) return { ...activeCell, inningIdx: activeCell.roundIdx !== undefined ? 6 : activeInningIdx };
    if (activeInningIdx === 6 && match?.tieBreaker && match.tieBreaker.length > 0) {
      const roundIdx = match.tieBreaker.length - 1;
      const round = match.tieBreaker[roundIdx];
      const aIdx = round.awayScores.findIndex(s => s === null);
      if (aIdx !== -1) return { side: 'away' as const, lineupIdx: 0, pitchIdx: aIdx, roundIdx, inningIdx: 6 };
      const hIdx = round.homeScores.findIndex(s => s === null);
      if (hIdx !== -1) return { side: 'home' as const, lineupIdx: 0, pitchIdx: hIdx, roundIdx, inningIdx: 6 };
      return null;
    }
    const currentIng = match?.innings[activeInningIdx];
    if (currentIng) {
      for (let l = 0; l < currentIng.away.playerScores.length; l++) {
        const pIdx = currentIng.away.playerScores[l].pitches.findIndex(p => p.points === null);
        if (pIdx !== -1) return { side: 'away' as const, lineupIdx: l, pitchIdx: pIdx, inningIdx: activeInningIdx };
      }
      for (let l = 0; l < currentIng.home.playerScores.length; l++) {
        const pIdx = currentIng.home.playerScores[l].pitches.findIndex(p => p.points === null);
        if (pIdx !== -1) return { side: 'home' as const, lineupIdx: l, pitchIdx: pIdx, inningIdx: activeInningIdx };
      }
    }
    // Search remaining regulation innings so hands-free scoring never stalls at end of an inning
    if (match) {
      for (let i = activeInningIdx + 1; i < 6; i++) {
        const ing = match.innings[i];
        if (!ing) continue;
        for (let l = 0; l < ing.away.playerScores.length; l++) {
          const pIdx = ing.away.playerScores[l].pitches.findIndex(p => p.points === null);
          if (pIdx !== -1) {
            return { side: 'away' as const, lineupIdx: l, pitchIdx: pIdx, inningIdx: i };
          }
        }
        for (let l = 0; l < ing.home.playerScores.length; l++) {
          const pIdx = ing.home.playerScores[l].pitches.findIndex(p => p.points === null);
          if (pIdx !== -1) {
            return { side: 'home' as const, lineupIdx: l, pitchIdx: pIdx, inningIdx: i };
          }
        }
      }
    }
    return null;
  };

  const getTargetDescription = () => {
    const target = getFirstUnscoredCell();
    if (!target) {
      return `All pitches scored. Click any pitch cell to edit with voice.`;
    }
    if (target.roundIdx !== undefined && match?.tieBreaker) {
      const round = match.tieBreaker[target.roundIdx];
      const team = target.side === 'home' ? teams.home : teams.away;
      return `Extras R${round.roundNumber} • ${target.side === 'home' ? 'Home' : 'Away'} (${team?.name || ''}), Pitch #${target.pitchIdx + 1}`;
    }
    const targetInningIdx = target.inningIdx ?? activeInningIdx;
    const currentIng = match?.innings[targetInningIdx];
    if (currentIng) {
      const team = target.side === 'home' ? teams.home : teams.away;
      const teamData = target.side === 'home' ? currentIng.home : currentIng.away;
      const playerScore = teamData.playerScores[target.lineupIdx];
      const player = [...(team?.players || []), ...(team?.subs || [])].find(p => p.id === playerScore?.playerId);
      const pName = player ? formatName(player) : (playerScore ? `Batter #${target.lineupIdx + 1}` : '');
      const teamLabel = target.side === 'home' ? 'Home' : 'Away';
      return `Inning ${currentIng.number} • ${teamLabel} (${pName}), Pitch #${target.pitchIdx + 1}`;
    }
    return null;
  };

  const handleVoiceScore = (val: number) => {
    if (isReadOnly || (match?.isComplete && userRole !== 'admin')) return;
    const target = getFirstUnscoredCell();
    if (!target) return;
    if (target.roundIdx !== undefined) {
      if (activeInningIdx !== 6) setActiveInningIdx(6);
      handleTieBreakerScore(target.roundIdx, target.side, target.pitchIdx, val);
    } else {
      const targetInning = target.inningIdx ?? activeInningIdx;
      if (targetInning !== activeInningIdx) {
        setActiveInningIdx(targetInning);
      }
      handleScoreUpdate(target.side, target.lineupIdx, target.pitchIdx, val, targetInning);
    }
  };

  const handleVoiceUndo = () => {
    if (isReadOnly || (match?.isComplete && userRole !== 'admin')) return;
    if (activeCell) {
      handleUndo(activeCell.side, activeCell.lineupIdx, activeCell.pitchIdx, activeCell.roundIdx);
      return;
    }
    if (activeInningIdx === 6 && match?.tieBreaker && match.tieBreaker.length > 0) {
      const roundIdx = match.tieBreaker.length - 1;
      const round = match.tieBreaker[roundIdx];
      for (let p = round.homeScores.length - 1; p >= 0; p--) {
        if (round.homeScores[p] !== null) {
          handleUndo('home', 0, p + 1, roundIdx);
          return;
        }
      }
      for (let p = round.awayScores.length - 1; p >= 0; p--) {
        if (round.awayScores[p] !== null) {
          handleUndo('away', 0, p + 1, roundIdx);
          return;
        }
      }
      return;
    }
    const currentIng = match?.innings[activeInningIdx];
    if (!currentIng) return;
    for (let l = currentIng.home.playerScores.length - 1; l >= 0; l--) {
      const pitches = currentIng.home.playerScores[l].pitches;
      for (let p = pitches.length - 1; p >= 0; p--) {
        if (pitches[p].points !== null) {
          handleUndo('home', l, p + 1);
          return;
        }
      }
    }
    for (let l = currentIng.away.playerScores.length - 1; l >= 0; l--) {
      const pitches = currentIng.away.playerScores[l].pitches;
      for (let p = pitches.length - 1; p >= 0; p--) {
        if (pitches[p].points !== null) {
          handleUndo('away', l, p + 1);
          return;
        }
      }
    }
  };

  const handleToggleVoice = () => {
    triggerHaptic('toggle');
    unlockAudio();
    if (voiceEnabled) {
      setVoiceEnabled(false);
      setVoicePermissionError(null);
      return;
    }

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setVoicePermissionError("Voice recognition is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Safari.");
      return;
    }

    setVoicePermissionError(null);
    setVoiceEnabled(true);
  };

  const { isListening, lastHeard, supported: voiceSupported, error: voiceHookError } = useVoiceScoring({
    enabled: voiceEnabled && !isReadOnly && userRole !== 'fan' && (!match?.isComplete || userRole === 'admin'),
    onScore: handleVoiceScore,
    onUndo: handleVoiceUndo
  });

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400 font-bold font-sans">Loading Match Data...</div>;
  if (!match || !teams.home || !teams.away) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center font-sans">
        <p className="text-slate-600 dark:text-slate-300 font-bold mb-4">Unable to load match details or teams.</p>
        <button onClick={onExit} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
          Return to Dashboard
        </button>
      </div>
    );
  }

  const currentInning = match.innings[activeInningIdx] || match.innings[0];
  const isExtraInnings = activeInningIdx === 6;
  const homeTotal = calculateTeamGameTotal('home', match);
  const awayTotal = calculateTeamGameTotal('away', match);

  const saveRosterChange = async (side: 'home' | 'away', playerIds: string[]) => {
      if (isReadOnly || !match) return;
      setLoading(true);
      const newMatch = JSON.parse(JSON.stringify(match)); // Deep clone for safe mutation
      
      const updateInningStructure = (ing: Inning, hIds: string[], aIds: string[]): Inning => {
          const hC = hIds.length;
          const aC = aIds.length;
          let hP = 10, aP = 10;
          
          // Apply format shifts: 3v2 or 2v3 = Ghost Mode (15 pitches for the short side)
          if (hC === 2 && aC === 3) hP = 15;
          else if (aC === 2 && hC === 3) aP = 15;

          const syncScores = (existingScores: any, newIds: string[], pitchCount: number) => {
              return newIds.map(id => {
                  const found = existingScores.playerScores.find((p: any) => p.playerId === id);
                  if (found) {
                      const curLen = found.pitches.length;
                      if (curLen === pitchCount) return found;
                      if (curLen < pitchCount) {
                          return { ...found, pitches: [...found.pitches, ...Array(pitchCount - curLen).fill(null).map(() => ({ points: null }))] };
                      }
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

      const currentHomeLineup = side === 'home' ? playerIds : newMatch.innings[activeInningIdx].home.playerScores.map((p:any) => p.playerId);
      const currentAwayLineup = side === 'away' ? playerIds : newMatch.innings[activeInningIdx].away.playerScores.map((p:any) => p.playerId);

      for (let i = activeInningIdx; i < 6; i++) {
          newMatch.innings[i] = updateInningStructure(newMatch.innings[i], currentHomeLineup, currentAwayLineup);
      }

      setMatch(newMatch);
      await storage.updateMatch(newMatch);
      setRosterSide(null);
      setLoading(false);
  };

  const handleAddManualSub = async () => {
    if (!newSubNameInput.trim() || !rosterSide) return;
    const currentTeam = rosterSide === 'home' ? teams.home : teams.away;
    if (!currentTeam) return;

    setLoading(true);
    const newPlayer: Player = { id: storage.generateUUID(), name: newSubNameInput.trim() };
    const updatedTeam: Team = { 
        ...currentTeam, 
        subs: [...(currentTeam.subs || []), newPlayer] 
    };

    try {
        await storage.updateTeam(updatedTeam);
        setTeams(prev => ({ ...prev, [rosterSide]: updatedTeam }));
        
        const lineup = currentInning[rosterSide].playerScores.map(x => x.playerId);
        const newList = [...lineup, newPlayer.id];
        
        if (newList.length >= 2 && newList.length <= 3) {
            setNewSubNameInput('');
            await saveRosterChange(rosterSide, newList);
        } else {
            alert("Roster limit reached (3 max). Player saved as sub.");
            setNewSubNameInput('');
            setLoading(false);
        }
    } catch (e) {
        alert("Failed to save sub");
        setLoading(false);
    }
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const headerClass = side === 'home' 
        ? 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 border-red-200 dark:border-red-900' 
        : 'bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900';
    
    const isTwoPlayerGhostMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;
    const canEdit = !isReadOnly && (!match.isComplete || userRole === 'admin');

    const findPlayer = (id: string) => [...team.players, ...(team.subs || [])].find(p => p.id === id);

    const renderRow = (playerScore: any, lineupIdx: number, player: any, pitchStartIndex: number, pitchEndIndex: number, isGhostRow = false) => {
         const visiblePitches = playerScore.pitches.slice(pitchStartIndex, pitchEndIndex);
         const rowTotal = visiblePitches.reduce((sum: number, p: any) => sum + (p.points || 0), 0);
         const pitchesLeft = isTwoPlayerGhostMode ? 15 - playerScore.pitches.filter((p:any) => p.points !== null).length : playerScore.pitches.length - playerScore.pitches.filter((p:any) => p.points !== null).length;

         return (
            <tr key={`${playerScore.playerId}-${isGhostRow ? 'ghost' : 'norm'}`} className="hover:bg-slate-50/50 dark:hover:bg-white/5 border-b border-slate-100 dark:border-slate-800">
                <td className="px-0.5 sm:px-2 py-1 sm:py-2 font-medium text-slate-700 dark:text-slate-200 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto max-w-[120px]">
                    <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                        <span className={`text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 font-sans ${isGhostRow ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-400'}`}>{isGhostRow ? '3' : lineupIdx + 1}</span>
                        <span className="truncate text-[10px] sm:text-sm font-sans text-slate-900 dark:text-slate-100 font-bold block flex-1">
                          {isGhostRow ? (
                            <span className="italic text-slate-400">Ghost</span>
                          ) : onPlayerClick ? (
                            <button
                              type="button"
                              onClick={() => onPlayerClick(formatName(player))}
                              className="text-left font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer truncate max-w-full transition-colors"
                              title="View career batting record"
                            >
                              {formatName(player)}
                            </button>
                          ) : (
                            formatName(player)
                          )}
                        </span>
                    </div>
                </td>
                <td className="px-0.5 sm:px-2 py-1 sm:py-2">
                    <div className="flex w-full landscape:justify-between gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto">
                        {visiblePitches.map((pitch: any, idx: number) => {
                            const realIdx = pitchStartIndex + idx;
                            return (
                                <ScoreInput key={realIdx} pitchNumber={isGhostRow ? pitchStartIndex+idx+1 : realIdx+1} value={pitch.points} pitchesRemaining={pitchesLeft} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === realIdx} onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: realIdx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, lineupIdx, realIdx, val)} onUndo={realIdx > 0 ? () => handleUndo(side, lineupIdx, realIdx) : undefined} voiceEnabled={voiceEnabled} onToggleVoice={handleToggleVoice} lastHeard={lastHeard} />
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
                  <>{renderRow(inningData.playerScores[0], 0, findPlayer(inningData.playerScores[0].playerId), 0, 10, false)}{renderRow(inningData.playerScores[1], 1, findPlayer(inningData.playerScores[1].playerId), 0, 10, false)}
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 bg-slate-50/30 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700">
                        <td className="px-0.5 sm:px-2 py-1 sm:py-2 sticky left-0 bg-white dark:bg-slate-900 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-slate-200 dark:border-slate-700 w-[85px] sm:w-auto">
                            <div className="flex items-center gap-1.5 sm:gap-2 w-full"><span className="text-[8px] sm:text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-sans">3</span><span className="truncate text-[10px] sm:text-sm italic text-slate-400 dark:text-slate-500 font-sans flex-1">Ghost</span></div>
                        </td>
                        <td className="px-0.5 sm:px-2 py-1 sm:py-2"><div className="flex w-full landscape:justify-between items-center gap-1 sm:gap-2 justify-start overflow-x-auto scrollbar-hide py-1 touch-auto">
                                {inningData.playerScores[0].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput key={`p1-${10+idx}`} pitchNumber={11+idx} value={pitch.points} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === 10+idx} onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, 0, 10+idx, val)} onUndo={() => handleUndo(side, 0, 10+idx)} voiceEnabled={voiceEnabled} onToggleVoice={handleToggleVoice} lastHeard={lastHeard} />
                                ))}<div className="w-px h-10 sm:h-14 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput key={`p2-${10+idx}`} pitchNumber={11+idx} value={pitch.points} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === 10+idx} onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, 1, 10+idx, val)} onUndo={() => handleUndo(side, 1, 10+idx)} voiceEnabled={voiceEnabled} onToggleVoice={handleToggleVoice} lastHeard={lastHeard} />
                                ))}</div></td>
                        <td className="px-1 sm:px-3 py-1 sm:py-2 text-center align-middle border-l border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30">
                             <div className="text-sm sm:text-base font-sans tabular-nums font-bold text-slate-800 dark:text-slate-200 w-5 sm:w-8">{inningData.playerScores[0].pitches.slice(10, 15).reduce((s,p)=>s+(p.points||0),0) + inningData.playerScores[1].pitches.slice(10, 15).reduce((s,p)=>s+(p.points||0),0)}</div>
                        </td>
                    </tr>
                  </>
              ) : (inningData.playerScores.map((playerScore, idx) => renderRow(playerScore, idx, findPlayer(playerScore.playerId), 0, playerScore.pitches.length, false)))}
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
                         <div className="bg-amber-50 dark:bg-amber-950 p-3 rounded-t-xl border border-amber-200 flex justify-between items-center"><h3 className="font-bold text-amber-800 font-sans">Extra Round {round.roundNumber}</h3>{idx === match.tieBreaker!.length - 1 && !match.isComplete && hS === aS && <button onClick={() => startTieBreakerRound()} className="bg-amber-600 text-white font-bold px-4 py-2 rounded-lg">Next Round</button>}</div>
                         <div className="bg-white dark:bg-slate-900 border-x border-b border-slate-200 rounded-b-xl overflow-x-auto"><table className="w-full"><tbody>
                             <tr className="bg-blue-50/10">
                                <td className="px-4 py-3 font-medium w-[150px]">
                                    {(() => {
                                        const pName = formatName([...(teams.away?.players || []), ...(teams.away?.subs || [])].find(p => p.id === round.awayPlayerId));
                                        return onPlayerClick ? (
                                            <button
                                                type="button"
                                                onClick={() => onPlayerClick(pName)}
                                                className="font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer text-left transition-colors"
                                                title="View career batting record"
                                            >
                                                {pName}
                                            </button>
                                        ) : (
                                            <span className="font-bold">{pName}</span>
                                        );
                                    })()}
                                </td>
                                <td className="px-2 py-3"><div className="flex gap-2">{round.awayScores.map((s, pI) => (<ScoreInput key={pI} pitchNumber={pI+1} value={s} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === 'away' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pI} onOpen={() => setActiveCell({ side: 'away', lineupIdx: 0, pitchIdx: pI, roundIdx: idx })} onClose={() => setActiveCell(null)} onChange={v => handleTieBreakerScore(idx, 'away', pI, v)} onUndo={() => handleUndo('away', 0, pI, idx)} voiceEnabled={voiceEnabled} onToggleVoice={handleToggleVoice} lastHeard={lastHeard} />))}</div></td>
                                <td className="px-4 py-3 font-bold text-xl text-center tabular-nums">{aS}</td>
                            </tr>
                            <tr className="bg-red-50/10">
                                <td className="px-4 py-3 font-medium w-[150px]">
                                    {(() => {
                                        const pName = formatName([...(teams.home?.players || []), ...(teams.home?.subs || [])].find(p => p.id === round.homePlayerId));
                                        return onPlayerClick ? (
                                            <button
                                                type="button"
                                                onClick={() => onPlayerClick(pName)}
                                                className="font-bold text-slate-900 dark:text-white hover:text-red-600 dark:hover:text-red-400 hover:underline cursor-pointer text-left transition-colors"
                                                title="View career batting record"
                                            >
                                                {pName}
                                            </button>
                                        ) : (
                                            <span className="font-bold">{pName}</span>
                                        );
                                    })()}
                                </td>
                                <td className="px-2 py-3"><div className="flex gap-2">{round.homeScores.map((s, pI) => (<ScoreInput key={pI} pitchNumber={pI+1} value={s} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === 'home' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pI} onOpen={() => setActiveCell({ side: 'home', lineupIdx: 0, pitchIdx: pI, roundIdx: idx })} onClose={() => setActiveCell(null)} onChange={v => handleTieBreakerScore(idx, 'home', pI, v)} onUndo={() => handleUndo('home', 0, pI, idx)} voiceEnabled={voiceEnabled} onToggleVoice={handleToggleVoice} lastHeard={lastHeard} />))}</div></td>
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
            {match.isComplete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black uppercase px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">FINAL</span>
                {userRole === 'admin' && (
                  <button 
                    onClick={handleToggleComplete}
                    className="text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
                    title="Re-open game to live scoring"
                  >
                    Re-open Game
                  </button>
                )}
              </div>
            ) : (
              isReadOnly && <div className="text-red-600 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider animate-pulse">LIVE</div>
            )}
            
            {!isReadOnly && userRole !== 'fan' && (!match.isComplete || userRole === 'admin') && (
              <button
                type="button"
                onClick={handleToggleVoice}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border font-bold text-xs sm:text-sm font-sans transition-all cursor-pointer shadow-sm ${
                  voiceEnabled
                    ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-emerald-500/20 ring-2 ring-emerald-400/50'
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
                title={
                  !voiceSupported 
                    ? 'Speech recognition not supported in this browser'
                    : voiceEnabled 
                      ? 'Hands-free voice scoring is ON. Speak 0, 1, 2, 3, 4, or Undo' 
                      : 'Toggle hands-free voice scoring ON (requests microphone access)'
                }
              >
                {/* Microphone SVG icon */}
                <svg className={`w-4 h-4 shrink-0 ${voiceEnabled ? 'text-white animate-pulse' : 'text-slate-500 dark:text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <span className="hidden xs:inline">Voice:</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-black uppercase ${voiceEnabled ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                  {voiceEnabled ? 'ON' : 'OFF'}
                </span>
                {voiceEnabled && lastHeard && (
                  <span className="text-[10px] bg-emerald-800/80 px-1.5 py-0.5 rounded text-emerald-100 font-bold hidden md:inline">
                    {lastHeard}
                  </span>
                )}
              </button>
            )}
            <button onClick={handleExitRequest} className="text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-300 py-1.5 sm:py-2 px-3 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">Exit</button>
          </div>
        </div>

        {/* Voice Scoring Heads-Up Display (HUD) */}
        {voiceEnabled && (
          <div className="bg-emerald-600/95 dark:bg-emerald-950/95 border-t border-b border-emerald-500/50 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm font-sans shadow-md backdrop-blur-md">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-3 w-3 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
              </span>
              <span className="font-bold shrink-0">🎙️ Voice Scoring Active</span>
              <span className="hidden sm:inline text-emerald-300">|</span>
              <span className="text-emerald-100 text-xs hidden sm:inline truncate">
                Say: <strong className="text-white">"0"</strong>, <strong className="text-white">"1"</strong>, <strong className="text-white">"2"</strong>, <strong className="text-white">"3"</strong>, <strong className="text-white">"4"</strong>, or <strong className="text-white">"Undo"</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <span className="bg-emerald-800/80 px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-100 border border-emerald-400/30">
                {getTargetDescription()}
              </span>
              {lastHeard && (
                <span className="bg-white text-emerald-900 px-2.5 py-1 rounded-lg text-xs font-black shadow-sm flex items-center gap-1">
                  Heard: {lastHeard}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Voice Permission Error Banner */}
        {(voicePermissionError || voiceHookError) && (
          <div className="bg-amber-600/95 dark:bg-amber-900/95 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm font-sans shadow-md border-t border-b border-amber-700">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-5 h-5 shrink-0 text-amber-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{voicePermissionError || voiceHookError}</span>
            </div>
            <button 
              onClick={() => setVoicePermissionError(null)} 
              className="text-xs bg-black/20 hover:bg-black/40 px-2.5 py-1 rounded font-bold cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setRosterSide(null)}>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Edit Roster: {rosterSide === 'home' ? teams.home?.name : teams.away?.name}</h3>
                  <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
                      {(() => {
                          const team = rosterSide === 'home' ? teams.home : teams.away;
                          const allPotential = [...(team?.players || []), ...(team?.subs || [])];
                          const lineup = currentInning[rosterSide!].playerScores.map(x => x.playerId);

                          return allPotential.map(p => {
                            const isIn = lineup.includes(p.id);
                            return (
                                <button key={p.id} onClick={() => {
                                    const newList = isIn ? lineup.filter(id => id !== p.id) : [...lineup, p.id];
                                    if (newList.length >= 2 && newList.length <= 3) saveRosterChange(rosterSide!, newList);
                                    else alert("Must have 2 or 3 players.");
                                }} className={`w-full flex justify-between items-center p-3 rounded-xl border-2 transition-all group ${isIn ? 'border-blue-500 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40' : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}>
                                    <span className={`font-bold transition-colors text-sm ${isIn ? 'text-blue-900 dark:text-blue-100' : 'text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-100'}`}>{formatName(p)}</span>
                                    <span className={`text-[10px] font-bold font-sans tracking-wide transition-colors ${isIn ? 'text-red-600' : 'text-blue-600'}`}>{isIn ? 'Remove' : 'Add'}</span>
                                </button>
                            );
                          });
                      })()}
                  </div>
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 mb-4">
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Register New Sub</label>
                      <div className="flex gap-2">
                          <input type="text" value={newSubNameInput} onChange={e => setNewSubNameInput(e.target.value)} placeholder="Full Name" className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white font-sans" />
                          <button onClick={handleAddManualSub} disabled={!newSubNameInput.trim()} className="bg-blue-600 text-white font-bold px-3 py-2 rounded-lg text-xs font-sans disabled:opacity-50 transition-all hover:bg-blue-700">Add</button>
                      </div>
                  </div>
                  <button onClick={() => setRosterSide(null)} className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl transition-colors hover:bg-slate-200 dark:hover:bg-slate-700 font-sans">Cancel</button>
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
                  <h2 className="text-2xl font-bold mb-2">Game Over</h2>
                  <p className="text-slate-500 mb-6 font-sans">All pitches have been recorded. Finalize and confirm match results?</p>
                  <div className="flex gap-3"><button onClick={() => setShowFinishModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold font-sans">Cancel</button><button onClick={confirmCompleteGame} className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl font-sans shadow-lg shadow-green-900/20">Confirm & Finalize</button></div>
              </div>
          </div>,
          document.body
      )}

      {showExitConfirmModal && createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setShowExitConfirmModal(false)}>
              <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                  <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2 font-sans">Match Still in Progress</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 font-sans">Are you sure you want to leave? Your recorded pitches are saved and you can return anytime.</p>
                  <div className="flex gap-3">
                      <button onClick={() => setShowExitConfirmModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold font-sans hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Stay in Match</button>
                      <button onClick={() => { setShowExitConfirmModal(false); onExit(); }} className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold font-sans shadow-lg shadow-red-900/20 transition-colors">Exit</button>
                  </div>
              </div>
          </div>,
          document.body
      )}
    </div>
  );
};
