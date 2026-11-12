import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Match, Team, TieBreakerRound, Player } from '../types';
import * as storage from '../services/storageService';
import { ScoreInput } from './ScoreInput';
import { applyLineupToMatch, getUnsafeLineupChangeReason, formatFullPlayerName, getMatchStatus } from '../utils/lineupHelper';
import { isPlaceholderPlayerName } from '../utils/statsEditorHelper.js';
import { detectForfeit, getUnknownLineupIds } from '../services/matchHelpers';
import { explainSaveError } from '../utils/friendlyErrors';
import { withPitchScore } from '../utils/pitchUpdate';
import { calculateTeamInningTotal, calculateTeamGameTotal as getTeamGameTotal } from '../utils/scoreTotals';
import { getLiveInningIndex } from '../utils/liveInning';
import { useScreenWakeLock } from '../hooks/useScreenWakeLock';

interface ScoreboardProps {
  matchId: string;
  onExit: (options?: { endedPractice?: boolean; deletedPractice?: boolean; matchId?: string; savedPractice?: boolean; finalizedMatch?: boolean; message?: string }) => void;
  isReadOnly?: boolean;
  userRole?: 'fan' | 'umpire' | 'admin';
  onPlayerClick?: (playerName: string) => void;
}

const ScoringBoardContent: React.FC<ScoreboardProps & { saveState?: storage.ScoringSaveState; onRetrySync?: () => void }> = ({ matchId, onExit, isReadOnly = false, userRole = 'fan', onPlayerClick, saveState, onRetrySync }) => {
  const [match, setMatch] = useState<Match | null>(null);
  const [teams, setTeams] = useState<{ home?: Team, away?: Team }>({});
  const [activeInningIdx, setActiveInningIdx] = useState(0); 
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showExitMenuModal, setShowExitMenuModal] = useState(false);
  const [confirmTieExit, setConfirmTieExit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingRoster, setSavingRoster] = useState(false);
  
  const [activeCell, setActiveCell] = useState<{ side: 'home' | 'away'; lineupIdx: number; pitchIdx: number; roundIdx?: number } | null>(null);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);

  // Tie Breaker Setup State
  const [showTieBreakerSetup, setShowTieBreakerSetup] = useState(false);
  const [tbHomePlayerId, setTbHomePlayerId] = useState('');
  const [tbAwayPlayerId, setTbAwayPlayerId] = useState('');

  // Roster Editing State
  const [rosterSide, setRosterSide] = useState<'home' | 'away' | null>(null);
  const [newSubNameInput, setNewSubNameInput] = useState('');

  const activeInningRef = useRef(activeInningIdx);
  const lastLiveInningRef = useRef<number>(-1);
  const spectatorCompletedRef = useRef(false);

  useEffect(() => {
      activeInningRef.current = activeInningIdx;
  }, [activeInningIdx]);

  // Guard against accidental exits via browser back button/gestures during live scoring
  useEffect(() => {
      const handleBackAttempt = () => {
          if (!isReadOnly && userRole !== 'fan' && match && !match.isComplete) {
              setConfirmTieExit(false);
              setShowExitMenuModal(true);
          }
      };
      window.addEventListener('dugout:umpire-back-attempt', handleBackAttempt);
      return () => {
          window.removeEventListener('dugout:umpire-back-attempt', handleBackAttempt);
      };
  }, [isReadOnly, userRole, match]);

  const handleExitRequest = () => {
      if (!isReadOnly && userRole !== 'fan' && match) {
          setConfirmTieExit(false);
          setShowExitMenuModal(true);
      } else {
          onExit();
      }
  };

  const handleSaveAndExit = async () => {
      if (match) {
          await storage.updateMatch(match);
      }
      setShowExitMenuModal(false);
      onExit({ savedPractice: false });
  };

  const handleExitAndFinalize = async (forceTie: boolean = false) => {
      if (isReadOnly || !match) return;
      const hT = calculateTeamGameTotal('home', match);
      const aT = calculateTeamGameTotal('away', match);

      if (hT === aT && !forceTie && (!match.tieBreaker || match.tieBreaker.length === 0)) {
          setConfirmTieExit(true);
          return;
      }

      const finalizedMatch: Match = {
          ...match,
          isComplete: true,
          status: 'FINAL'
      };
      try {
          const saved = await storage.updateMatch(finalizedMatch, { requireServerSave: true });
          setMatch(saved);
      } catch (err: any) {
          alert(explainSaveError(err, 'finalize'));
          return;
      }
      try {
          if (typeof window !== 'undefined') {
              localStorage.removeItem('dugout_active_match_id');
          }
      } catch (e) {}
      setShowExitMenuModal(false);
      setConfirmTieExit(false);
      setShowFinishModal(false);

      const homeName = teams.home?.name || 'Home Team';
      const awayName = teams.away?.name || 'Away Team';
      const isPractice = !!(match.isPractice || match.is_practice);
      onExit({
          finalizedMatch: true,
          matchId: match.id,
          message: isPractice
              ? `Practice Match Completed! Final Score: ${homeName} ${hT} - ${awayName} ${aT}. Stored on schedule.`
              : `Match Finalized! Final Score: ${homeName} ${hT} - ${awayName} ${aT}. Official stats and standings recorded.`
      });
  };

  const formatName = (p: { name: string, lastName?: string } | undefined) => {
      if (!p) return 'Unknown';
      return `${p.name}${p.lastName ? ' ' + p.lastName.charAt(0) + '.' : ''}`;
  };

  const spectatorTeamsRef = useRef<{ home?: Team; away?: Team }>({});
  const loadMatchData = async (refreshTeams = true) => {
      const m = await storage.getMatch(matchId, { spectator: isReadOnly });
      if (m) {
        if (isReadOnly) spectatorCompletedRef.current = m.isComplete;
        const cached = spectatorTeamsRef.current;
        const needTeams = refreshTeams || cached.home?.id !== m.homeTeamId || cached.away?.id !== m.awayTeamId;
        const allTeams = needTeams ? await storage.getMatchTeams(m.homeTeamId, m.awayTeamId) : [];
        let home = needTeams ? allTeams.find(t => t.id === m.homeTeamId) : cached.home;
        let away = needTeams ? allTeams.find(t => t.id === m.awayTeamId) : cached.away;

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
        spectatorTeamsRef.current = { home, away };
        if (needTeams) setTeams({ home, away });
        
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

  useScreenWakeLock();

  useEffect(() => {
    const init = async () => {
        setLoading(true);
        lastLiveInningRef.current = -1;
        spectatorCompletedRef.current = false;
        await loadMatchData();
        setLoading(false);
    };
    init();
  }, [matchId]);

  useEffect(() => {
      if (!isReadOnly) return;
      let inFlight = false;
      let ticks = 0;
      const poll = async () => {
          if (document.visibilityState === 'hidden' || inFlight) return;
          inFlight = true;
          try {
              ticks++;
              // Completed games rarely change. Check once per minute instead
              // of every ten seconds; in-progress games still update live.
              if (spectatorCompletedRef.current && ticks % 6 !== 0) return;
              await loadMatchData(ticks % 6 === 0);
          } finally {
              inFlight = false;
          }
      };
      // Spectator score updates remain live at ten seconds, with team rosters
      // refreshed once per minute rather than on every score refresh.
      const interval = setInterval(() => { void poll(); }, 10000);
      const onVisibility = () => {
          if (document.visibilityState === 'visible') void poll();
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
          clearInterval(interval);
          document.removeEventListener('visibilitychange', onVisibility);
      };
  }, [matchId, isReadOnly]);

  // Keep the current-game fallback used by the scoring controls.
  const calculateTeamGameTotal = (side: 'home' | 'away', matchData?: Match | null): number =>
    getTeamGameTotal(side, matchData || match);

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
      updatedMatch.status = 'IN_PROGRESS';
      setMatch(updatedMatch);
      await storage.updateMatch(updatedMatch);
      setShowTieBreakerSetup(false);
      setActiveInningIdx(6);
  };

  const confirmResetPracticeMatch = async () => {
    if (!match) return;
    const resetInnings = match.innings.map(ing => ({
      ...ing,
      home: {
        ...ing.home,
        playerScores: (ing.home?.playerScores || []).map(ps => ({
          ...ps,
          pitches: (ps.pitches || []).map(() => ({ points: null }))
        }))
      },
      away: {
        ...ing.away,
        playerScores: (ing.away?.playerScores || []).map(ps => ({
          ...ps,
          pitches: (ps.pitches || []).map(() => ({ points: null }))
        }))
      }
    }));

    const resetMatch: Match = {
      ...match,
      isComplete: false,
      status: 'IN_PROGRESS',
      innings: resetInnings,
      tieBreaker: []
    };

    setMatch(resetMatch);
    setActiveInningIdx(0);
    setActiveCell(null);
    setShowFinishModal(false);
    setShowTieBreakerSetup(false);
    setShowResetConfirmModal(false);
    await storage.updateMatch(resetMatch).catch(err => {
      console.error('Practice reset failed:', err);
      alert(explainSaveError(err, 'match'));
    });
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
      await storage.updateMatch(newMatch).catch(err => {
        console.error('Undo failed:', err);
        alert(explainSaveError(err, 'match'));
      });
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
    const newMatch = withPitchScore(match, targetInningIdx, side, lineupIdx, pitchIdx, val);
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
                // Batter still has pitches left in their at-bat: auto-advance to next pitch
                nextCell = { side, lineupIdx, pitchIdx: pitchIdx + 1 };
            } else {
                // Batter's pitches are completed (10th pitch in 3v3 / 10-pitch, 15th pitch in Ghost player mode).
                // Close scoring modal to show the batter's pitches are over and the next batter is up.
                nextCell = null;
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
    await storage.updateMatch(newMatch).catch(async err => {
      console.error('Score could not be confirmed:', err);
      alert(explainSaveError(err, 'match'));
      const latest = await storage.getMatch(matchId);
      if (latest) setMatch(latest);
    });
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
    const newMatch: Match = { ...match, isComplete: true, status: 'FINAL' };
    try {
        const saved = await storage.updateMatch(newMatch, { requireServerSave: true });
        setMatch(saved);
    } catch (err: any) {
        alert(explainSaveError(err, 'finalize'));
        return;
    }
    try {
        if (typeof window !== 'undefined') localStorage.removeItem('dugout_active_match_id');
    } catch (e) {}
    setShowFinishModal(false);
    const homeName = teams.home?.name || 'Home Team';
    const awayName = teams.away?.name || 'Away Team';
    const isPractice = !!(match.isPractice || match.is_practice);
    onExit({
        finalizedMatch: true,
        matchId: match.id,
        message: isPractice
            ? `Practice Match Completed! Final Score: ${homeName} ${hT} - ${awayName} ${aT}. Stored on schedule.`
            : `Match Finalized! Final Score: ${homeName} ${hT} - ${awayName} ${aT}. Standings and stats updated.`
    });
  };

  const handleToggleComplete = async () => {
    if (!match || userRole !== 'admin') return;
    const nextIsComplete = !match.isComplete;
    const updated: Match = { ...match, isComplete: nextIsComplete, status: nextIsComplete ? 'FINAL' : 'IN_PROGRESS' };
    try {
        const saved = await storage.updateMatch(updated, { requireServerSave: true });
        setMatch(saved);
    } catch (err: any) {
        alert(explainSaveError(err, 'finalize'));
    }
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
      if (!newMatch.isComplete) {
        newMatch.status = 'IN_PROGRESS';
      }
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
      await storage.updateMatch(newMatch).catch(err => {
        console.error('Tie-breaker score could not be saved:', err);
        alert(explainSaveError(err, 'match'));
      });
  };


  if (loading && (!match || !teams.home || !teams.away)) return <div className="flex items-center justify-center h-screen text-slate-400 font-bold font-sans">Loading Match Data...</div>;
  if (!match || !teams.home || !teams.away) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center font-sans">
        <p className="text-slate-600 dark:text-slate-300 font-bold mb-4">Unable to load match details or teams.</p>
        <button onClick={() => onExit()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
          Return to Dashboard
        </button>
      </div>
    );
  }

  const currentInning = match.innings[activeInningIdx] || match.innings[0];
  const isExtraInnings = activeInningIdx === 6;
  const homeTotal = calculateTeamGameTotal('home', match);
  const awayTotal = calculateTeamGameTotal('away', match);

  const saveRosterChange = async (side: 'home' | 'away', playerIds: string[], updatedTeam?: Team): Promise<boolean> => {
      if (isReadOnly || !match) return false;
      const team = updatedTeam || (side === 'home' ? teams.home : teams.away);
      if (!team || playerIds.length < 2 || playerIds.length > 3 ||
          getUnknownLineupIds(team, playerIds).length > 0 ||
          new Set(playerIds).size !== playerIds.length) {
          alert('Select two or three distinct players from the roster or registered substitutes.');
          return false;
      }

      const currentInning = match.innings[activeInningIdx] || match.innings[0];
      const newHomeIds = side === 'home'
          ? playerIds
          : currentInning.home.playerScores.map(p => p.playerId);
      const newAwayIds = side === 'away'
          ? playerIds
          : currentInning.away.playerScores.map(p => p.playerId);
      const unsafeReason = getUnsafeLineupChangeReason(match, newHomeIds, newAwayIds, activeInningIdx);
      if (unsafeReason) {
          alert(unsafeReason);
          return false;
      }

      setSavingRoster(true);
      try {
          const homeTeam = side === 'home' ? team : teams.home;
          const awayTeam = side === 'away' ? team : teams.away;
          // Only change this and future innings; earlier recorded innings remain untouched.
          let updated = applyLineupToMatch(match, newHomeIds, newAwayIds, {
              startFromInningIdx: activeInningIdx
          });
          if (homeTeam && awayTeam) {
              const verdict = detectForfeit(homeTeam, awayTeam, newHomeIds, newAwayIds);
              updated = {
                  ...updated,
                  isForfeit: verdict.isForfeit,
                  is_forfeit: verdict.isForfeit,
                  forfeitingTeamId: verdict.forfeitingTeamId,
                  forfeiting_team_id: verdict.forfeitingTeamId,
                  winningTeamId: verdict.winningTeamId,
                  winning_team_id: verdict.winningTeamId,
                  forfeitReason: verdict.reason,
                  forfeit_reason: verdict.reason
              };
          }
          const saved = await storage.updateMatch(updated, { requireServerSave: true });
          setMatch(saved);
          return true;
      } catch (err: any) {
          alert(explainSaveError(err, 'lineup'));
          return false;
      } finally {
          setSavingRoster(false);
      }
  };

  const handleAddManualSub = async () => {
    const trimmed = newSubNameInput.trim();
    if (!trimmed || !rosterSide) return;
    if (isPlaceholderPlayerName(trimmed)) {
        alert("Please enter the player's real name (e.g. Jack S.) rather than a generic placeholder like 'Sub' or 'Player 1' so their stats are recorded under their profile.");
        return;
    }
    const currentTeam = rosterSide === 'home' ? teams.home : teams.away;
    if (!currentTeam) return;

    setSavingRoster(true);
    const newPlayer: Player = { id: storage.generateUUID(), name: trimmed };
    const updatedTeam: Team = { 
        ...currentTeam, 
        subs: [...(currentTeam.subs || []), newPlayer] 
    };

    try {
        await storage.updateTeam(updatedTeam, { requireServerSave: true });
        setTeams(prev => ({ ...prev, [rosterSide]: updatedTeam }));
        
        const lineup = currentInning[rosterSide].playerScores.map(x => x.playerId);
        const newList = [...lineup, newPlayer.id];
        
        if (newList.length >= 2 && newList.length <= 3) {
            setNewSubNameInput('');
            const saved = await saveRosterChange(rosterSide, newList, updatedTeam);
            if (!saved) alert('Substitute registered, but the lineup change was not saved. Select the substitute from the roster and retry.');
        } else {
            alert("Roster limit reached (3 max). Player saved as sub.");
            setNewSubNameInput('');
            setSavingRoster(false);
        }
    } catch (e) {
        alert(explainSaveError(e, "substitute"));
        setSavingRoster(false);
    }
  };

  const renderTeamSection = (side: 'home' | 'away', team: Team) => {
    const inningData = side === 'home' ? currentInning.home : currentInning.away;
    const headerClass = side === 'home' 
        ? 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 border-red-200 dark:border-red-900' 
        : 'bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900';
    
    const isTwoPlayerGhostMode = inningData.playerScores.length === 2 && inningData.playerScores[0].pitches.length >= 15;
    const canEdit = !isReadOnly && (!match.isComplete || userRole === 'admin');

    // Resolve lineup entries against both teams and tolerate legacy records that
    // stored a player name (or a differently typed ID) instead of the roster ID.
    // The match's batting side remains unchanged; this is only player identity lookup.
    const findPlayer = (id: string) => {
        const allPlayers = [
            ...(team.players || []),
            ...(team.subs || []),
            ...(teams.home?.players || []),
            ...(teams.home?.subs || []),
            ...(teams.away?.players || []),
            ...(teams.away?.subs || [])
        ];
        const key = String(id ?? '').trim();
        if (!key) return undefined;

        const byExactId = allPlayers.find(p => String(p.id ?? '').trim() === key);
        if (byExactId) return byExactId;

        const normalizedKey = key.toLocaleLowerCase();
        const byNormalizedId = allPlayers.find(
            p => String(p.id ?? '').trim().toLocaleLowerCase() === normalizedKey
        );
        if (byNormalizedId) return byNormalizedId;

        // Older lineup records may contain the display name rather than player.id.
        return allPlayers.find(p => {
            const first = String(p.name || '').trim();
            const last = String(p.lastName || '').trim();
            const full = `${first} ${last}`.trim();
            return [first, full, `${first} ${last ? `${last.charAt(0)}.` : ''}`.trim()]
                .some(name => name && name.toLocaleLowerCase() === normalizedKey);
        });
    };

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
                                <ScoreInput saveState={saveState} onRetrySync={onRetrySync} key={realIdx} pitchNumber={isGhostRow ? pitchStartIndex+idx+1 : realIdx+1} value={pitch.points} pitchesRemaining={pitchesLeft} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === side && activeCell.lineupIdx === lineupIdx && activeCell.pitchIdx === realIdx} onOpen={() => setActiveCell({ side, lineupIdx, pitchIdx: realIdx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, lineupIdx, realIdx, val)} onUndo={realIdx > 0 ? () => handleUndo(side, lineupIdx, realIdx) : undefined} />
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
             {canEdit && <button onClick={() => setRosterSide(side)} className="bg-white/80 dark:bg-slate-800 hover:bg-white text-slate-700 dark:text-slate-200 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-slate-300 dark:border-slate-700 shadow-sm font-sans flex items-center gap-1 cursor-pointer"><span>⚾</span><span>Set Lineup</span></button>}
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
                                    <ScoreInput saveState={saveState} onRetrySync={onRetrySync} key={`p1-${10+idx}`} pitchNumber={11+idx} value={pitch.points} pitchesRemaining={15 - inningData.playerScores[0].pitches.filter((p:any) => p.points !== null).length} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === side && activeCell.lineupIdx === 0 && activeCell.pitchIdx === 10+idx} onOpen={() => setActiveCell({ side, lineupIdx: 0, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, 0, 10+idx, val)} onUndo={() => handleUndo(side, 0, 10+idx)} />
                                ))}<div className="w-px h-10 sm:h-14 bg-slate-300 dark:bg-slate-700 mx-1"></div>
                                {inningData.playerScores[1].pitches.slice(10, 15).map((pitch, idx) => (
                                    <ScoreInput saveState={saveState} onRetrySync={onRetrySync} key={`p2-${10+idx}`} pitchNumber={11+idx} value={pitch.points} pitchesRemaining={15 - inningData.playerScores[1].pitches.filter((p:any) => p.points !== null).length} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === side && activeCell.lineupIdx === 1 && activeCell.pitchIdx === 10+idx} onOpen={() => setActiveCell({ side, lineupIdx: 1, pitchIdx: 10+idx })} onClose={() => setActiveCell(null)} onChange={(val) => handleScoreUpdate(side, 1, 10+idx, val)} onUndo={() => handleUndo(side, 1, 10+idx)} />
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
                                <td className="px-2 py-3"><div className="flex gap-2">{round.awayScores.map((s, pI) => (<ScoreInput saveState={saveState} onRetrySync={onRetrySync} key={pI} pitchNumber={pI+1} value={s} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === 'away' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pI} onOpen={() => setActiveCell({ side: 'away', lineupIdx: 0, pitchIdx: pI, roundIdx: idx })} onClose={() => setActiveCell(null)} onChange={v => handleTieBreakerScore(idx, 'away', pI, v)} onUndo={() => handleUndo('away', 0, pI, idx)} />))}</div></td>
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
                                                children={pName}
                                            />
                                        ) : (
                                            <span className="font-bold">{pName}</span>
                                        );
                                    })()}
                                </td>
                                <td className="px-2 py-3"><div className="flex gap-2">{round.homeScores.map((s, pI) => (<ScoreInput saveState={saveState} onRetrySync={onRetrySync} key={pI} pitchNumber={pI+1} value={s} readOnly={isReadOnly || (match.isComplete && userRole !== 'admin')} isEditing={activeCell?.side === 'home' && activeCell?.roundIdx === idx && activeCell?.pitchIdx === pI} onOpen={() => setActiveCell({ side: 'home', lineupIdx: 0, pitchIdx: pI, roundIdx: idx })} onClose={() => setActiveCell(null)} onChange={v => handleTieBreakerScore(idx, 'home', pI, v)} onUndo={() => handleUndo('home', 0, pI, idx)} />))}</div></td>
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
      {/* Official Forfeit Sticky Banner */}
      {(match.isForfeit || match.is_forfeit) && (() => {
        const forfeitingId = match.forfeitingTeamId || match.forfeiting_team_id;
        const forfeitTeam = forfeitingId === teams.home?.id ? teams.home : (forfeitingId === teams.away?.id ? teams.away : null);
        const winningTeam = forfeitingId === teams.home?.id ? teams.away : (forfeitingId === teams.away?.id ? teams.home : null);
        return (
          <div className="sticky top-0 z-[60] bg-rose-600 text-white px-3 py-2 text-center text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 shadow-lg border-b border-rose-700 font-sans">
            <span className="font-black flex items-center gap-1 uppercase tracking-wider">
              <span>⚠️</span>
              <span>OFFICIAL FORFEIT</span>
            </span>
            <span>
              {forfeitTeam ? `${forfeitTeam.name} forfeited (≤1 main player fielded)` : 'Forfeit match'}. Automatic Win awarded to {winningTeam?.name || 'opponent'}.
            </span>
            <span className="text-[11px] font-normal bg-rose-700/80 px-2 py-0.5 rounded-full">
              Stats recorded exclusively for {winningTeam?.name || 'compliant team'}
            </span>
          </div>
        );
      })()}

      {/* Practice Mode Sticky Top Banner */}
      {match.isPractice && (
        <div className="sticky top-0 z-[59] bg-amber-500 text-slate-950 px-3 py-2 text-center text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md border-b border-amber-600 font-sans">
          <span className="text-sm sm:text-base">🧪</span>
          <span>TEST / PRACTICE MODE — Stats will not be saved to official standings or leaderboards</span>
          <span className="text-sm sm:text-base">🧪</span>
        </div>
      )}
      <header className="bg-white/80 dark:bg-slate-950/90 backdrop-blur-md border-b sticky top-0 z-[50] shadow-sm">
        {saveState && !isReadOnly && userRole !== 'fan' && (
          <div role="status" aria-live="polite" className="flex min-h-8 items-center justify-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            {saveState === 'saving' && <span>Saving scores…</span>}
            {saveState === 'saved' && <span>✓ All scores saved</span>}
            {saveState === 'offline' && (
              <>
                <span>Connection interrupted. Scores are waiting to sync.</span>
                <button type="button" onClick={onRetrySync} className="underline underline-offset-2">Try again</button>
              </>
            )}
            {saveState === 'attention' && <span>Some scores need checking before you continue.</span>}
          </div>
        )}
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center gap-4">
          <div className="flex gap-8 items-center flex-1 min-w-0">
            <div className="text-center flex-1 min-w-0"><div className="text-[10px] uppercase font-bold text-slate-500">Away</div><div className="text-xl font-bold text-blue-700 truncate">{teams.away.name}</div><div className="text-2xl font-sans tabular-nums font-bold dark:text-white">{awayTotal}</div></div>
            <div className="text-slate-300 text-xl font-light">vs</div>
            <div className="text-center flex-1 min-w-0"><div className="text-[10px] uppercase font-bold text-slate-500">Home</div><div className="text-xl font-bold text-red-700 truncate">{teams.home.name}</div><div className="text-2xl font-sans tabular-nums font-bold dark:text-white">{homeTotal}</div></div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {match.isComplete ? (
              <div className="flex items-center gap-1.5">
                {(match.isForfeit || match.is_forfeit) && (
                  <span className="text-[10px] font-black uppercase px-2 py-1 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-400 dark:border-rose-700/80">
                    ⚠️ FORFEIT
                  </span>
                )}
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
              <div className="flex items-center gap-1.5">
                {(match.isForfeit || match.is_forfeit) && (
                  <span className="text-[10px] font-black uppercase px-2 py-1 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-400 dark:border-rose-700/80">
                    ⚠️ FORFEIT
                  </span>
                )}
                {getMatchStatus(match) === 'IN_PROGRESS' ? (
                  <div className="text-red-600 dark:text-red-400 font-black px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider bg-red-100 dark:bg-red-950/50 border border-red-500/30 animate-pulse">LIVE</div>
                ) : (
                  <div className="text-blue-600 dark:text-blue-400 font-bold px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider bg-blue-50 dark:bg-blue-950/40 border border-blue-500/30">SCHEDULED</div>
                )}
              </div>
            )}
            
            {/* Exit & Finalize Fast Action in Header */}
            {!match.isComplete && !isReadOnly && userRole !== 'fan' && (
              <button 
                type="button"
                onClick={() => handleExitAndFinalize(false)} 
                className="text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all cursor-pointer whitespace-nowrap shadow-sm flex items-center gap-1.5 active:scale-95"
                title="Finalize match and complete session"
              >
                <span>🏁</span>
                <span className="hidden sm:inline">Exit & Finalize</span>
                <span className="sm:hidden">Finalize</span>
              </button>
            )}

            {match.isPractice && !isReadOnly && (
              <button 
                type="button"
                onClick={() => setShowResetConfirmModal(true)} 
                className="text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors cursor-pointer whitespace-nowrap shadow-sm flex items-center gap-1"
                title="Reset all test pitches and restart practice match from Inning 1"
              >
                <span>🔄</span>
                <span className="hidden sm:inline">Reset Match</span>
                <span className="sm:hidden">Reset</span>
              </button>
            )}
            
            <button 
              type="button"
              onClick={handleExitRequest} 
              className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 py-1.5 sm:py-2 px-3 rounded-lg sm:rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer flex items-center gap-1 border border-slate-300 dark:border-slate-700 shadow-sm"
              title="Exit options: Save & Exit or Exit & Finalize"
            >
              <span>Exit</span>
              {!isReadOnly && userRole !== 'fan' && <span className="text-[10px] opacity-60">▾</span>}
            </button>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setRosterSide(null)}>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                  <div className="mb-4 flex items-center justify-between">
                      <div>
                          <h3 className="text-xl font-bold text-slate-800 dark:text-white">Set Batting Order & Lineup</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-0.5">{rosterSide === 'home' ? teams.home?.name : teams.away?.name}</p>
                      </div>
                      {savingRoster && (
                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full animate-pulse">
                              Updating...
                          </span>
                      )}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
                      {(() => {
                          const team = rosterSide === 'home' ? teams.home : teams.away;
                          const allPotential = [...(team?.players || []), ...(team?.subs || [])];
                          const lineup = currentInning[rosterSide!].playerScores.map(x => x.playerId);
                          const bench = allPotential.filter(p => !lineup.includes(p.id));

                          return (
                              <div className="space-y-4">
                                  <div>
                                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2 font-sans">
                                          Batting Order ({lineup.length} Batters)
                                      </span>
                                      <div className="space-y-2">
                                          {lineup.map((pid, idx) => {
                                              const player = allPotential.find(p => p.id === pid);
                                              const slotLabel = idx === 0 ? '1st Batter' : idx === 1 ? '2nd Batter' : '3rd Batter';

                                              return (
                                                  <div key={pid} className="flex items-center justify-between p-2.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 gap-2">
                                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                          <div className="w-6 h-6 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                                                              {idx + 1}
                                                          </div>
                                                          <div className="min-w-0 flex-1">
                                                              <div className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">{slotLabel}</div>
                                                              <div className="font-bold text-sm text-slate-900 dark:text-white truncate">{player ? formatFullPlayerName(player) : 'Unknown'}</div>
                                                          </div>
                                                      </div>

                                                      <div className="flex items-center gap-1 shrink-0">
                                                          <button
                                                              type="button"
                                                              disabled={idx === 0}
                                                              onClick={() => {
                                                                  if (idx <= 0) return;
                                                                  const copy = [...lineup];
                                                                  const temp = copy[idx - 1];
                                                                  copy[idx - 1] = copy[idx];
                                                                  copy[idx] = temp;
                                                                  saveRosterChange(rosterSide!, copy);
                                                              }}
                                                              title="Move up in batting order"
                                                              className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                                                          >
                                                              ▲
                                                          </button>
                                                          <button
                                                              type="button"
                                                              disabled={idx === lineup.length - 1}
                                                              onClick={() => {
                                                                  if (idx >= lineup.length - 1) return;
                                                                  const copy = [...lineup];
                                                                  const temp = copy[idx + 1];
                                                                  copy[idx + 1] = copy[idx];
                                                                  copy[idx] = temp;
                                                                  saveRosterChange(rosterSide!, copy);
                                                              }}
                                                              title="Move down in batting order"
                                                              className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                                                          >
                                                              ▼
                                                          </button>
                                                          {lineup.length > 2 && (
                                                              <button
                                                                  type="button"
                                                                  onClick={() => {
                                                                      const copy = lineup.filter(id => id !== pid);
                                                                      saveRosterChange(rosterSide!, copy);
                                                                  }}
                                                                  title="Remove from lineup (switch to Ghost Mode)"
                                                                  className="p-1 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 text-xs font-bold"
                                                              >
                                                                  ✕
                                                              </button>
                                                          )}
                                                      </div>
                                                  </div>
                                              );
                                          })}
                                      </div>
                                  </div>

                                  {bench.length > 0 && (
                                      <div>
                                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2 font-sans">
                                              Bench Players
                                          </span>
                                          <div className="space-y-1.5">
                                              {bench.map(p => (
                                                  <div key={p.id} className="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                                      <span className="font-bold text-xs text-slate-700 dark:text-slate-300 truncate">{formatFullPlayerName(p)}</span>
                                                      {lineup.length < 3 && (
                                                          <button
                                                              type="button"
                                                              onClick={() => {
                                                                  saveRosterChange(rosterSide!, [...lineup, p.id]);
                                                              }}
                                                              className="px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700"
                                                          >
                                                              + Put in Lineup
                                                          </button>
                                                      )}
                                                  </div>
                                              ))}
                                          </div>
                                      </div>
                                  )}
                              </div>
                          );
                      })()}
                  </div>
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 mb-4">
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Register New Sub</label>
                      <div className="flex gap-2">
                          <input type="text" value={newSubNameInput} onChange={e => setNewSubNameInput(e.target.value)} placeholder="Player's Real Name (e.g. Jack S.)" className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white font-sans" />
                          <button onClick={handleAddManualSub} disabled={!newSubNameInput.trim()} className="bg-blue-600 text-white font-bold px-3 py-2 rounded-lg text-xs font-sans disabled:opacity-50 transition-all hover:bg-blue-700">Add</button>
                      </div>
                  </div>
                  <div className="flex gap-2">
                      <button 
                          type="button" 
                          onClick={() => setRosterSide(null)} 
                          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors font-sans shadow-md cursor-pointer text-sm"
                      >
                          Done Editing Lineup
                      </button>
                  </div>
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

      {/* Exit Game Options Modal (Dual Action: Save & Exit vs Exit & Finalize) */}
      {showExitMenuModal && createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setShowExitMenuModal(false)}>
              <div className="bg-white dark:bg-slate-900 p-5 sm:p-7 rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 font-sans" onClick={e => e.stopPropagation()}>
                  
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-2xl shrink-0">
                          ⚾
                      </div>
                      <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                              <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-tight">Exit Game</h2>
                              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                                  {match?.isComplete ? 'FINAL' : 'IN PROGRESS'}
                              </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                              {teams.away?.name || 'Away'} ({awayTotal}) vs {teams.home?.name || 'Home'} ({homeTotal})
                          </p>
                      </div>
                  </div>

                  {/* Tied Game Warning */}
                  {confirmTieExit ? (
                      <div className="mb-4 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-xl">
                          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-sm mb-1">
                              <span>⚠️</span>
                              <span>Game Is Tied ({homeTotal} - {awayTotal})</span>
                          </div>
                          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                              Would you like to start a 1-pitch Tie-Breaker Extra Inning, or finalize the game as an official Tie?
                          </p>
                          <div className="flex gap-2">
                              <button
                                  type="button"
                                  onClick={() => {
                                      setShowExitMenuModal(false);
                                      setConfirmTieExit(false);
                                      setShowTieBreakerSetup(true);
                                  }}
                                  className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                              >
                                  Start Extras
                              </button>
                              <button
                                  type="button"
                                  onClick={() => handleExitAndFinalize(true)}
                                  className="flex-1 py-2 px-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                              >
                                  Finalize as Tie
                              </button>
                          </div>
                      </div>
                  ) : (
                      <div className="space-y-3 mb-5">
                          {/* Option 1: Save & Exit */}
                          <button
                              type="button"
                              onClick={handleSaveAndExit}
                              className="w-full text-left p-3.5 sm:p-4 rounded-xl border-2 border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 hover:bg-blue-100/70 dark:hover:bg-blue-900/50 transition-all flex items-start gap-3.5 group active:scale-[0.99] cursor-pointer"
                          >
                              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 text-xl font-bold shadow-md shadow-blue-600/20 group-hover:scale-105 transition-transform">
                                  💾
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                      <span className="font-black text-sm text-slate-900 dark:text-white">Save & Exit</span>
                                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 shrink-0">Resume Later</span>
                                  </div>
                                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                                      Saves all current pitches and scores. Keeps the game active so you can return and resume scoring later from the dashboard.
                                  </p>
                              </div>
                          </button>

                          {/* Option 2: Exit & Finalize */}
                          <button
                              type="button"
                              onClick={() => handleExitAndFinalize(false)}
                              className="w-full text-left p-3.5 sm:p-4 rounded-xl border-2 border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/40 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/60 transition-all flex items-start gap-3.5 group active:scale-[0.99] cursor-pointer"
                          >
                              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 text-xl font-bold shadow-md shadow-emerald-600/20 group-hover:scale-105 transition-transform">
                                  🏁
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                      <span className="font-black text-sm text-slate-900 dark:text-white">Exit & Finalize</span>
                                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 shrink-0">Complete Match</span>
                                  </div>
                                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                                      Marks match as complete (FINAL), updates team standings and individual player stats, and clears the active session banner.
                                  </p>
                              </div>
                          </button>
                      </div>
                  )}

                  <button
                      type="button"
                      onClick={() => {
                          setShowExitMenuModal(false);
                          setConfirmTieExit(false);
                      }}
                      className="w-full py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-xs sm:text-sm transition-colors cursor-pointer"
                  >
                      Cancel — Stay in Match
                  </button>
              </div>
          </div>,
          document.body
      )}
      {showResetConfirmModal && createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setShowResetConfirmModal(false)}>
              <div className="bg-white dark:bg-slate-900 p-6 sm:p-7 rounded-2xl shadow-2xl max-w-sm w-full text-center border border-slate-200 dark:border-slate-800 font-sans" onClick={e => e.stopPropagation()}>
                  <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl">🔄</span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2 font-sans">Reset Practice Match?</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 font-sans leading-relaxed">
                      This will reset all recorded pitches across all innings back to 0-0 in Inning 1 so you can immediately practice scoring again. Lineups and team rosters are kept.
                  </p>
                  <div className="flex gap-3">
                      <button type="button" onClick={() => setShowResetConfirmModal(false)} className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold font-sans hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Cancel</button>
                      <button type="button" onClick={confirmResetPracticeMatch} className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold font-sans shadow-lg shadow-rose-900/20 transition-colors">Yes, Reset Match</button>
                  </div>
              </div>
          </div>,
          document.body
      )}
    </div>
  );
};


/**
 * Exclusive scoring gate. The scoring controls never mount until this browser
 * session has secured ownership. Spectators remain read-only as before.
 */
export const Scoreboard: React.FC<ScoreboardProps> = (props) => {
  const [access, setAccess] = useState<'checking' | 'granted' | 'locked' | 'error'>('checking');
  const [message, setMessage] = useState('');
  const [syncWarning, setSyncWarning] = useState<string | null>(() => storage.getScoringSyncWarning(props.matchId));
  const [saveState, setSaveState] = useState<storage.ScoringSaveState>(() =>
    storage.hasPendingMatchSync(props.matchId) ? 'offline' : 'saved');
  useEffect(() => {
    setSyncWarning(storage.getScoringSyncWarning(props.matchId));
    const onWarning = (event: Event) => {
      const detail = (event as CustomEvent<{ matchId: string; message: string }>).detail;
      if (detail?.matchId === props.matchId) setSyncWarning(detail.message);
    };
    const onSaveState = (event: Event) => {
      const detail = (event as CustomEvent<{ matchId: string; state: storage.ScoringSaveState }>).detail;
      if (detail?.matchId === props.matchId) setSaveState(detail.state);
    };
    setSaveState(storage.hasPendingMatchSync(props.matchId) ? 'offline' : 'saved');
    window.addEventListener('dugout:scoring-sync-warning', onWarning);
    window.addEventListener('dugout:scoring-save-state', onSaveState);
    return () => {
      window.removeEventListener('dugout:scoring-sync-warning', onWarning);
      window.removeEventListener('dugout:scoring-save-state', onSaveState);
    };
  }, [props.matchId]);
  const isSpectator = props.isReadOnly || props.userRole === 'fan';

  const checkAccess = async (takeover = false) => {
    setAccess('checking');
    try {
      await storage.requestScoringLock(props.matchId, takeover ? 'takeover' : 'acquire');
      setAccess('granted');
      setMessage('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setMessage(msg || 'We could not check who is scoring. Please try again.');
      setAccess(/another umpire|already scoring|transfer control/i.test(msg) ? 'locked' : 'error');
    }
  };

  useEffect(() => {
    if (isSpectator) return;
    void checkAccess();
  }, [props.matchId, isSpectator]);

  if (isSpectator) return <ScoringBoardContent {...props} />;
  if (syncWarning) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-amber-500 p-6 text-center space-y-4">
          <h2 className="text-xl font-bold">Scores need checking</h2>
          <p>{syncWarning}</p>
          <button type="button" onClick={() => void storage.syncOfflineData()} className="px-4 py-3 rounded-lg bg-blue-600 text-white font-semibold">Try syncing again</button>
          <button type="button" onClick={() => props.onExit()} className="px-4 py-3 rounded-lg border border-gray-400">Back to schedule</button>
        </div>
      </div>
    );
  }
  if (access === 'granted') return <ScoringBoardContent {...props} saveState={saveState} onRetrySync={() => void storage.syncOfflineData()} />;
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-gray-300 dark:border-gray-700 p-6 text-center space-y-4">
        <h2 className="text-xl font-bold">{access === 'checking' ? 'Opening the game…' : 'Scoring is unavailable'}</h2>
        {access !== 'checking' && <p className="text-base">{message}</p>}
        {access !== 'checking' && (
          <div className="flex flex-wrap gap-3 justify-center">
            <button type="button" onClick={() => void checkAccess()} className="px-4 py-3 rounded-lg bg-blue-600 text-white font-semibold">Try again</button>
            {props.userRole === 'admin' && access === 'locked' && (
              <button type="button" onClick={() => {
                if (window.confirm('Transfer scoring to this device? The previous umpire will no longer be able to save plays. First confirm their unsent plays have been checked.')) void checkAccess(true);
              }} className="px-4 py-3 rounded-lg bg-orange-600 text-white font-semibold">Admin: Take over</button>
            )}
            <button type="button" onClick={() => props.onExit()} className="px-4 py-3 rounded-lg border border-gray-400">Back to schedule</button>
          </div>
        )}
      </div>
    </div>
  );
};
