import React, { useState, useEffect, useMemo, useRef } from 'react';
import { League, ScheduleImportSummary, ScheduleImportDestination, ScheduleImportPreview } from '../types';
import * as storage from '../services/storageService';
import { parseScheduleCsv } from '../utils/scheduleImporter';
import { FileDropzone } from './FileDropzone';

interface ScheduleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (summary: ScheduleImportSummary) => void | Promise<void>;
  currentSeason: string;
  availableLeagues: League[];
}

export const ScheduleImportModal: React.FC<ScheduleImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentSeason,
  availableLeagues
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [csvText, setCsvText] = useState('');
  const [leagueChoices, setLeagueChoices] = useState<Record<string, string>>({});
  const [newLeagueNames, setNewLeagueNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [checkedPlan, setCheckedPlan] = useState<{ key: string; value: ScheduleImportPreview } | null>(null);
  const [importSummary, setImportSummary] = useState<ScheduleImportSummary | null>(null);
  const fileReadVersion = useRef(0);
  const submitting = useRef(false);

  const handleReset = () => {
    fileReadVersion.current++;
    setActiveTab('upload'); setCsvText(''); setLeagueChoices({}); setNewLeagueNames({});
    setSelectedFileName(null); setCheckedPlan(null); setImportSummary(null); setExecutionError(null);
  };
  useEffect(() => { handleReset(); }, [isOpen, currentSeason]);

  const parsed = useMemo(() => csvText.trim() ? parseScheduleCsv(csvText, { defaultSeason: currentSeason }) : { games: [], errors: [] }, [csvText, currentSeason]);
  const sourceGroups = useMemo(() => Array.from(new Set(parsed.games.map(game => game.csvGroup || game.group))), [parsed]);
  const destinations = useMemo(() => {
    const result: Record<string, ScheduleImportDestination> = Object.create(null);
    for (const group of sourceGroups) {
      const choice = Object.prototype.hasOwnProperty.call(leagueChoices, group) ? leagueChoices[group] : '';
      if (choice) result[group] = { mode: choice === '__new__' ? 'new' : 'existing', name: choice === '__new__' ? (newLeagueNames[group] ?? group).trim() : choice };
    }
    return result;
  }, [sourceGroups, leagueChoices, newLeagueNames]);
  const unresolvedGroups = sourceGroups.filter(group => !destinations[group]?.name);

  const requestKey = JSON.stringify([csvText, currentSeason, destinations]);
  const plan = checkedPlan?.key === requestKey ? checkedPlan.value : null;

  // Re-check against the selected leagues whenever CSV/mapping changes. Aborted
  // requests cannot paint an old duplicate preview over a newer selection.
  useEffect(() => {
    setCheckedPlan(null); setPreviewError(null);
    if (!isOpen || !parsed.games.length || parsed.errors.length || unresolvedGroups.length) { setPreviewLoading(false); return; }
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      storage.previewScheduleImport(csvText, { defaultSeason: currentSeason, leagueDestinations: destinations }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setCheckedPlan({ key: requestKey, value: result }); })
        .catch(error => { if (!controller.signal.aborted) setPreviewError(error.message || 'Could not check this schedule.'); })
        .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isOpen, csvText, currentSeason, parsed, destinations, requestKey]);

  const handleFileSelect = (file: File) => {
    if (!file || loading) return;
    if (file.size > 1_000_000) { handleReset(); setExecutionError('Choose a CSV smaller than 1 MB.'); return; }
    const version = ++fileReadVersion.current;
    setSelectedFileName(file.name); setExecutionError(null); setImportSummary(null);
    setCsvText(''); setLeagueChoices({}); setNewLeagueNames({});
    const reader = new FileReader();
    reader.onload = () => { if (version === fileReadVersion.current) setCsvText(String(reader.result || '')); };
    reader.onerror = () => { if (version === fileReadVersion.current) setExecutionError('Could not read the CSV. Try choosing it again.'); };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (submitting.current || !plan || parsed.errors.length || unresolvedGroups.length) return;
    submitting.current = true; setLoading(true); setExecutionError(null);
    try {
      const summary = await storage.importScheduleFromCsv(csvText, { defaultSeason: currentSeason, leagueDestinations: destinations });
      setImportSummary(summary);
      // A refresh failure after a committed import must not be presented as a failed import.
      try { await onSuccess(summary); }
      catch { setExecutionError('The schedule was saved. Close this window and refresh to see it.'); }
    } catch (error) { setExecutionError((error as Error).message || 'No games were imported. Please try again.'); }
    finally { submitting.current = false; setLoading(false); }
  };

  const previewGames = plan?.games || parsed.games;
  const previewDuplicates = new Set(plan?.games.flatMap((game, index) => game.duplicate ? [index] : []) || []);
  const errorMessage = executionError || (parsed.errors.length ? `${parsed.errors.length} row problem(s): ${parsed.errors.slice(0, 5).join(' | ')} Fix these before importing; nothing has been saved.` : previewError);

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
        <div className="shrink-0 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-sans">
                Import Season Schedule
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                Import into the active season with duplicate checks and automatic team creation
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Existing team rosters are reused. New teams can be filled in under Rosters. Imports add games; use Schedule → Edit to change an existing matchup.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Close schedule import"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content Area */}
        <fieldset disabled={loading || !!importSummary} className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 min-h-0 min-w-0 w-full">
          
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
            <FileDropzone
              onFileSelect={handleFileSelect}
              selectedFileName={selectedFileName}
              title="Click to browse or drag & drop schedule CSV"
              subtitle="Supports Date, Start Time, End Time, Location, Group, Home Team, Away Team"
              activeTitle="Drop schedule CSV here"
            />
          ) : (
            <div>
              <textarea
                value={csvText}
                onChange={(e) => {
                  fileReadVersion.current++;
                  setCsvText(e.target.value);
                  setImportSummary(null);
                  setExecutionError(null);
                }}
                rows={6}
                placeholder={`Paste your CSV schedule here...\nDate,Start Time,End Time,Location,Group,Home Team,Away Team\n${currentSeason}-11-02,6:00 pm,7:00 pm,The Dugout: Tunnels 5/6,9U 3v3,Team A,Team B`}
                className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          {/* Active season is fixed. Map every CSV group explicitly before provisioning. */}
          <div id="schedule-league-destinations" className="space-y-3 bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Import into active season: {currentSeason}
            </div>
            {previewGames && previewGames.length > 0 ? (
              <>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Choose a league for each schedule group</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Create a league using the Group column name, give it a different name, or use an existing league.
                  No teams or games are created until you select a destination and import.
                </p>
                {Array.from(new Set(previewGames.map(game => game.csvGroup || game.group))).map(group => (
                  <div key={group} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                    <label className="block text-xs font-bold text-slate-800 dark:text-white">
                      CSV group: {group}
                    </label>
                    <select
                      aria-label={`Destination for ${group}`}
                      value={leagueChoices[group] || ''}
                      onChange={e => {
                        const value = e.target.value;
                        setLeagueChoices(previous => ({ ...previous, [group]: value }));
                        if (value === '__new__') setNewLeagueNames(previous => ({ ...previous, [group]: previous[group] ?? group }));
                      }}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    >
                      <option value="">Select league destination...</option>
                      <option value="__new__">+ Create a new league</option>
                      {availableLeagues.filter(league => !league.season || league.season === currentSeason).map(league => (
                        <option key={league.id} value={league.id}>Add to existing: {league.id}</option>
                      ))}
                    </select>
                    {leagueChoices[group] === '__new__' && (
                      <input
                        aria-label={`New league name for ${group}`}
                        value={newLeagueNames[group] ?? group}
                        onChange={e => setNewLeagueNames(previous => ({ ...previous, [group]: e.target.value }))}
                        placeholder="New league name"
                        className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                      />
                    )}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Upload a schedule to choose which leagues receive its games.</p>
            )}
          </div>

          {plan?.summary.alreadyImported && <p role="status" className="rounded-lg bg-green-50 dark:bg-green-950/40 p-3 text-sm text-green-700 dark:text-green-300">This CSV was already imported. No additional games will be created. Use Schedule to adjust its games.</p>}

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
                <span>{importSummary.alreadyImported ? 'This CSV was already imported. No additional games were created.' : 'Schedule Successfully Provisioned!'}</span>
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
                                {plan?.summary.alreadyImported ? 'Previously Imported' : 'Duplicate (Skip)'}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-full text-[10px] font-bold">
                                {unresolvedGroups.includes(game.csvGroup || game.group) ? 'Choose League' : plan ? 'Ready to Schedule' : 'Needs Check'}
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
        </fieldset>

        {/* Footer Actions */}
        <div className="shrink-0 relative z-10 px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={handleReset}
            disabled={loading}
            className="w-full sm:w-auto px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-sans cursor-pointer"
          >
            Clear / Reset
          </button>

          <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
            {previewLoading && <p role="status" className="text-xs text-slate-500">Checking the schedule for duplicates...</p>}
            {parsed.errors.length > 0 && <p role="status" className="text-xs text-red-600 dark:text-red-300">Fix the CSV problems above to enable Import.</p>}
            {previewError && <p role="status" className="text-xs text-red-600 dark:text-red-300">Schedule check failed. Change the selection or reopen to try again.</p>}
            {unresolvedGroups.length > 0 && (
              <p id="schedule-import-requirements" role="status" className="text-xs font-bold text-amber-700 dark:text-amber-300">
                Choose a destination league for {unresolvedGroups.join(', ')} to enable Import.{' '}
                <button
                  type="button"
                  onClick={() => {
                    const section = document.getElementById('schedule-league-destinations');
                    section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    section?.querySelector('select')?.focus({ preventScroll: true });
                  }}
                  className="underline cursor-pointer"
                >
                  Choose league
                </button>
              </p>
            )}
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
              disabled={loading || previewLoading || !plan || parsed.errors.length > 0 || !!importSummary}
              aria-describedby={unresolvedGroups.length > 0 ? "schedule-import-requirements" : undefined}
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
    </div>
  );
};
