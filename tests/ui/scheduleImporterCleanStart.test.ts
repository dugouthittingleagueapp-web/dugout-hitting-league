import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Schedule importer clean opening state', () => {
  const source = readFileSync(new URL('../../components/ScheduleImportModal.tsx', import.meta.url), 'utf8');

  it('does not advertise a hardcoded sample as an attached or detected schedule', () => {
    expect(source).not.toContain('Attached Schedule Detected');
    expect(source).not.toContain('Load 9U 3v3 Premade Schedule');
    expect(source).not.toContain('handleLoadSampleSchedule');
    expect(source).not.toContain('schedule_export_20261102_121804');
  });

  it('defaults to the active season, not the previously viewed archive season', () => {
    const admin = readFileSync(new URL('../../components/AdminDashboard.tsx', import.meta.url), 'utf8');
    expect(admin).toContain('setSelectedSeason(targetSeason)');
    expect(admin).toContain('currentSeason={currentSeason}');
    expect(admin).toContain('availableSeasons={Array.from(new Set([...allSeasons, currentSeason]))}');
    expect(source).toContain("setTargetSeason(currentSeason || '2026')");
  });

  it('keeps CSV upload, drag-and-drop and paste import available', () => {
    expect(source).toContain('<FileDropzone');
    expect(source).toContain('onFileSelect={handleFileSelect}');
    expect(source).toContain('Paste CSV Text');
    expect(source).toContain('Schedule import destination');
  });

  it('starts with no file, preview games, or import summary selected', () => {
    expect(source).toContain("useState('')");
    expect(source).toContain('useState<string | null>(null)');
    expect(source).toContain('useState<ScheduledGameRecord[] | null>(null)');
    expect(source).toContain('useState<ScheduleImportSummary | null>(null)');
  });
});
