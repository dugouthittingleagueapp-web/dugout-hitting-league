import { describe, it, expect } from 'vitest';
import { leaguesMatch, normalizeLeague, getTeams, getMatches, getLeagues } from '../../services/storageService';
import { ARCHIVE_2025_TEAMS, ARCHIVE_2025_MATCHES, ARCHIVE_2025_LEAGUES } from '../../services/archive2025Data';

describe('2025 Archive Historical Data & League Normalization', () => {
  it('correctly normalizes and matches league division names regardless of casing or whitespace', () => {
    expect(normalizeLeague('9u')).toBe('9u');
    expect(normalizeLeague('9U')).toBe('9u');
    expect(normalizeLeague(' 9u  ')).toBe('9u');
    expect(normalizeLeague('11u')).toBe('11u');
    expect(normalizeLeague('11U')).toBe('11u');

    expect(leaguesMatch('9u', '9U')).toBe(true);
    expect(leaguesMatch('9U', '9u')).toBe(true);
    expect(leaguesMatch('11u', '11U')).toBe(true);
    expect(leaguesMatch('11U', '11u')).toBe(true);
    expect(leaguesMatch('9u', '11u')).toBe(false);
    expect(leaguesMatch(null, '9u')).toBe(false);
  });

  it('guarantees 2025 archive data is present and well-formed with actual 9U and 11U leagues', () => {
    expect(ARCHIVE_2025_LEAGUES.length).toBe(2);
    const leagueIds = ARCHIVE_2025_LEAGUES.map(l => l.id.toLowerCase());
    expect(leagueIds).toContain('9u');
    expect(leagueIds).toContain('11u');
    expect(leagueIds).not.toContain('10u');
    expect(leagueIds).not.toContain('12u');
    expect(leagueIds).not.toContain('varsity');

    expect(ARCHIVE_2025_TEAMS.length).toBe(14);
    const teams9u = ARCHIVE_2025_TEAMS.filter(t => leaguesMatch(t.league, '9u'));
    expect(teams9u.length).toBe(7);
    expect(teams9u.map(t => t.name)).toContain('BDM Boys');
    expect(teams9u.map(t => t.name)).toContain('Six Seven');
    expect(teams9u.map(t => t.name)).toContain('Team 456');

    const teams11u = ARCHIVE_2025_TEAMS.filter(t => leaguesMatch(t.league, '11u'));
    expect(teams11u.length).toBe(7);
    expect(teams11u.map(t => t.name.trim())).toContain('Firebirds');
    expect(teams11u.map(t => t.name)).toContain('Summer Boyz');
    expect(teams11u.map(t => t.name)).toContain('Thunder');

    expect(ARCHIVE_2025_MATCHES.length).toBe(24);
    const matches9u = ARCHIVE_2025_MATCHES.filter(m => leaguesMatch(m.league, '9u'));
    expect(matches9u.length).toBe(12);
    expect(matches9u.every(m => m.isComplete)).toBe(true);

    const matches11u = ARCHIVE_2025_MATCHES.filter(m => leaguesMatch(m.league, '11u'));
    expect(matches11u.length).toBe(12);
    expect(matches11u.every(m => m.isComplete)).toBe(true);
  });

  it('populates 2025 archive teams for both uppercase and lowercase queries', async () => {
    const lowerTeams = await getTeams('9u', '2025');
    const upperTeams = await getTeams('9U', '2025');

    expect(lowerTeams.length).toBe(7);
    expect(upperTeams.length).toBe(7);
    expect(lowerTeams[0].name).toBe(upperTeams[0].name);

    const lowerTeams11 = await getTeams('11u', '2025');
    const upperTeams11 = await getTeams('11U', '2025');
    expect(lowerTeams11.length).toBe(7);
    expect(upperTeams11.length).toBe(7);
  });

  it('populates 2025 archive matches for both uppercase and lowercase queries', async () => {
    const lowerMatches = await getMatches('9u', '2025');
    const upperMatches = await getMatches('9U', '2025');

    expect(lowerMatches.length).toBe(12);
    expect(upperMatches.length).toBe(12);
    expect(lowerMatches.length).toBe(upperMatches.length);

    const lowerMatches11 = await getMatches('11u', '2025');
    const upperMatches11 = await getMatches('11U', '2025');
    expect(lowerMatches11.length).toBe(12);
    expect(upperMatches11.length).toBe(12);
  });

  it('populates 2025 archive leagues list', async () => {
    const leagues = await getLeagues('2025');
    expect(leagues.length).toBe(2);
    const ids = leagues.map(l => l.id.toLowerCase());
    expect(ids).toContain('9u');
    expect(ids).toContain('11u');
    expect(ids).not.toContain('10u');
  });
});
