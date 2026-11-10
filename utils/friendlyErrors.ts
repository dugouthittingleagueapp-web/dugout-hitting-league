/**
 * Explain recoverable scoring errors to non-technical umpires/admins.
 * The original technical error remains available in the browser console.
 */
export const explainSaveError = (
  error: unknown,
  action: 'lineup' | 'substitute' | 'finalize' | 'stats' | 'match' = 'match'
): string => {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();
  const task = {
    lineup: 'lineup change',
    substitute: 'new substitute',
    finalize: 'final score',
    stats: 'statistics correction',
    match: 'game changes'
  }[action];

  if (/quota exceeded|storage full|localstorage|securityerror|not enough space/i.test(raw)) {
    return 'Your device could not safely store this score. Check available storage or browser permissions, then retry. Do not assume this pitch was saved.';
  }
  if (/cannot remove a batter|changing the pitch allocation|recorded pitches/i.test(message)) {
    return `Your ${task} was not saved because it would erase pitches already recorded. Keep the scored batter in this inning, or make the substitution in the next inning before scoring begins. Your existing scores are safe.`;
  }
  if (/\b(401|unauthorized|authentication required|session expired)\b/i.test(raw)) {
    return `Your ${task} was not saved because your login may have expired. Sign in again as an umpire or admin, reopen the game, and try again.`;
  }
  if (/\b(403|forbidden|insufficient permissions|only add substitutes|requires an admin)\b/i.test(raw)) {
    return `Your ${task} was not saved because this account does not have permission. Sign in as an authorized umpire or ask an admin to make the change.`;
  }
  if (/\b(404|match not found|team not found)\b/i.test(raw)) {
    return `Your ${task} was not saved because the game or team could not be found. Return to the dashboard, refresh the schedule, and reopen the correct game. Do not recreate an official game until an admin checks it.`;
  }
  if (/\\b(428|precondition required)\\b|opened before the latest update/i.test(raw)) {
    return `Your ${task} was not saved because this page is out of date. Return to the dashboard, reopen the game, and review the scores before retrying.`;
  }
  if (/another device|newer game scores|changed on another device/i.test(raw)) {
    return `Your ${task} was not saved because another umpire updated the game. Nothing was overwritten. Refresh and compare the scores before trying again.`;
  }
  if (/\b(409|conflict)\b/i.test(raw)) {
    return `Your ${task} was not saved because the game changed on another device. Refresh and check the latest scores before making the change again.`;
  }
  if (/\b(429|too many requests|rate limit)\b/i.test(raw)) {
    return `Your ${task} was not saved because the service is busy. Wait a moment, then retry. Check the game after refreshing before entering any scores again.`;
  }
  if (/\b(5\d\d|internal server|server error|database|postgres|neon)\b/i.test(raw)) {
    return `Neon or the game server could not save your ${task}. Keep this page open, check the connection, and try again. If it keeps happening, contact the admin; don't record the same pitches twice.`;
  }
  if (/failed to fetch|network|offline|timeout|timed out|connection|load failed|fetch failed/i.test(raw)) {
    return `Your ${task} was not confirmed because the connection was interrupted. Check Wi-Fi or cellular service and try again. Refresh the game to verify what was saved before entering a score twice.`;
  }
  return `We could not confirm your ${task} was saved. Keep the game open and check the latest scores before retrying. If it happens again, ask an admin for help.`;
};
