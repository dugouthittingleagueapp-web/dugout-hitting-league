import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Match, Team, Player } from '../types.js';
import * as storage from '../services/storageService.js';
import { detectForfeit, getUnknownLineupIds } from '../services/matchHelpers.js';
import {
  extractMatchPlayerSummary,
  remapMatchPlayerIds,
  autoMapPlaceholdersToRoster
} from '../utils/statsEditorHelper.js';

interface MatchStatsEditorModalProps {
  match: Match;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedMatch: Match) => void;
  teams: Team[];
}

export const MatchStatsEditorModal: React.FC<MatchStatsEditorModalProps> = ({
  match,
  isOpen,
  onClose,
  onSuccess,
  teams
}) => {
  const homeTeam = useMemo(() => teams.find(t => t.id === match.homeTeamId), [teams, match.homeTeamId]);
  const awayTeam = useMemo(() => teams.find(t => t.id === match.awayTeamId), [teams, match.awayTeamId]);

  const [activeSide, setActiveSide] = useState<'home' | 'away'>('away');
  const currentTeam = activeSide === 'home' ? homeTeam : awayTeam;

  // Track player ID mappings: originalPlayerId -> targetPlayerId
  const [mappings, setMappings] = useState<Record<string, string>>({});

  // Track newly created roster players: originalPlayerId -> { name, lastName }
  const [newPlayers, setNewPlayers] = useState<Record<string, { name: string; lastName?: string }>>({});

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Summaries of player stats recorded in this match
  const homeSummaries = useMemo(() => extractMatchPlayerSummary(match, match.homeTeamId, homeTeam), [match, homeTeam]);
  const awaySummaries = useMemo(() => extractMatchPlayerSummary(match, match.awayTeamId, awayTeam), [match, awayTeam]);

  const currentSummaries = activeSide === 'home' ? homeSummaries : awaySummaries;

  if (!isOpen) return null;

  const handleSelectTarget = (originalId: string, selectedValue: string) => {
    if (selectedValue === '__NEW__') {
      setMappings(prev => ({ ...prev, [originalId]: '__NEW__' }));
      if (!newPlayers[originalId]) {
        setNewPlayers(prev => ({ ...prev, [originalId]: { name: '', lastName: '' } }));
      }
    } else {
      setMappings(prev => ({ ...prev, [originalId]: selectedValue }));
      setNewPlayers(prev => {
        const copy = { ...prev };
        delete copy[originalId];
        return copy;
      });
    }
  };

  const handleNewPlayerNameChange = (originalId: string, field: 'name' | 'lastName', val: string) => {
    setNewPlayers(prev => ({
      ...prev,
      [originalId]: {
        ...prev[originalId],
        [field]: val
      }
    }));
  };

  const handleAutoMap = () => {
    if (!currentTeam) return;
    const roster = currentTeam.players || [];
    const auto = autoMapPlaceholdersToRoster(currentSummaries, roster);
    setMappings(prev => ({ ...prev, ...auto }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccessMsg(null);

    try {
      let finalMapping: Record<string, string> = { ...mappings };
      let updatedHomeTeam = homeTeam ? { ...homeTeam } : null;
      let updatedAwayTeam = awayTeam ? { ...awayTeam } : null;

      // 1. Process any newly registered players and add them to team roster
      for (const [origId, newP] of Object.entries(newPlayers)) {
        if (newP && newP.name.trim()) {
          const newPlayerObj: Player = {
            id: storage.generateUUID(),
            name: newP.name.trim(),
            lastName: newP.lastName?.trim() || undefined
          };

          finalMapping[origId] = newPlayerObj.id;

          // Add to the appropriate team
          const isHomePlayer = homeSummaries.some(s => s.playerId === origId);
          if (isHomePlayer && updatedHomeTeam) {
            updatedHomeTeam.players = [...(updatedHomeTeam.players || []), newPlayerObj];
          } else if (!isHomePlayer && updatedAwayTeam) {
            updatedAwayTeam.players = [...(updatedAwayTeam.players || []), newPlayerObj];
          }
        }
      }

      // Filter out any lingering '__NEW__' that wasn't filled
      for (const k of Object.keys(finalMapping)) {
        if (finalMapping[k] === '__NEW__') {
          delete finalMapping[k];
        }
      }

      // 2. Save updated teams if new players were added
      if (updatedHomeTeam && updatedHomeTeam.players.length !== (homeTeam?.players?.length || 0)) {
        await storage.updateTeam(updatedHomeTeam);
      }
      if (updatedAwayTeam && updatedAwayTeam.players.length !== (awayTeam?.players?.length || 0)) {
        await storage.updateTeam(updatedAwayTeam);
      }

      // 3. Remap match player scores without altering pitch values.
      let updatedMatch = remapMatchPlayerIds(match, finalMapping);

      // 4. Re-evaluate the forfeit only when both full lineups resolve to
      // known roster members or registered substitutes.
      if (updatedHomeTeam && updatedAwayTeam) {
        const homeIds = (updatedMatch.innings?.[0]?.home?.playerScores || []).map(ps => ps.playerId);
        const awayIds = (updatedMatch.innings?.[0]?.away?.playerScores || []).map(ps => ps.playerId);
        if (homeIds.length >= 2 && awayIds.length >= 2 &&
            !getUnknownLineupIds(updatedHomeTeam, homeIds).length &&
            !getUnknownLineupIds(updatedAwayTeam, awayIds).length) {
          const verdict = detectForfeit(updatedHomeTeam, updatedAwayTeam, homeIds, awayIds);
          updatedMatch = {
            ...updatedMatch,
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
      }
      const savedMatch = await storage.updateMatch(updatedMatch, { requireServerSave: true });

      setSaveSuccessMsg('Match player stats successfully re-assigned!');
      setTimeout(() => {
        onSuccess(savedMatch);
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Failed to save re-mapped match stats:', err);
      alert('Error updating match stats: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 p-3 sm:p-4 font-sans"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-start gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
              <span className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Admin Stat Editor & Re-assignment
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-tight">
              Fix & Re-link Player Match Stats
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Re-assign generic placeholders (e.g. &ldquo;Player 1&rdquo;, &ldquo;Sub&rdquo;) directly to official roster players so stats credit correctly.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white font-bold text-2xl transition-colors leading-none"
          >
            &times;
          </button>
        </div>

        {/* Team Selector Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/70 px-4 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveSide('away')}
            className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
              activeSide === 'away'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <span>Away:</span>
            <span className="truncate max-w-[150px]">{awayTeam?.name || 'Away Team'}</span>
            {awaySummaries.some(s => s.isPlaceholder) && (
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Has unlinked placeholder players"></span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSide('home')}
            className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
              activeSide === 'home'
                ? 'border-red-600 text-red-600 dark:text-red-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <span>Home:</span>
            <span className="truncate max-w-[150px]">{homeTeam?.name || 'Home Team'}</span>
            {homeSummaries.some(s => s.isPlaceholder) && (
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Has unlinked placeholder players"></span>
            )}
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                Recorded Player Lines in Match ({currentSummaries.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Map each recorded stat slot to the official roster player who actually batted.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAutoMap}
              className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Automatically pair slot 1, 2, 3 with official roster order"
            >
              <span>⚡</span>
              <span>Auto-Map to Roster Order</span>
            </button>
          </div>

          {currentSummaries.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-bold">
              No pitch or batting records found for this team in this match.
            </div>
          ) : (
            <div className="space-y-3">
              {currentSummaries.map((summary, idx) => {
                const currentTargetId = mappings[summary.playerId] ?? summary.playerId;
                const isCreatingNew = currentTargetId === '__NEW__';
                const isMappedAway = currentTargetId !== summary.playerId;
                const newPlayerData = newPlayers[summary.playerId] || { name: '', lastName: '' };

                const targetPlayerObj = currentTeam?.players.find(p => p.id === currentTargetId);

                return (
                  <div
                    key={summary.playerId}
                    className={`p-3.5 sm:p-4 rounded-xl border transition-all ${
                      summary.isPlaceholder && !isMappedAway
                        ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/20 shadow-sm'
                        : isMappedAway
                        ? 'border-green-300 dark:border-green-700/60 bg-green-50/40 dark:bg-green-950/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center shrink-0">
                          #{idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {summary.currentName}
                            </span>
                            {summary.isPlaceholder ? (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 shrink-0">
                                ⚠️ Placeholder
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                                Roster Match
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-sans">
                            Stats Captured:{' '}
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {summary.totalPoints} pts
                            </span>{' '}
                            ({summary.pitchesSeen} pitches, {summary.hits4} 4s, {summary.hits3} 3s)
                          </div>
                        </div>
                      </div>

                      {/* Dropdown mapping selector */}
                      <div className="sm:w-60">
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Re-Assign Stat Line To:
                        </label>
                        <select
                          value={currentTargetId}
                          onChange={e => handleSelectTarget(summary.playerId, e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                          <optgroup label="Official Team Roster">
                            {(currentTeam?.players || []).map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.lastName ? p.lastName : ''}
                              </option>
                            ))}
                          </optgroup>
                          {currentTeam?.subs && currentTeam.subs.length > 0 && (
                            <optgroup label="Existing Subs">
                              {currentTeam.subs.map(p => (
                                <option key={p.id} value={p.id}>
                                  (Sub) {p.name} {p.lastName ? p.lastName : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Custom Actions">
                            <option value="__NEW__">+ Register & Assign New Player...</option>
                          </optgroup>
                        </select>
                      </div>
                    </div>

                    {/* Inline new player creation input if __NEW__ selected */}
                    {isCreatingNew && (
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-2.5 rounded-lg flex flex-wrap gap-2 items-center">
                        <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                          New Player Details:
                        </span>
                        <input
                          type="text"
                          value={newPlayerData.name}
                          onChange={e => handleNewPlayerNameChange(summary.playerId, 'name', e.target.value)}
                          placeholder="First Name *"
                          className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold w-28"
                        />
                        <input
                          type="text"
                          value={newPlayerData.lastName || ''}
                          onChange={e => handleNewPlayerNameChange(summary.playerId, 'lastName', e.target.value)}
                          placeholder="Last Name"
                          className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold w-28"
                        />
                        <span className="text-[10px] text-slate-500">
                          (Will also be saved to {currentTeam?.name}&apos;s official roster)
                        </span>
                      </div>
                    )}

                    {isMappedAway && !isCreatingNew && targetPlayerObj && (
                      <div className="mt-2 text-[11px] text-green-700 dark:text-green-400 font-bold flex items-center gap-1.5">
                        <span>✓</span>
                        <span>
                          Will re-link all {summary.totalPoints} pts to{' '}
                          <span className="underline">
                            {targetPlayerObj.name} {targetPlayerObj.lastName || ''}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
          {saveSuccessMsg ? (
            <span className="text-xs font-bold text-green-600 dark:text-green-400 animate-pulse">
              ✓ {saveSuccessMsg}
            </span>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Changes update box scores, leaderboards, and career batting stats immediately.
            </span>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || Object.keys(mappings).length === 0}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-md shadow-blue-900/20 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <span>{isSaving ? 'Saving...' : '💾 Save & Re-link Stats'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
