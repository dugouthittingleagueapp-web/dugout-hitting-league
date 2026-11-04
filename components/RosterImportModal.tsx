import React, { useState, useRef } from 'react';
import { AgeGroup } from '../types';
import * as storage from '../services/storageService';
import { FileDropzone } from './FileDropzone';

interface RosterImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentLeague: AgeGroup;
  currentSeason: string;
  availableLeagues: string[];
}

type ImportTab = 'text' | 'csv' | 'photo';

interface PreviewPlayer {
  id?: string;
  name: string;
  lastName?: string;
  isSub?: boolean;
}

interface PreviewTeam {
  name: string;
  league: AgeGroup;
  players: PreviewPlayer[];
}

export const RosterImportModal: React.FC<RosterImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentLeague,
  currentSeason,
  availableLeagues
}) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('text');
  const [rawText, setRawText] = useState('');
  const [selectedLeague, setSelectedLeague] = useState<AgeGroup>(currentLeague);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Photo state
  const [imageFile, setImageFile] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);

  // Preview state
  const [previewTeams, setPreviewTeams] = useState<PreviewTeam[] | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    return () => {
      if (imageFile?.previewUrl) {
        try { URL.revokeObjectURL(imageFile.previewUrl); } catch (e) {}
      }
    };
  }, [imageFile]);

  if (!isOpen) return null;

  const handleReset = () => {
    if (imageFile?.previewUrl) {
      try { URL.revokeObjectURL(imageFile.previewUrl); } catch (e) {}
    }
    setRawText('');
    setImageFile(null);
    setPreviewTeams(null);
    setErrorMessage(null);
    setLoading(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  // CSV Parsing
  const handleCsvFileSelect = (file: File) => {
    if (!file) return;
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      parseCsvContent(content);
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read CSV file');
    };
    reader.readAsText(file);
  };

  const parseCsvContent = (content: string) => {
    try {
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) throw new Error('File is empty');

      // Check header row
      const firstLine = lines[0].toLowerCase();
      const hasHeader = firstLine.includes('team') || firstLine.includes('player') || firstLine.includes('name');
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const teamMap: Record<string, PreviewTeam> = {};

      for (const line of dataLines) {
        // Support commas or tabs
        const cols = line.split(/[,\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length === 0 || !cols[0]) continue;

        let teamName = 'Team 1';
        let playerName = '';
        let lastName = '';
        let isSub = false;

        if (cols.length >= 3) {
          // Format: Team, First Name, Last Name
          teamName = cols[0] || 'Team';
          playerName = cols[1] || '';
          lastName = cols[2] || '';
          if (cols[3] && cols[3].toLowerCase().includes('sub')) isSub = true;
        } else if (cols.length === 2) {
          // Format: Team, Full Name OR First, Last
          teamName = cols[0];
          const parts = cols[1].split(/\s+/);
          playerName = parts[0] || '';
          lastName = parts.slice(1).join(' ');
        } else {
          // Single column player name
          const parts = cols[0].split(/\s+/);
          playerName = parts[0] || '';
          lastName = parts.slice(1).join(' ');
        }

        if (!playerName) continue;

        if (!teamMap[teamName]) {
          teamMap[teamName] = {
            name: teamName,
            league: selectedLeague,
            players: []
          };
        }

        teamMap[teamName].players.push({
          name: playerName,
          lastName: lastName || undefined,
          isSub
        });
      }

      const parsed = Object.values(teamMap);
      if (parsed.length === 0) throw new Error('No valid player rows found in CSV');
      setPreviewTeams(parsed);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error parsing CSV file');
    }
  };

  // Photo / Image Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setImageFile({
        base64,
        mimeType: file.type || 'image/jpeg',
        previewUrl: URL.createObjectURL(file)
      });
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  // Parse Text via API (with AI and local fallback)
  const handleParseText = async () => {
    if (!rawText.trim()) {
      setErrorMessage('Please enter or paste roster text first');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await storage.parseRosterInput({
        text: rawText,
        defaultLeague: selectedLeague
      });
      const formatted: PreviewTeam[] = result.map(t => ({
        name: t.name || 'New Team',
        league: (t.league as AgeGroup) || selectedLeague,
        players: [
          ...(t.players || []).map(p => ({ name: p.name, lastName: p.lastName, isSub: false })),
          ...(t.subs || []).map(s => ({ name: s.name, lastName: s.lastName, isSub: true }))
        ]
      }));
      setPreviewTeams(formatted);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to parse roster text');
    } finally {
      setLoading(false);
    }
  };

  // Parse Photo via AI API
  const handleParsePhoto = async () => {
    if (!imageFile) {
      setErrorMessage('Please select a photo or screenshot first');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await storage.parseRosterInput({
        imageBase64: imageFile.base64,
        mimeType: imageFile.mimeType,
        defaultLeague: selectedLeague
      });
      const formatted: PreviewTeam[] = result.map(t => ({
        name: t.name || 'New Team',
        league: (t.league as AgeGroup) || selectedLeague,
        players: [
          ...(t.players || []).map(p => ({ name: p.name, lastName: p.lastName, isSub: false })),
          ...(t.subs || []).map(s => ({ name: s.name, lastName: s.lastName, isSub: true }))
        ]
      }));
      setPreviewTeams(formatted);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to extract roster from photo');
    } finally {
      setLoading(false);
    }
  };

  // Save Confirmed Teams
  const handleSavePreview = async () => {
    if (!previewTeams || previewTeams.length === 0) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const payload: storage.ParsedTeamInput[] = previewTeams
        .map(t => ({
          name: t.name.trim(),
          league: t.league,
          players: t.players.filter(p => !p.isSub && p.name.trim()).map(p => ({ name: p.name.trim(), lastName: p.lastName?.trim() })),
          subs: t.players.filter(p => p.isSub && p.name.trim()).map(p => ({ name: p.name.trim(), lastName: p.lastName?.trim() }))
        }))
        .filter(t => t.name.length > 0 && (t.players.length > 0 || (t.subs && t.subs.length > 0)));

      if (payload.length === 0) {
        throw new Error('No valid teams with player names to save');
      }

      await storage.createTeamsBatch(payload, currentSeason);
      onSuccess();
      handleClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save teams');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 font-sans">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/50">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">Import Rosters & Teams</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Quickly batch-add teams for the <span className="font-bold text-blue-600 dark:text-blue-400">{currentSeason}</span> season.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors font-bold"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl">
              {errorMessage}
            </div>
          )}

          {!previewTeams ? (
            <>
              {/* Target League Selector */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider shrink-0">
                  Target League:
                </label>
                <select
                  value={selectedLeague}
                  onChange={(e) => setSelectedLeague(e.target.value as AgeGroup)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold font-sans focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableLeagues.map((lg) => (
                    <option key={lg} value={lg}>{lg}</option>
                  ))}
                </select>
              </div>

              {/* Format Tabs */}
              <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('text')}
                  className={`pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                    activeTab === 'text'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Paste Text
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('csv')}
                  className={`pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                    activeTab === 'csv'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Upload CSV
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('photo')}
                  className={`pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                    activeTab === 'photo'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Photo / Screenshot
                </button>
              </div>

              {/* Tab 1: Paste Text */}
              {activeTab === 'text' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Paste raw player lists from an email, notepad, or text message. Team headers like <code className="text-blue-600 dark:text-blue-400 font-bold">Team Thunder:</code> or simple lists work automatically.
                  </p>
                  <textarea
                    rows={7}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Example:&#10;Tigers:&#10;John Smith&#10;Bob Miller&#10;Sam Davis&#10;&#10;Eagles:&#10;Chris Lee, Dan Ray, Mike Hall"
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-sans text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={loading || !rawText.trim()}
                      onClick={handleParseText}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Parsing...' : 'Parse & Preview'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Upload CSV */}
              {activeTab === 'csv' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Upload a spreadsheet exported from Excel or Google Sheets. Columns like <span className="font-bold">Team Name, First Name, Last Name</span> are auto-mapped.
                  </p>
                  <FileDropzone
                    onFileSelect={handleCsvFileSelect}
                    accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                    title="Click to choose or drag & drop CSV roster file"
                    subtitle="Supports .csv, .tsv, or .txt"
                    activeTitle="Drop roster file here"
                  />
                </div>
              )}

              {/* Tab 3: Upload Photo / Screenshot */}
              {activeTab === 'photo' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Take a phone photo of a paper clipboard signup sheet or drop a roster screenshot. AI vision will read handwriting or printed names.
                  </p>
                  <input
                    type="file"
                    ref={photoInputRef}
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  {!imageFile ? (
                    <div
                      onClick={() => photoInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-500 dark:hover:border-blue-500 transition-colors bg-slate-50/50 dark:bg-slate-950/20"
                    >
                      <div className="text-2xl mb-1">📸</div>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        Take or choose photo / screenshot
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">Supports JPG, PNG, WEBP</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 max-h-56 bg-black/10 flex items-center justify-center">
                        <img
                          src={imageFile.previewUrl}
                          alt="Roster preview"
                          className="max-h-56 object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => setImageFile(null)}
                          className="absolute top-2 right-2 bg-slate-900/80 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex justify-between items-center">
                        <button
                          type="button"
                          onClick={() => photoInputRef.current?.click()}
                          className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline"
                        >
                          Choose different photo
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={handleParsePhoto}
                          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors disabled:opacity-50"
                        >
                          {loading ? 'Analyzing Photo...' : 'Extract Roster with AI'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Preview & Edit Screen */
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-blue-50/50 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-200 dark:border-blue-900">
                <div>
                  <h3 className="text-xs font-bold uppercase text-blue-900 dark:text-blue-200">
                    Preview: {previewTeams.length} Team{previewTeams.length !== 1 ? 's' : ''} Ready to Import
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Review and edit names before saving into {selectedLeague}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewTeams(null)}
                  className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:underline"
                >
                  Back to input
                </button>
              </div>

              <div className="space-y-4">
                {previewTeams.map((team, tIdx) => (
                  <div
                    key={tIdx}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/30 space-y-2.5"
                  >
                    <div className="flex gap-2 items-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Team:</span>
                      <input
                        type="text"
                        value={team.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPreviewTeams(prev => prev ? prev.map((t, i) => i === tIdx ? { ...t, name: val } : t) : null);
                        }}
                        className="flex-1 px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-sans"
                        placeholder="Team Name"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewTeams(prev => prev ? prev.filter((_, i) => i !== tIdx) : null);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 font-bold"
                      >
                        Remove
                      </button>
                    </div>

                    {/* Players list */}
                    <div className="space-y-1.5 pl-2 border-l-2 border-blue-500/30">
                      {team.players.map((player, pIdx) => (
                        <div key={pIdx} className="flex gap-2 items-center text-xs">
                          <input
                            type="text"
                            value={player.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPreviewTeams(prev => prev ? prev.map((t, i) => i === tIdx ? {
                                ...t,
                                players: t.players.map((p, pi) => pi === pIdx ? { ...p, name: val } : p)
                              } : t) : null);
                            }}
                            placeholder="First Name"
                            className="w-28 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                          <input
                            type="text"
                            value={player.lastName || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPreviewTeams(prev => prev ? prev.map((t, i) => i === tIdx ? {
                                ...t,
                                players: t.players.map((p, pi) => pi === pIdx ? { ...p, lastName: val } : p)
                              } : t) : null);
                            }}
                            placeholder="Last Name"
                            className="w-32 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTeams(prev => prev ? prev.map((t, i) => i === tIdx ? {
                                ...t,
                                players: t.players.map((p, pi) => pi === pIdx ? { ...p, isSub: !p.isSub } : p)
                              } : t) : null);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              player.isSub
                                ? 'bg-amber-500/10 border-amber-500/40 text-amber-600'
                                : 'bg-blue-500/10 border-blue-500/40 text-blue-600'
                            }`}
                          >
                            {player.isSub ? 'Sub' : 'Active'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTeams(prev => prev ? prev.map((t, i) => i === tIdx ? {
                                ...t,
                                players: t.players.filter((_, pi) => pi !== pIdx)
                              } : t) : null);
                            }}
                            className="text-slate-400 hover:text-red-500 px-1 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => {
                          setPreviewTeams(prev => prev ? prev.map((t, i) => i === tIdx ? {
                            ...t,
                            players: [...t.players, { name: '', isSub: false }]
                          } : t) : null);
                        }}
                        className="text-[11px] text-blue-600 dark:text-blue-400 font-bold hover:underline pt-1"
                      >
                        + Add Player
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors font-sans"
          >
            Cancel
          </button>
          {previewTeams && (
            <button
              type="button"
              disabled={loading || previewTeams.length === 0}
              onClick={handleSavePreview}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors shadow-sm disabled:opacity-50 font-sans"
            >
              {loading ? 'Saving Teams...' : `Save ${previewTeams.length} Team${previewTeams.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
