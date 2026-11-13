import type { Match } from '../types';

/** Identifies which inning fans should see during a live game. */
export const getLiveInningIndex = (m: Match): number => {
    if (m.tieBreaker && m.tieBreaker.length > 0) return 6;
    for (let i = 0; i < 6; i++) {
        const ing = m.innings[i];
        const isHomeDone = ing.home.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
        const isAwayDone = ing.away.playerScores.every(p => p.pitches.every(pt => pt.points !== null));
        if (!isHomeDone || !isAwayDone) return i;
    }
    return 5;
};

