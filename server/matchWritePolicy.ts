/**
 * Server-side guards for match writes. A match's practice/official identity is
 * set when created and cannot be changed by a later PUT.
 */
export const changesPracticeClassification = (
  storedIsPractice: boolean | null | undefined,
  incomingIsPractice: unknown,
): boolean =>
  incomingIsPractice !== undefined &&
  incomingIsPractice !== null &&
  incomingIsPractice !== (storedIsPractice === true);

/**
 * A scheduled lineup can be edited without taking scoring control while every
 * pitch is still blank. As soon as any pitch has a result (including 0) or
 * tie-breaker data exists, a write requires a scoring lock and revision even
 * if the game was left with status SCHEDULED.
 *
 * Both the stored and submitted snapshots are checked to catch attempts to
 * erase scores as well as attempts to insert them.
 */
export const hasRecordedScores = (innings: unknown, tieBreaker: unknown): boolean => {
  if (tieBreaker !== undefined && tieBreaker !== null) {
    if (!Array.isArray(tieBreaker)) return true;
    if (tieBreaker.length > 0) return true;
  }

  if (innings === undefined || innings === null) return false;
  if (!Array.isArray(innings)) return true;

  for (const inning of innings) {
    if (!inning || typeof inning !== 'object') return true;
    for (const side of ['home', 'away'] as const) {
      const lineup = inning[side]?.playerScores;
      if (lineup === undefined || lineup === null) continue;
      if (!Array.isArray(lineup)) return true;
      for (const player of lineup) {
        if (!player || !Array.isArray(player.pitches)) return true;
        for (const pitch of player.pitches) {
          if (!pitch || typeof pitch !== 'object') return true;
          if (pitch.points !== null && pitch.points !== undefined) return true;
        }
      }
    }
  }
  return false;
};
