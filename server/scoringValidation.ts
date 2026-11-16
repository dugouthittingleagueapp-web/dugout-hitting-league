import type { Match, Team } from '../types';
import { validPoints, stableJson, ScoringProtocolError } from '../utils/scoringProtocol.js';
import { remapMatchPlayerIds } from '../utils/statsEditorHelper.js';

export type SnapshotIntent = { kind: 'resetPractice' } | { kind: 'reassign'; mapping: Record<string, string> };
const invalid = (message = 'The game information is incomplete. No changes were saved.') => {
  throw new ScoringProtocolError('INVALID_SCORING_STATE', message);
};

/** Runtime validation is required even when a caller has a valid umpire session. */
export const validateScoreState = (match: Match, home: Team, away: Team): void => {
  const practice = match.isPractice === true || match.is_practice === true;
  if (!Array.isArray(match.innings) || (practice ? match.innings.length < 1 || match.innings.length > 12 : match.innings.length !== 6)) invalid();
  const roster = (t: Team) => new Set([...(t.players || []), ...(t.subs || [])].map(p => p.id));
  const rosters = { home: roster(home), away: roster(away) };
  for (const [index, inning] of match.innings.entries()) {
    if (!inning || inning.number !== index + 1) invalid();
    const hc = inning.home?.playerScores?.length, ac = inning.away?.playerScores?.length;
    if (![2, 3].includes(hc) || ![2, 3].includes(ac)) invalid('Choose two or three different players for each team. No changes were saved.');
    for (const side of ['home', 'away'] as const) {
      if (![side, side === 'home' ? match.homeTeamId : match.awayTeamId].includes(inning[side]?.teamId)) invalid();
      const players = inning[side]?.playerScores;
      if (!Array.isArray(players) || new Set(players.map(p => p?.playerId)).size !== players.length) invalid();
      const expected = side === 'home' ? hc === 2 && ac === 3 ? 15 : 10 : ac === 2 && hc === 3 ? 15 : 10;
      for (const player of players) {
        if (!player || typeof player.playerId !== 'string' || !rosters[side].has(player.playerId)) invalid('A player is not on this team. No changes were saved.');
        if (!Array.isArray(player.pitches) || player.pitches.length !== expected ||
            player.pitches.some(p => !p || !validPoints(p.points))) invalid('A pitch is not valid. No changes were saved.');
      }
    }
    if (inning.home.playerScores.some(p => inning.away.playerScores.some(a => a.playerId === p.playerId))) invalid();
  }
  if (match.tieBreaker !== undefined && (!Array.isArray(match.tieBreaker) || match.tieBreaker.length > 100)) invalid();
  for (const [index, round] of (match.tieBreaker || []).entries()) {
    const limit = index === 0 ? 5 : index === 1 ? 3 : 1;
    if (!round || round.roundNumber !== index + 1 || round.pitchLimit !== limit ||
        !rosters.home.has(round.homePlayerId) || !rosters.away.has(round.awayPlayerId) ||
        !Array.isArray(round.homeScores) || !Array.isArray(round.awayScores) ||
        round.homeScores.length !== limit || round.awayScores.length !== limit ||
        [...round.homeScores, ...round.awayScores].some(p => !validPoints(p))) invalid('The extra-inning information is not valid. No changes were saved.');
  }
};

export const validateScoringFlags = (body: Record<string, unknown>): void => {
  for (const [a, b] of [['isPractice', 'is_practice'], ['isForfeit', 'is_forfeit']]) {
    if ((body[a] !== undefined && typeof body[a] !== 'boolean') || (body[b] !== undefined && typeof body[b] !== 'boolean') ||
        (body[a] !== undefined && body[b] !== undefined && body[a] !== body[b])) invalid('The game classification is not valid. No changes were saved.');
  }
  if (body.isComplete !== undefined && typeof body.isComplete !== 'boolean') invalid();
};

export const validatedForfeitWinner = (flag: boolean, forfeiter: unknown, winner: unknown, homeId: string, awayId: string): string | null => {
  if (winner !== null && winner !== undefined && winner !== homeId && winner !== awayId) invalid('The winning team must belong to this game. No changes were saved.');
  if (!flag) return null;
  if (forfeiter !== homeId && forfeiter !== awayId) invalid('Choose the forfeiting team from this game. No changes were saved.');
  const expected = forfeiter === homeId ? awayId : homeId;
  if (winner !== null && winner !== undefined && winner !== expected) invalid('The forfeit result does not match these teams. No changes were saved.');
  return expected;
};

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
/** Legacy full snapshots may add scores, but cannot alter/delete existing results. */
export const assertSafeSnapshotTransition = (before: Match, after: Match, intent: unknown, role: 'admin' | 'umpire'): void => {
  const reset = (intent as SnapshotIntent)?.kind === 'resetPractice';
  if (reset) {
    if (!before.isPractice && !before.is_practice) invalid('Only a practice game can be reset. No changes were saved.');
    if (after.innings.some(i => ['home', 'away'].some(s => i[s as 'home' | 'away'].playerScores.some(p => p.pitches.some(v => v.points !== null)))) || after.tieBreaker?.length) invalid();
    return;
  }
  if (before.isComplete && (!after.isComplete || after.status !== before.status))
    throw new ScoringProtocolError('FINAL_GAME_LOCKED', 'This game is finished. Its results cannot be reopened.');
  let protectedBefore = before;
  if ((intent as SnapshotIntent)?.kind === 'reassign') {
    if (role !== 'admin') invalid('Only an admin can reassign recorded player results.');
    const mapping = (intent as Extract<SnapshotIntent, { kind: 'reassign' }>).mapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.entries(mapping).some(([a, b]) => !a || typeof b !== 'string' || !b)) invalid();
    protectedBefore = remapMatchPlayerIds(before, mapping);
    // Reassignment can change identifiers, never any score or inning structure.
    if (!same(protectedBefore.innings, after.innings) || !same(protectedBefore.tieBreaker || [], after.tieBreaker || [])) invalid();
  } else if (intent !== undefined) invalid();
  const fail = () => { throw new ScoringProtocolError('SCORE_HISTORY_LOCKED', 'This save would replace recorded pitches. Your changes were not applied. Keep the game open and ask for help.'); };
  if (before.homeTeamId !== after.homeTeamId || before.awayTeamId !== after.awayTeamId) {
    if (before.innings.some(i => ['home', 'away'].some(s => i[s as 'home' | 'away'].playerScores.some(p => p.pitches.some(v => v.points !== null))))) fail();
  }
  for (const inning of protectedBefore.innings || []) for (const side of ['home', 'away'] as const) {
    const next = after.innings.find(i => i.number === inning.number)?.[side];
    for (const p of inning[side]?.playerScores || []) for (const [index, pitch] of p.pitches.entries()) {
      if (pitch.points !== null && next?.playerScores.find(n => n.playerId === p.playerId)?.pitches[index]?.points !== pitch.points) fail();
    }
  }
  for (const round of protectedBefore.tieBreaker || []) {
    const next = after.tieBreaker?.find(r => r.roundNumber === round.roundNumber);
    if (!next || next.pitchLimit !== round.pitchLimit || next.homePlayerId !== round.homePlayerId || next.awayPlayerId !== round.awayPlayerId) fail();
    for (const side of ['homeScores', 'awayScores'] as const) for (const [i, value] of round[side].entries())
      if (value !== null && next![side]?.[i] !== value) fail();
  }
};
