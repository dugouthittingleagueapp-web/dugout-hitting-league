import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isPlaceholderPlayerName,
  remapMatchPlayerIds,
  extractMatchPlayerSummary,
  autoMapPlaceholdersToRoster
} from '../../utils/statsEditorHelper';
import { fixLastNightStats } from '../../scripts/fix-last-night-stats';
import { Match, Team } from '../../types';

describe('Stats Editor & Fix Last Night Stats Suite', () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dugout-stats-test-'));
    tempDbPath = path.join(tempDir, 'db.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('isPlaceholderPlayerName', () => {
    it('should identify default generated placeholders', () => {
      expect(isPlaceholderPlayerName('C-C-Crushers! Player 1')).toBe(true);
      expect(isPlaceholderPlayerName('C-C-Crushers Player 2')).toBe(true);
      expect(isPlaceholderPlayerName('AYRA Bright Player 3')).toBe(true);
      expect(isPlaceholderPlayerName('Player 1')).toBe(true);
      expect(isPlaceholderPlayerName('player 4')).toBe(true);
      expect(isPlaceholderPlayerName('Sub')).toBe(true);
      expect(isPlaceholderPlayerName('Generic Sub')).toBe(true);
      expect(isPlaceholderPlayerName('Unknown')).toBe(true);
      expect(isPlaceholderPlayerName('TBD')).toBe(true);
      expect(isPlaceholderPlayerName('')).toBe(true);
    });

    it('should not flag real player names as placeholders', () => {
      expect(isPlaceholderPlayerName('Alex Mercer')).toBe(false);
      expect(isPlaceholderPlayerName('Jack Smith')).toBe(false);
      expect(isPlaceholderPlayerName('Leo R.')).toBe(false);
      expect(isPlaceholderPlayerName('Mason Brown')).toBe(false);
    });
  });

  describe('remapMatchPlayerIds', () => {
    const sampleMatch: Match = {
      id: 'match-1',
      date: '2026-11-02T19:00:00Z',
      homeTeamId: 'team-crushers',
      awayTeamId: 'team-bright',
      league: '7-9',
      season: '2026',
      isComplete: true,
      innings: [
        {
          number: 1,
          home: {
            teamId: 'team-crushers',
            playerScores: [
              {
                playerId: 'placeholder-slot-1',
                pitches: [
                  { points: 4 },
                  { points: 3 }
                ]
              },
              {
                playerId: 'placeholder-slot-2',
                pitches: [
                  { points: 2 }
                ]
              }
            ]
          },
          away: {
            teamId: 'team-bright',
            playerScores: []
          }
        }
      ]
    };

    it('should accurately re-map player IDs across innings while preserving scores', () => {
      const remapped = remapMatchPlayerIds(sampleMatch, {
        'placeholder-slot-1': 'official-player-alex',
        'placeholder-slot-2': 'official-player-jack'
      });

      expect(remapped.innings[0].home.playerScores[0].playerId).toBe('official-player-alex');
      expect(remapped.innings[0].home.playerScores[1].playerId).toBe('official-player-jack');

      // Verify points and pitches are intact
      expect(remapped.innings[0].home.playerScores[0].pitches[0].points).toBe(4);
      expect(remapped.innings[0].home.playerScores[0].pitches[1].points).toBe(3);
      expect(remapped.innings[0].home.playerScores[1].pitches[0].points).toBe(2);
    });

    it('should leave unmapped player IDs unchanged', () => {
      const remapped = remapMatchPlayerIds(sampleMatch, {
        'placeholder-slot-1': 'official-player-alex'
      });

      expect(remapped.innings[0].home.playerScores[0].playerId).toBe('official-player-alex');
      expect(remapped.innings[0].home.playerScores[1].playerId).toBe('placeholder-slot-2');
    });
  });

  describe('extractMatchPlayerSummary & autoMapPlaceholdersToRoster', () => {
    const team: Team = {
      id: 'team-crushers',
      name: 'C-C-Crushers!',
      league: '7-9',
      season: '2026',
      players: [
        { id: 'player-official-1', name: 'Liam', lastName: 'Davis' },
        { id: 'player-official-2', name: 'Noah', lastName: 'Wilson' },
        { id: 'player-official-3', name: 'Oliver', lastName: 'Taylor' }
      ]
    };

    const match: Match = {
      id: 'match-crushers-bright',
      date: '2026-11-02',
      homeTeamId: 'team-crushers',
      awayTeamId: 'team-bright',
      league: '7-9',
      season: '2026',
      isComplete: true,
      innings: [
        {
          number: 1,
          home: {
            teamId: 'team-crushers',
            playerScores: [
              {
                playerId: 'team-crushers-p1', // "C-C-Crushers! Player 1"
                pitches: [{ points: 4 }]
              },
              {
                playerId: 'sub-generic-1',
                pitches: [{ points: 3 }]
              }
            ]
          },
          away: { teamId: 'team-bright', playerScores: [] }
        }
      ]
    };

    it('should extract summaries and recognize placeholders', () => {
      const summaries = extractMatchPlayerSummary(match, 'team-crushers', team);
      expect(summaries.length).toBe(2);
      expect(summaries[0].isPlaceholder).toBe(true);
      expect(summaries[0].totalPoints).toBe(4);
      expect(summaries[1].isPlaceholder).toBe(true);
      expect(summaries[1].totalPoints).toBe(3);
    });

    it('should auto-map placeholders to official roster slots', () => {
      const summaries = extractMatchPlayerSummary(match, 'team-crushers', team);
      const autoMap = autoMapPlaceholdersToRoster(summaries, team.players);

      expect(autoMap['team-crushers-p1']).toBe('player-official-1');
      expect(autoMap['sub-generic-1']).toBe('player-official-2');
    });
  });

  describe('fixLastNightStats script against db.json', () => {
    it('should correctly repair last night match in local db.json', async () => {
      const mockDb = {
        teams: [
          {
            id: 'team-crushers-official',
            name: 'C-C-Crushers!',
            league: '7-9',
            season: '2026',
            players: [
              { id: 'crusher-p1', name: 'Jack', lastName: 'Robinson' },
              { id: 'crusher-p2', name: 'Miles', lastName: 'Davis' }
            ]
          },
          {
            id: 'team-bright',
            name: 'AYRA Bright',
            league: '7-9',
            season: '2026',
            players: [{ id: 'bright-p1', name: 'Ben', lastName: 'Solo' }]
          }
        ],
        matches: [
          {
            id: 'match-last-night-nov-2',
            date: '2026-11-02T19:00:00Z',
            homeTeamId: 'team-crushers-official',
            awayTeamId: 'team-bright',
            league: '7-9',
            season: '2026',
            currentInning: 2,
            isComplete: false,
            innings: [
              {
                number: 1,
                home: {
                  teamId: 'team-crushers-official',
                  playerScores: [
                    {
                      playerId: 'team-crushers-official-p1',
                      pitches: [{ points: 4 }]
                    },
                    {
                      playerId: 'team-crushers-official-p2',
                      pitches: [{ points: 3 }]
                    }
                  ]
                },
                away: { teamId: 'team-bright', playerScores: [] }
              }
            ]
          }
        ]
      };

      fs.writeFileSync(tempDbPath, JSON.stringify(mockDb, null, 2), 'utf8');

      const result = await fixLastNightStats({
        dbPath: tempDbPath
      });

      expect(result.success).toBe(true);
      expect(result.matchId).toBe('match-last-night-nov-2');

      const savedDb = JSON.parse(fs.readFileSync(tempDbPath, 'utf8'));
      const savedMatch = savedDb.matches[0];
      expect(savedMatch.status).toBe('FINAL');
      expect(savedMatch.isComplete).toBe(true);
      expect(savedMatch.innings[0].home.playerScores[0].playerId).toBe('crusher-p1');
      expect(savedMatch.innings[0].home.playerScores[1].playerId).toBe('crusher-p2');
    });
  });
});
