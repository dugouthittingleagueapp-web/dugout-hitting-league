import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Match, Team, Player } from '../types';
import { applyLineupToMatch, moveBatterUp, moveBatterDown, formatFullPlayerName, swapHomeAndAway } from '../utils/lineupHelper';
import * as storage from '../services/storageService';
import { detectForfeit, getUnknownLineupIds } from '../services/matchHelpers';
import { removeDraftLineupPlayer, isPlayableLineup, incompleteLineupMessage } from '../utils/lineupDraft';
import { explainSaveError } from '../utils/friendlyErrors';

interface SetLineupModalProps {
  match: Match;
  homeTeam: Team;
  awayTeam: Team;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedMatch: Match, andStartScoring?: boolean) => Promise<void>;
  onTeamUpdated?: (updatedTeam: Team) => void;
}

export const SetLineupModal: React.FC<SetLineupModalProps> = ({
  match,
  homeTeam: initialHomeTeam,
  awayTeam: initialAwayTeam,
  isOpen,
  onClose,
  onSave,
  onTeamUpdated
}) => {
  const [activeSide, setActiveSide] = useState<'away' | 'home'>('away'); // Away bats first
  const [workingMatch, setWorkingMatch] = useState<Match>(match);
  const [homeTeam, setHomeTeam] = useState<Team>(initialHomeTeam);
  const [awayTeam, setAwayTeam] = useState<Team>(initialAwayTeam);

  // Lineup state as arrays of player IDs in exact batting order [batter1, batter2, batter3]
  const [homeLineup, setHomeLineup] = useState<string[]>([]);
  const [awayLineup, setAwayLineup] = useState<string[]>([]);

  // Sub registration input
  const [subName, setSubName] = useState('');
  const [isSavingSub, setIsSavingSub] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guards against polling/background re-fetches wiping active user edits
  const prevIsOpenRef = useRef(false);
  const lastMatchIdRef = useRef<string | null>(null);

  // Initialize once per modal session or when target match ID actually changes
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }

    const isNewSession = !prevIsOpenRef.current || lastMatchIdRef.current !== match.id;
    if (!isNewSession) return;

    prevIsOpenRef.current = true;
    lastMatchIdRef.current = match.id;

    setWorkingMatch(match);
    setHomeTeam(initialHomeTeam);
    setAwayTeam(initialAwayTeam);
    setErrorMessage(null);
    setSubName('');

    // Extract current lineup from match innings if available, or default to first 3 players
    const matchHomeIds = (match.innings?.[0]?.home?.playerScores || [])
      .map(p => p.playerId)
      .filter(Boolean);
    const matchAwayIds = (match.innings?.[0]?.away?.playerScores || [])
      .map(p => p.playerId)
      .filter(Boolean);

    // An unplayed scheduled game begins with its three official regulars.
    // Preserve intentional selections for started games; never silently overwrite scoring.
    const hasScoredPitches = (match.innings || []).some(inning =>
      [...(inning.home?.playerScores || []), ...(inning.away?.playerScores || [])]
        .some(ps => (ps.pitches || []).some(p => p.points !== null && p.points !== undefined))
    );
    const hasValidSavedHome = matchHomeIds.length >= 2 && getUnknownLineupIds(initialHomeTeam, matchHomeIds).length === 0;
    const hasValidSavedAway = matchAwayIds.length >= 2 && getUnknownLineupIds(initialAwayTeam, matchAwayIds).length === 0;
    const defaultHome = hasScoredPitches || hasValidSavedHome
      ? matchHomeIds : (initialHomeTeam.players || []).map(p => p.id).slice(0, 3);
    const defaultAway = hasScoredPitches || hasValidSavedAway
      ? matchAwayIds : (initialAwayTeam.players || []).map(p => p.id).slice(0, 3);

    setHomeLineup(defaultHome);
    setAwayLineup(defaultAway);
  }, [isOpen, match.id]);

  if (!isOpen) return null;

  const currentTeam = activeSide === 'home' ? homeTeam : awayTeam;
  const currentLineup = activeSide === 'home' ? homeLineup : awayLineup;
  const setCurrentLineup = activeSide === 'home' ? setHomeLineup : setAwayLineup;

  const allTeamPlayers: Player[] = [
    ...(currentTeam.players || []),
    ...(currentTeam.subs || [])
  ];

  const formatPlayerName = (p?: Player): string => {
    return formatFullPlayerName(p);
  };

  // Reorder actions
  const handleMoveUp = (index: number) => {
    setCurrentLineup(prev => moveBatterUp(prev, index));
  };

  const handleMoveDown = (index: number) => {
    setCurrentLineup(prev => moveBatterDown(prev, index));
  };

  const handleRemoveFromLineup = (playerId: string) => {
    // Draft edits may temporarily have fewer than two batters while regulars
    // are replaced by subs. Saving still enforces the 2–3 batter rule.
    setErrorMessage(null);
    setCurrentLineup(prev => removeDraftLineupPlayer(prev.map(id => ({ id })), playerId).map(player => player.id));
  };

  const handleAddToLineup = (playerId: string) => {
    if (currentLineup.includes(playerId)) return;
    if (currentLineup.length >= 3) {
      setErrorMessage('Youth 3v3 lineup maximum is 3 active batters.');
      return;
    }
    setErrorMessage(null);
    setCurrentLineup(prev => [...prev, playerId]);
  };

  const handleReplaceSlot = (index: number, newPlayerId: string) => {
    if (!newPlayerId) return;
    setErrorMessage(null);
    setCurrentLineup(prev => {
      const copy = [...prev];
      // If the new player was already elsewhere in the lineup, swap positions
      const existingIdx = copy.indexOf(newPlayerId);
      if (existingIdx !== -1) {
        copy[existingIdx] = copy[index];
      }
      copy[index] = newPlayerId;
      return copy;
    });
  };

  // Register a new substitute player on the fly
  const handleCreateSub = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = subName.trim();
    if (!trimmed) return;

    setIsSavingSub(true);
    setErrorMessage(null);
    try {
      const newSub: Player = {
        id: storage.generateUUID(),
        name: trimmed
      };

      const updated = {
        ...currentTeam,
        subs: [...(currentTeam.subs || []), newSub]
      };

      await storage.updateTeam(updated, { requireServerSave: true });

      if (activeSide === 'home') {
        setHomeTeam(updated);
        // If there is room in the lineup, auto-add
        if (homeLineup.length < 3) {
          setHomeLineup(prev => [...prev, newSub.id]);
        }
      } else {
        setAwayTeam(updated);
        if (awayLineup.length < 3) {
          setAwayLineup(prev => [...prev, newSub.id]);
        }
      }

      onTeamUpdated?.(updated);
      setSubName('');
    } catch (err: any) {
      setErrorMessage(explainSaveError(err, 'substitute'));
    } finally {
      setIsSavingSub(false);
    }
  };

  // Swap Home and Away designations
  const handleSwapHomeAway = () => {
    setErrorMessage(null);
    const swapped = swapHomeAndAway(workingMatch);
    setWorkingMatch(swapped);

    // Swap team objects
    const prevHome = homeTeam;
    const prevAway = awayTeam;
    setHomeTeam(prevAway);
    setAwayTeam(prevHome);

    // Swap active lineups
    const prevHomeLineup = homeLineup;
    const prevAwayLineup = awayLineup;
    setHomeLineup(prevAwayLineup);
    setAwayLineup(prevHomeLineup);
  };

  // Validation & Save
  const handleSave = async (andStartScoring = false) => {
    if (!isPlayableLineup(homeLineup)) {
      setErrorMessage(incompleteLineupMessage(homeTeam.name));
      setActiveSide('home');
      return;
    }
    if (!isPlayableLineup(awayLineup)) {
      setErrorMessage(incompleteLineupMessage(awayTeam.name));
      setActiveSide('away');
      return;
    }

    const invalidHomeIds = getUnknownLineupIds(homeTeam, homeLineup);
    const invalidAwayIds = getUnknownLineupIds(awayTeam, awayLineup);
    if (invalidHomeIds.length || invalidAwayIds.length) {
      setActiveSide(invalidAwayIds.length ? 'away' : 'home');
      setErrorMessage('The saved lineup contains players no longer on this team roster. Choose valid roster players or registered substitutes before saving.');
      return;
    }
    if (new Set(homeLineup).size !== homeLineup.length || new Set(awayLineup).size !== awayLineup.length) {
      setErrorMessage('A batter cannot appear twice in the same lineup.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const forfeitEval = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
      let updatedMatch = applyLineupToMatch(workingMatch, homeLineup, awayLineup);
      updatedMatch = {
        ...updatedMatch,
        isForfeit: forfeitEval.isForfeit,
        is_forfeit: forfeitEval.isForfeit,
        forfeitingTeamId: forfeitEval.forfeitingTeamId,
        forfeiting_team_id: forfeitEval.forfeitingTeamId,
        winningTeamId: forfeitEval.winningTeamId,
        winning_team_id: forfeitEval.winningTeamId,
        forfeitReason: forfeitEval.reason,
        forfeit_reason: forfeitEval.reason,
        status: andStartScoring ? 'IN_PROGRESS' : updatedMatch.status
      };
      const savedMatch = await storage.updateMatch(updatedMatch, { requireServerSave: true });
      await onSave(savedMatch, andStartScoring);
      onClose();
    } catch (err: any) {
      setErrorMessage(explainSaveError(err, 'lineup'));
    } finally {
      setIsSaving(false);
    }
  };

  const benchPlayers = allTeamPlayers.filter(p => !currentLineup.includes(p.id));

  return createPortal(
    <div 
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">⚾</span>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white font-sans">
                Set Batting Order & Lineup
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-sans">
              Set the 1st, 2nd, and 3rd batter order before beginning game scoring.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Swap Home & Away Designation Bar */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-1.5 truncate min-w-0 mr-2">
            <span className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">Matchup:</span>
            <span className="text-blue-600 dark:text-blue-400 font-extrabold truncate">{awayTeam.name}</span>
            <span className="text-slate-400 font-bold">@</span>
            <span className="text-red-600 dark:text-red-400 font-extrabold truncate">{homeTeam.name}</span>
          </div>
          <button
            type="button"
            onClick={handleSwapHomeAway}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs shadow-sm transition-colors cursor-pointer shrink-0"
            title="Swap Home and Away team designations"
          >
            <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Swap Home / Away</span>
          </button>
        </div>

        {/* Team Selection Tabs */}
        <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-950/40 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => { setActiveSide('away'); setErrorMessage(null); }}
            className={`py-2 px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
              activeSide === 'away'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider font-sans opacity-90">Away Team (Bats 1st)</span>
            <span className="truncate max-w-[190px] font-black">{awayTeam.name}</span>
            <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-sans font-semibold ${
              awayLineup.length === 2 ? 'bg-amber-400 text-amber-950' : 'bg-blue-800/60 text-blue-100'
            }`}>
              {awayLineup.length} Batters {awayLineup.length === 2 ? '(Ghost Mode)' : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveSide('home'); setErrorMessage(null); }}
            className={`py-2 px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
              activeSide === 'home'
                ? 'bg-red-600 text-white shadow-md'
                : 'bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider font-sans opacity-90">Home Team (Bats 2nd)</span>
            <span className="truncate max-w-[190px] font-black">{homeTeam.name}</span>
            <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-sans font-semibold ${
              homeLineup.length === 2 ? 'bg-amber-400 text-amber-950' : 'bg-red-800/60 text-red-100'
            }`}>
              {homeLineup.length} Batters {homeLineup.length === 2 ? '(Ghost Mode)' : ''}
            </span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {errorMessage && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-xs font-medium">
              {errorMessage}
            </div>
          )}

          {(() => {
            const liveForfeit = detectForfeit(homeTeam, awayTeam, homeLineup, awayLineup);
            if (!liveForfeit.isForfeit) return null;
            return (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-200 text-xs font-medium space-y-1">
                <div className="flex items-center gap-1.5 font-black text-rose-900 dark:text-rose-100 text-[11px] uppercase tracking-wider">
                  <span>⚠️</span>
                  <span>Official Forfeit Threshold Triggered</span>
                </div>
                <p>{liveForfeit.reason}</p>
                <p className="text-[11px] text-rose-700/90 dark:text-rose-300/90 font-semibold">
                  Outcome: Automatic loss for {liveForfeit.forfeitingTeamId === homeTeam.id ? homeTeam.name : awayTeam.name} • Win awarded to {liveForfeit.winningTeamId === homeTeam.id ? homeTeam.name : awayTeam.name}. Individual stats will be recorded exclusively for the compliant team.
                </p>
              </div>
            );
          })()}

          {/* Active Batting Order List */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans">
                Active Batting Order
              </span>
              <span className="text-[11px] font-bold text-slate-500 font-sans">
                {currentLineup.length === 3 ? '3-Player Standard (10 pitches each)' : currentLineup.length === 2 ? '2-Player Ghost Mode (15 pitches each when facing 3)' : 'Add batters before saving'}
              </span>
            </div>

            {currentLineup.length < 2 && (
              <p role="status" className="mb-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                {incompleteLineupMessage(currentTeam.name)} You can remove regulars first, then add substitutes below.
              </p>
            )}
            <div className="space-y-2.5">
              {currentLineup.map((playerId, index) => {
                const slotLabel = index === 0 ? '1st Batter' : index === 1 ? '2nd Batter' : '3rd Batter';

                return (
                  <div
                    key={`${playerId}-${index}`}
                    className="p-3 sm:p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 shadow-sm flex flex-col gap-2.5 transition-all"
                  >
                    {/* Top Row: Batter Slot Badge + Position Label + Reorder Action Buttons */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-sm">
                          {index + 1}
                        </span>
                        <span className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400 font-sans">
                          {slotLabel}
                        </span>
                      </div>

                      {/* Reorder Buttons: Move Up, Move Down, Remove */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                          title="Move Up in Batting Order"
                          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs font-bold flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" />
                          </svg>
                          <span className="hidden sm:inline">Up</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleMoveDown(index)}
                          disabled={index === currentLineup.length - 1}
                          title="Move Down in Batting Order"
                          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs font-bold flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                          </svg>
                          <span className="hidden sm:inline">Down</span>
                        </button>

                        {(
                          <button
                            type="button"
                            onClick={() => handleRemoveFromLineup(playerId)}
                            title="Remove from lineup while choosing regular players or substitutes"
                            className="p-1 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Full Name Display & Dropdown */}
                    <div className="relative">
                      <select
                        value={playerId}
                        onChange={e => handleReplaceSlot(index, e.target.value)}
                        className="w-full appearance-none bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl py-2.5 pl-3.5 pr-10 text-sm sm:text-base font-bold font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                      >
                        {allTeamPlayers.map(p => (
                          <option key={p.id} value={p.id}>
                            {formatPlayerName(p)}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 dark:text-slate-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Ghost Mode Placeholder if only 2 players */}
              {currentLineup.length === 2 && (
                <div className="p-3 rounded-xl border border-dashed border-amber-300 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 font-black text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 text-xs">
                      3
                    </div>
                    <div>
                      <div className="text-xs font-black text-amber-800 dark:text-amber-300 font-sans">
                        Ghost Batter Slot
                      </div>
                      <div className="text-[11px] text-amber-600 dark:text-amber-400 font-sans">
                        Batters #1 and #2 each get 15 pitches to balance the 30-pitch team total.
                      </div>
                    </div>
                  </div>

                  {benchPlayers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleAddToLineup(benchPlayers[0].id)}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold font-sans transition-colors shrink-0 shadow-sm"
                    >
                      + Add 3rd Batter
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Available Bench Players */}
          {benchPlayers.length > 0 && (
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans block mb-2">
                Available Roster / Bench
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {benchPlayers.map(p => (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center"
                  >
                    <span className="font-bold text-xs sm:text-sm text-slate-700 dark:text-slate-300 truncate">
                      {formatPlayerName(p)}
                    </span>
                    {currentLineup.length < 3 && (
                      <button
                        type="button"
                        onClick={() => handleAddToLineup(p.id)}
                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold font-sans shrink-0 ml-2"
                      >
                        + Add to Lineup
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Register New Substitute on the Spot */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans block mb-2">
              Add Guest / Substitute Player
            </span>
            <form onSubmit={handleCreateSub} className="flex gap-2">
              <input
                type="text"
                value={subName}
                onChange={e => setSubName(e.target.value)}
                placeholder="Player Name (e.g. Charlie Brown)"
                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white font-sans focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={!subName.trim() || isSavingSub}
                className="px-4 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-colors font-sans whitespace-nowrap shadow-sm"
              >
                {isSavingSub ? 'Adding...' : '+ Add Sub'}
              </button>
            </form>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm hover:bg-slate-100 dark:hover:bg-slate-700 font-sans transition-colors text-center"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl border border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold text-xs sm:text-sm hover:bg-blue-100 dark:hover:bg-blue-900/40 font-sans transition-colors disabled:opacity-50 text-center"
          >
            {isSaving ? 'Saving...' : 'Save Lineup'}
          </button>

          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs sm:text-sm font-sans shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 text-center"
          >
            <span>⚾</span>
            <span>{isSaving ? 'Saving...' : 'Save & Start Scoring'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
