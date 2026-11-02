import React, { useState, useRef, useEffect } from 'react';
import { League, Team, Match, ScheduledGameRecord, ScheduleImportSummary } from '../types';
import * as storage from '../services/storageService';
import { parseScheduleCsv, isDuplicateMatch } from '../utils/scheduleImporter';

interface ScheduleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (summary: ScheduleImportSummary) => void;
  currentSeason: string;
  availableSeasons: string[];
  availableLeagues: League[];
}

export const ScheduleImportModal: React.FC<ScheduleImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentSeason,
  availableSeasons,
  availableLeagues
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [csvText, setCsvText] = useState('');
  const [targetSeason, setTargetSeason] = useState(currentSeason || '2026');
  const [targetLeague, setTargetLeague] = useState('');
  const [isCustomLeague, setIsCustomLeague] = useState(false);
  const [customLeagueInput, setCustomLeagueInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Parsed preview state
  const [previewGames, setPreviewGames] = useState<ScheduledGameRecord[] | null>(null);
  const [previewDuplicates, setPreviewDuplicates] = useState<Set<number>>(new Set());
  const [existingTeamsList, setExistingTeamsList] = useState<Team[]>([]);
  const [existingMatchesList, setExistingMatchesList] = useState<Match[]>([]);
  const [importSummary, setImportSummary] = useState<ScheduleImportSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTargetSeason(currentSeason || '2026');
      loadExistingData(currentSeason || '2026');
    } else {
      handleReset();
    }
  }, [isOpen, currentSeason]);

  const loadExistingData = async (season: string) => {
    try {
      const [ts, ms] = await Promise.all([
        storage.getTeams(null, season).catch(() => []),
        storage.getAllMatches().catch(() => [])
      ]);
      setExistingTeamsList(ts);
      setExistingMatchesList(ms);
    } catch (e) {
      console.warn('Failed loading existing teams/matches for preview check', e);
    }
  };

  const handleReset = () => {
    setCsvText('');
    setPreviewGames(null);
    setPreviewDuplicates(new Set());
    setImportSummary(null);
    setErrorMessage(null);
    setLoading(false);
    setIsCustomLeague(false);
    setCustomLeagueInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getEffectiveTargetLeague = (selected: string, isCustom: boolean, customVal: string) => {
    if (isCustom) return customVal.trim();
    return selected.trim();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content);
      const effLeague = getEffectiveTargetLeague(targetLeague, isCustomLeague, customLeagueInput);
      processPreview(content, effLeague, targetSeason);
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read schedule CSV file');
    };
    reader.readAsText(file);
  };

  const handleLoadSampleSchedule = async () => {
    setLoadingSample(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/assets/aistudio/schedule_export_20261102_121804_62b9d935.csv');
      if (!res.ok) throw new Error('Sample CSV schedule file not found at /assets/aistudio/...');
      const content = await res.text();
      setCsvText(content);
      const effLeague = getEffectiveTargetLeague(targetLeague, isCustomLeague, customLeagueInput);
      processPreview(content, effLeague, targetSeason);
    } catch (err: any) {
      setErrorMessage('Failed to load premade schedule: ' + err.message);
    } finally {
      setLoadingSample(false);
    }
  };

  const processPreview = (rawContent: string, selectedLeague?: string, seasonToUse?: string) => {
    setErrorMessage(null);
    setImportSummary(null);

    const activeTargetLeague = selectedLeague !== undefined ? selectedLeague : getEffectiveTargetLeague(targetLeague, isCustomLeague, customLeagueInput);
    const activeTargetSeason = seasonToUse || targetSeason;

    const { games, errors } = parseScheduleCsv(rawContent, {
      targetLeague: activeTargetLeague || undefined,
      defaultSeason: activeTargetSeason
    });

    if (errors.length > 0 && games.length === 0) {
      setErrorMessage(errors.join(', '));
      setPreviewGames(null);
      return;
    }

    // Check duplicate status for each game preview row in the resolved destination league
    const dupIndices = new Set<number>();
    games.forEach((game, idx) => {
      const homeTeam = existingTeamsList.find(
        t => t.name.trim().toLowerCase() === game.homeTeamName.trim().toLowerCase() &&
             storage.leaguesMatch(t.league, game.group)
      );
      const awayTeam = existingTeamsList.find(
        t => t.name.trim().toLowerCase() === game.awayTeamName.trim().toLowerCase() &&
             storage.leaguesMatch(t.league, game.group)
      );

      if (homeTeam && awayTeam) {
        if (isDuplicateMatch(game, homeTeam.id, awayTeam.id, existingMatchesList)) {
          dupIndices.add(idx);
        }
      }
    });

    setPreviewGames(games);
    setPreviewDuplicates(dupIndices);
  };

  const handleLeagueSelectChange = (val: string) => {
    if (val === '__custom__') {
      setIsCustomLeague(true);
      setTargetLeague('');
      if (csvText) {
        processPreview(csvText, customLeagueInput.trim(), targetSeason);
      }
    } else {
      setIsCustomLeague(false);
      setTargetLeague(val);
      if (csvText) {
        processPreview(csvText, val.trim(), targetSeason);
      }
    }
  };

  const handleCustomLeagueInputChange = (val: string) => {
    setCustomLeagueInput(val);
    if (csvText) {
      processPreview(csvText, val.trim(), targetSeason);
    }
  };

  const handleExecuteImport = async () => {
    if (!csvText.trim()) return;
    setLoading(true);
    setErrorMessage(null);

    const effLeague = getEffectiveTargetLeague(targetLeague, isCustomLeague, customLeagueInput);

    try {
      const summary = await storage.importScheduleFromCsv(csvText, {
        targetLeague: effLeague || undefined,
        defaultSeason: targetSeason
      });

      setImportSummary(summary);
      onSuccess(summary);
    } catch (err: any) {
      setErrorMessage('Import failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const distinctTeams = previewGames
    ? Array.from(new Set(previewGames.flatMap(g => [g.homeTeamName, g.awayTeamName])))
    : [];

  const distinctDates = previewGames
    ? Array.from(new Set(previewGames.map(g => g.date)))
    : [];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 font-sans">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-sans">
                Import Season Schedule
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                Dynamic CSV schedule importer with duplicate avoidance and auto-team creation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Target Season & League Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 font-sans">
                Target Season
              </label>
              <select
                value={targetSeason}
                onChange={(e) => {
                  setTargetSeason(e.target.value);
                  loadExistingData(e.target.value);
                }}
                className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white rounded-lg text-xs sm:text-sm font-bold font-sans cursor-pointer"
              >
                {availableSeasons.map(s => <option key={s} value={s}>{s} Season</option>)}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase font-sans">
                  Apply Schedule To League
                </label>
                {(targetLeague || (isCustomLeague && customLeagueInput.trim())) && (
                  <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded font-sans uppercase">
                    DIRECTED
                  </span>
                )}
              </div>
              
              <div className="space-y-1.5">
                <select
                  value={isCustomLeague ? '__custom__' : targetLeague}
                  onChange={(e) => handleLeagueSelectChange(e.target.value)}
                  className="w-full p-2 bg-white dark:bg-slate-900 border border-blue-400 dark:border-blue-600 text-slate-900 dark:text-white rounded-lg text-xs sm:text-sm font-bold font-sans cursor-pointer focus:ring-2 focus:ring-blue-500 shadow-sm"
                >
                  <option value="">Auto-detect from CSV (uses CSV "Group" column)</option>
                  <optgroup label="Direct Import To Your Existing Leagues">
                    {availableLeagues.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.id} (Existing League)
                      </option>
                    ))}
                  </optgroup>
                  <option value="__custom__">+ Enter Custom League / Division Name...</option>
                </select>

                {isCustomLeague && (
                  <input
                    type="text"
                    value={customLeagueInput}
                    onChange={(e) => handleCustomLeagueInputChange(e.target.value)}
                    placeholder="Enter custom league name (e.g. 9U - Mondays)"
                    autoFocus
                    className="w-full p-2 bg-white dark:bg-slate-900 border border-blue-500 text-slate-900 dark:text-white rounded-lg text-xs sm:text-sm font-bold font-sans outline-none ring-2 ring-blue-400/50"
                  />
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-sans">
                Select your created league to route all games directly into it, regardless of the internal name in your CSV.
              </p>
            </div>
          </div>

          {/* Quick Action: Load Sample Schedule */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 p-3.5 rounded-xl">
            <div className="text-xs">
              <span className="font-bold text-blue-900 dark:text-blue-300 font-sans block">
                Attached Schedule Detected:
              </span>
              <span className="text-blue-700 dark:text-blue-400 font-sans">
                schedule_export_20261102_121804.csv (20 games • 8 teams • 9U 3v3)
              </span>
            </div>
            <button
              onClick={handleLoadSampleSchedule}
              disabled={loadingSample}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all font-sans cursor-pointer shrink-0 flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              {loadingSample ? 'Loading File...' : 'Load 9U 3v3 Premade Schedule'}
            </button>
          </div>

          {/* Tabs: File Upload vs Paste CSV */}
          <div className="border-b border-slate-200 dark:border-slate-800 flex gap-4">
            <button
              onClick={() => setActiveTab('upload')}
              className={`pb-2 text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer font-sans ${activeTab === 'upload' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
            >
              Upload Any CSV File
            </button>
            <button
              onClick={() => setActiveTab('paste')}
              className={`pb-2 text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer font-sans ${activeTab === 'paste' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
            >
              Paste CSV Text
            </button>
          </div>

          {activeTab === 'upload' ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/50 dark:bg-slate-950/50 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <div className="w-12 h-12 mx-auto mb-2 text-slate-400 flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-full">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200 font-sans">
                Click to browse or drag & drop schedule CSV
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                Supports Date, Start Time, End Time, Location, Group, Home Team, Away Team
              </p>
            </div>
          ) : (
            <div>
              <textarea
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  if (e.target.value.trim()) processPreview(e.target.value);
                }}
                rows={6}
                placeholder="Paste your CSV schedule here...&#10;Date,Start Time,End Time,Location,Group,Home Team,Away Team&#10;2026-11-02,6:00 pm,7:00 pm,The Dugout: Tunnels 5/6,9U 3v3,Banana Bros,Raiders Bomb Squad"
                className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 p-3 rounded-xl text-xs text-red-600 dark:text-red-400 font-sans flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Import Success Receipt */}
          {importSummary && (
            <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/60 p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-bold text-sm font-sans">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>Schedule Successfully Provisioned!</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-sans">
                <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-lg border border-green-200 dark:border-green-900">
                  <div className="text-slate-500 dark:text-slate-400">Matches Scheduled</div>
                  <div className="text-lg font-black text-green-600 dark:text-green-400">{importSummary.createdMatches}</div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-lg border border-green-200 dark:border-green-900">
                  <div className="text-slate-500 dark:text-slate-400">Duplicates Skipped</div>
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400">{importSummary.skippedDuplicates}</div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-lg border border-green-200 dark:border-green-900">
                  <div className="text-slate-500 dark:text-slate-400">Teams Created</div>
                  <div className="text-lg font-black text-blue-600 dark:text-blue-400">{importSummary.createdTeams.length}</div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-lg border border-green-200 dark:border-green-900">
                  <div className="text-slate-500 dark:text-slate-400">Divisions Created</div>
                  <div className="text-lg font-black text-purple-600 dark:text-purple-400">{importSummary.createdLeagues.length}</div>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Preview Table */}
          {previewGames && previewGames.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-sans">
                    Schedule Preview ({previewGames.length} Games)
                  </h3>
                  <span className="text-[11px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">
                    {distinctTeams.length} Teams
                  </span>
                  <span className="text-[11px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-bold">
                    {distinctDates.length} Game Dates
                  </span>
                </div>
                {previewDuplicates.size > 0 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-bold">
                    ⚠️ {previewDuplicates.size} duplicate game(s) already in database
                  </span>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase font-bold sticky top-0 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="p-2 sm:p-2.5">Date & Time</th>
                      <th className="p-2 sm:p-2.5">Location</th>
                      <th className="p-2 sm:p-2.5">Division</th>
                      <th className="p-2 sm:p-2.5">Home Team</th>
                      <th className="p-2 sm:p-2.5">Away Team</th>
                      <th className="p-2 sm:p-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {previewGames.map((game, idx) => {
                      const isDup = previewDuplicates.has(idx);
                      return (
                        <tr
                          key={idx}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${isDup ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}
                        >
                          <td className="p-2 sm:p-2.5 whitespace-nowrap font-medium text-slate-900 dark:text-white">
                            <div>{game.date}</div>
                            <div className="text-[10px] text-slate-500">{game.startTime} - {game.endTime}</div>
                          </td>
                          <td className="p-2 sm:p-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                            {game.location}
                          </td>
                          <td className="p-2 sm:p-2.5 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded text-[11px] font-bold inline-block w-fit">
                                {game.group}
                              </span>
                              {game.csvGroup && game.csvGroup !== game.group && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                                  mapped from "{game.csvGroup}"
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 sm:p-2.5 font-bold text-red-600 dark:text-red-400">
                            {game.homeTeamName}
                          </td>
                          <td className="p-2 sm:p-2.5 font-bold text-blue-600 dark:text-blue-400">
                            {game.awayTeamName}
                          </td>
                          <td className="p-2 sm:p-2.5 text-center whitespace-nowrap">
                            {isDup ? (
                              <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-full text-[10px] font-bold">
                                Duplicate (Skip)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-full text-[10px] font-bold">
                                Ready to Schedule
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={handleReset}
            disabled={loading}
            className="w-full sm:w-auto px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-sans cursor-pointer"
          >
            Clear / Reset
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors font-sans cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={handleExecuteImport}
              disabled={loading || !previewGames || previewGames.length === 0}
              className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg transition-all font-sans cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Importing Schedule...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  <span>
                    Import Season Schedule ({previewGames ? previewGames.length : 0} Games)
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
