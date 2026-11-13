import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('Consolidated release: scoring controls are not accidentally reverted', () => {
  it('keeps one Exit control in the scoreboard header and the choices inside its modal', () => {
    const board = read('components/Scoreboard.tsx');
    expect((board.match(/<span>Exit<\/span>/g) || []).length).toBe(1);
    expect(board).not.toContain('Exit & Finalize Fast Action in Header');
    expect(board).toContain('Save & Exit');
    expect(board).toContain('Exit & Finalize');
  });

  it('shows only confirmed saving success, not an instant optimistic checkmark', () => {
    const board = read('components/Scoreboard.tsx');
    const dialog = read('components/ScoreInput.tsx');
    const storage = read('services/storageService.ts');
    expect(board).toContain("saveState === 'saved'");
    expect(board).toContain('✓ All scores saved');
    expect(dialog).toContain('✓ Saved');
    expect(storage).toContain("publishScoringSaveState(match.id, 'saving')");
    expect(storage).toContain("publishScoringSaveState(match.id, 'saved')");
    expect(storage).toContain("publishScoringSaveState(match.id, 'offline')");
  });

  it('keeps Guide and Exit Admin clickable above the navigation overlay', () => {
    const admin = read('components/AdminDashboard.tsx');
    const app = read('App.tsx');
    expect(admin).toContain('relative z-[1200]');
    expect(admin).toContain('relative z-[1201] pointer-events-auto');
    expect(admin).toContain('setShowGuide(true)');
    expect(admin).toContain('event.stopPropagation(); onBack();');
    expect(admin).toContain('createPortal(<UserGuide onClose={() => setShowGuide(false)} />, document.body)');
    expect(app).toContain("view: 'league_select', currentLeague: null, currentMatchId: null");
  });

  it('lets Admin pick a league for practice without changing league-dashboard practice setup', () => {
    const app = read('App.tsx');
    const modal = read('components/PracticeSetupModal.tsx');
    expect(app).toContain("allowLeagueSelection={state.view === 'admin'}");
    expect(modal).toContain('storage.getLeagues(season), storage.getTeams(null, season)');
    expect(modal).toContain('id="practice-league-select"');
    expect(modal).toContain("setSelectedPracticeLeague(event.target.value)");
    expect(modal).toContain("storage.leaguesMatch(team.league, selectedPracticeLeague)");
    expect(modal).toContain("league: effectiveLeague");
    expect(modal).toContain('Practice games do not count toward official standings');
    expect(modal).not.toContain('automatically deleted on exit');
  });

  it('keeps the operational guide anchored at the top with its own scroll area', () => {
    const guide = read('components/UserGuide.tsx');
    expect(guide).toContain('flex items-start justify-center');
    expect(guide).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(guide).toContain('h-[100dvh]');
    expect(guide).not.toContain('flex items-center justify-center bg-slate-900/80');
  });

  it('refuses unknown migration history in existing databases', () => {
    const migrations = read('api/migrations.ts');
    expect(migrations).toContain("to_regclass('public.schema_migrations')");
    expect(migrations).toContain('Refusing automatic changes until a reviewed baseline is recorded');
  });
});
