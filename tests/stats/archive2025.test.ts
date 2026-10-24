import { describe, it, expect } from 'vitest';
import { leaguesMatch, normalizeLeague, getTeams, getMatches, getLeagues } from '../../services/storageService';
import { ARCHIVE_2025_TEAMS, ARCHIVE_2025_MATCHES, ARCHIVE_2025_LEAGUES } from '../../services/archive2025Data';

describe('2025 Archive Historical Data & League Normalization', () => {
  it('correctly normalizes and matches league division names regardless of casing or whitespace', () => {
    expect(normalizeLeague('10u')).toBe('10u');
    expect(normalizeLeague('10U')).toBe('10u');
    expect(normalizeLeague(' 10u  ')).toBe('10u');
    expect(normalizeLeague('VARSITY')).toBe('varsity');
    expect(normalizeLeague('Varsity')).toBe('varsity');

    expect(leaguesMatch('10u', '10U')).toBe(true);
    expect(leaguesMatch('10U', '10u')).toBe(true);
    expect(leaguesMatch('12u', '12U')).toBe(true);
    expect(leaguesMatch('Varsity', 'varsity')).toBe(true);
    expect(leaguesMatch('10u', '12u')).toBe(false);
    expect(leaguesMatch(null, '10u')).toBe(false);
  });

  it('guarantees 2025 archive data is present and well-formed', () => {
    expect(ARCHIVE_2025_LEAGUES.length).toBeGreaterThanOrEqual(3);
    expect(ARCHIVE_2025_LEAGUES.map(l => l.id.toLowerCase())).toContain('10u');
    expect(ARCHIVE_2025_LEAGUES.map(l => l.id.toLowerCase())).toContain('12u');
    expect(ARCHIVE_2025_LEAGUES.map(l => l.id.toLowerCase())).toContain('varsity');

    expect(ARCHIVE_2025_TEAMS.length).toBe(12);
    const teams10u = ARCHIVE_2025_TEAMS.filter(t => leaguesMatch(t.league, '10u'));
    expect(teams10u.length).toBe(4);
    expect(teams10u.map(t => t.name)).toContain('Iron Pigs');
    expect(teams10u.map(t => t.name)).toContain('Mudcats');

    expect(ARCHIVE_2025_MATCHES.length).toBeGreaterThan(0);
    const matches10u = ARCHIVE_2025_MATCHES.filter(m => leaguesMatch(m.league, '10u'));
    expect(matches10u.length).toBeGreaterThan(0);
    expect(matches10u.every(m => m.isComplete)).toBe(true);
  });

  it('populates 2025 archive teams for both uppercase and lowercase queries', async () => {
    const lowerTeams = await getTeams('10u', '2025');
    const upperTeams = await getTeams('10U', '2025');

    expect(lowerTeams.length).toBe(4);
    expect(upperTeams.length).toBe(4);
    expect(lowerTeams[0].name).toBe(upperTeams[0].name);
  });

  it('populates 2025 archive matches for both uppercase and lowercase queries', async () => {
    const lowerMatches = await getMatches('10u', '2025');
    const upperMatches = await getMatches('10U', '2025');

    expect(lowerMatches.length).toBeGreaterThan(0);
    expect(upperMatches.length).toBeGreaterThan(0);
    expect(lowerMatches.length).toBe(upperMatches.length);
  });

  it('populates 2025 archive leagues list', async () => {
    const leagues = await getLeagues('2025');
    expect(leagues.length).toBeGreaterThanOrEqual(3);
    const ids = leagues.map(l => l.id.toLowerCase());
    expect(ids).toContain('10u');
  });
});
