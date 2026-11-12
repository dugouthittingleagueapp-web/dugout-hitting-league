/**
 * The API deliberately rejects scoring locks on final games.
 * An umpire asking to View that game should see its scores read-only.
 * Do not treat other lock failures (another umpire, lost connection, etc.)
 * as permission to bypass the scoring lock.
 */
export const isFinishedScoringLockError = (message: string): boolean =>
  message.trim() === 'This game is already finished.';
