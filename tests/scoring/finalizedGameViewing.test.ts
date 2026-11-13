import { describe, expect, it } from 'vitest';
import { isFinishedScoringLockError } from '../../utils/scoringAccess';

describe('Umpire finalized-game viewing', () => {
  it('recognizes only the finished-game lock response for read-only viewing', () => {
    expect(isFinishedScoringLockError('This game is already finished.')).toBe(true);
    expect(isFinishedScoringLockError(' This game is already finished. ')).toBe(true);
    expect(isFinishedScoringLockError('Another umpire is already scoring this game.')).toBe(false);
    expect(isFinishedScoringLockError('Could not check scoring access. Please try again.')).toBe(false);
    expect(isFinishedScoringLockError('Game not found.')).toBe(false);
    expect(isFinishedScoringLockError('')).toBe(false);
  });
});
