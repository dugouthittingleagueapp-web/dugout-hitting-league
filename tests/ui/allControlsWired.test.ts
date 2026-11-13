import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const uiFiles = [
  'App.tsx',
  'components/AdminDashboard.tsx',
  'components/FileDropzone.tsx',
  'components/MatchSetup.tsx',
  'components/MatchStatsEditorModal.tsx',
  'components/Navbar.tsx',
  'components/PlayerCareerModal.tsx',
  'components/PracticeSetupModal.tsx',
  'components/RosterImportModal.tsx',
  'components/ScheduleImportModal.tsx',
  'components/ScoreInput.tsx',
  'components/Scoreboard.tsx',
  'components/SetLineupModal.tsx',
  'components/TeamManagement.tsx',
  'components/UserGuide.tsx',
] as const;

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

/**
 * Inspect each opening JSX tag rather than all the surrounding component
 * content. Parentheses and arrow-function '>' characters inside { } do not
 * close a JSX opening tag.
 */
function openingTags(source: string, name: 'button' | 'select' | 'form') {
  const starts = [...source.matchAll(new RegExp(`<${name}\\b`, 'g'))];
  return starts.map(match => {
    const start = match.index;
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
      const ch = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { depth = Math.max(0, depth - 1); continue; }
      if (ch === '>' && depth === 0) {
        return { tag: source.slice(start, index + 1), line: source.slice(0, start).split('\n').length };
      }
    }
    throw new Error(`Unterminated ${name} at source offset ${start}`);
  });
}

describe('Every UI screen has connected controls', () => {
  it('registers every JSX button with a click handler or a form submit', () => {
    let checked = 0;
    for (const path of uiFiles) {
      const missing = openingTags(read(path), 'button')
        .filter(({ tag }) => !/\bonClick\s*=/.test(tag) && !/\btype\s*=\s*["']submit["']/.test(tag))
        .map(({ line }) => `${path}:${line}`);
      expect(missing, `Buttons without an action in ${path}`).toEqual([]);
      checked += openingTags(read(path), 'button').length;
    }
    expect(checked).toBeGreaterThanOrEqual(190);
  });

  it('registers every dropdown with a change handler', () => {
    let checked = 0;
    for (const path of uiFiles) {
      const missing = openingTags(read(path), 'select')
        .filter(({ tag }) => !/\bonChange\s*=/.test(tag))
        .map(({ line }) => `${path}:${line}`);
      expect(missing, `Dropdowns without an action in ${path}`).toEqual([]);
      checked += openingTags(read(path), 'select').length;
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it('connects forms to submit handlers', () => {
    for (const path of uiFiles) {
      const missing = openingTags(read(path), 'form')
        .filter(({ tag }) => !/\bonSubmit\s*=/.test(tag))
        .map(({ line }) => `${path}:${line}`);
      expect(missing, `Forms without a submit handler in ${path}`).toEqual([]);
    }
  });

  it('retains critical admin and scoring actions', () => {
    const admin = read('components/AdminDashboard.tsx');
    const app = read('App.tsx');
    const board = read('components/Scoreboard.tsx');
    const practice = read('components/PracticeSetupModal.tsx');
    expect(admin).toContain('setShowGuide(true)');
    expect(admin).toContain('event.stopPropagation(); onBack();');
    expect(admin).toContain('onClick={onStartPractice}');
    expect(app).toContain("allowLeagueSelection={state.view === 'admin'}");
    expect(practice).toContain('id="practice-league-select"');
    expect(practice).toContain('storage.getLeagues(season), storage.getTeams(null, season)');
    expect(practice).toContain('league: effectiveLeague');
    expect(board).toContain('onClick={handleExitRequest}');
    expect(board).toContain('onClick={handleSaveAndExit}');
    expect(board).toContain('onClick={() => handleExitAndFinalize(false)}');
    expect(board).toContain('onClick={onRetrySync}');
    expect(read('components/ScoreInput.tsx')).toContain('onClick={() => handleSelect(score)}');
  });
});
