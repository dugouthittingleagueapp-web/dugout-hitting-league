/**
 * Messages for teen umpires: say what happened and one safe next action.
 * Technical codes stay in logs. Never suggest reloading when pitches could
 * exist only on this device.
 */
type SaveAction = 'lineup' | 'substitute' | 'finalize' | 'stats' | 'match';

export const explainSaveError = (
  error: unknown,
  action: SaveAction = 'match'
): string => {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const task = {
    lineup: 'lineup',
    substitute: 'player',
    finalize: 'game',
    stats: 'score correction',
    match: 'change'
  }[action];

  if (/local recovery copy|device storage|offline pitch backup|unreadable/i.test(raw)) {
    return 'This score could not be saved on this device. Please stop scoring for a moment and ask the person running the league for help. Keep this page open.';
  }
  if (/some pitches are only saved on this device|unconfirmed offline pitches|synchronize them/i.test(raw)) {
    return 'A few scores are still waiting to be sent. Keep this page open and check your internet connection. Try again once they finish saving.';
  }
  if (/current scoring version is unknown|no current server revision|reopen it/i.test(raw)) {
    return 'The game has newer information. Before changing the lineup or ending the game, ask the person running the league to help check the scores.';
  }
  if (/cannot remove a batter|changing the pitch allocation|recorded pitches/i.test(raw)) {
    return 'This player already has scores in this inning. Keep them in the lineup for now, or make the change at the start of the next inning.';
  }
  if (/\b(401|unauthorized|authentication required|session expired)\b/i.test(raw)) {
    return 'Your sign-in has ended. Please sign in again, then try that change.';
  }
  if (/\b(403|forbidden|insufficient permissions|only add substitutes|requires an admin)\b/i.test(raw)) {
    return 'You cannot make this change from this account. Ask the person running the league for help.';
  }
  if (/\b(404|match not found|team not found)\b/i.test(raw)) {
    return 'We could not find this game or team. Please ask the person running the league to check it. Do not create another game.';
  }
  if (/\b(423|scoring_locked)\b|another umpire|scoring is not ready|transfer control/i.test(raw)) {
    return 'Another umpire is scoring this game. Your latest change was not confirmed. Keep this page open and ask the person running the league to help.';
  }
  if (/\b(409|428|conflict|another device|lineup or pitch has changed)\b/i.test(raw)) {
    return 'Someone else may have changed this game. Your latest change was not confirmed. Keep this page open and ask the person running the league to check the scores with you.';
  }
  if (/\b(429|too many requests|rate limit)\b/i.test(raw)) {
    return 'The app is a little busy. Give it a moment, then try again. Check the score first so you do not enter it twice.';
  }
  if (/\b(5\d\d|internal server|server error|database|postgres|neon)\b/i.test(raw)) {
    return 'The app could not finish saving your ' + task + ' right now. Keep this page open, check your connection, and ask for help if it continues.';
  }
  if (/failed to fetch|network|offline|timeout|timed out|connection|load failed|fetch failed/i.test(raw)) {
    return 'The connection dropped for a moment. Keep this page open while the app tries again. Your scores may still be saved on this device.';
  }
  return 'That ' + task + ' could not be finished just now. Keep this page open and ask the person running the league if you need help.';
};

export const explainPitchSyncIssue = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/unreadable|invalid|storage|recovery/i.test(raw)) {
    return 'Please stop scoring for a moment and ask the person running the league for help. Keep this page open.';
  }
  if (/409|428|conflict|changed|newer|lineup|already/i.test(raw)) {
    return 'Another score may have been entered for the same pitch. Keep this page open and ask the person running the league to check it with you.';
  }
  if (/401|unauthorized|sign.?in|session/i.test(raw)) {
    return 'Please sign in again. Keep this page open so your scores stay here.';
  }
  return 'A score needs a little help saving. Keep this page open, check your connection, and ask for help if it does not clear.';
};
