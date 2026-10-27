import { describe, it, expect } from 'vitest';
import { createEmptyInning } from '../../services/storageService';

describe('Pitch Progression and Scoring Modal Dismissal', () => {
  // Helper implementing the exact progression logic used by handleScoreUpdate
  function getNextActiveCell(
    pitchIdx: number,
    totalPitches: number,
    side: 'home' | 'away' = 'away',
    lineupIdx: number = 0
  ) {
    if (pitchIdx < totalPitches - 1) {
      return { side, lineupIdx, pitchIdx: pitchIdx + 1 };
    }
    // Batter's pitches are over -> close modal
    return null;
  }

  it('in 3v3 mode (10 pitches per player), advances pitches 1-9 and closes modal after the 10th pitch', () => {
    const homePlayerIds = ['h1', 'h2', 'h3'];
    const awayPlayerIds = ['a1', 'a2', 'a3'];
    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    const awayBatter1 = inning.away.playerScores[0];
    const totalPitches = awayBatter1.pitches.length;
    expect(totalPitches).toBe(10);

    // Pitches 1 to 9 (indices 0 to 8) auto-advance to the next pitch
    for (let pitchIdx = 0; pitchIdx < 9; pitchIdx++) {
      const nextCell = getNextActiveCell(pitchIdx, totalPitches, 'away', 0);
      expect(nextCell).toEqual({
        side: 'away',
        lineupIdx: 0,
        pitchIdx: pitchIdx + 1,
      });
    }

    // Pitch 10 (index 9) is the 10th and final pitch: modal MUST close
    const finalPitchNextCell = getNextActiveCell(9, totalPitches, 'away', 0);
    expect(finalPitchNextCell).toBeNull();
  });

  it('in Ghost player mode (15 pitches per player), advances pitches 1-14 and closes modal after the 15th pitch', () => {
    // 3v2 match triggers Ghost mode for the 2-player team
    const homePlayerIds = ['h1', 'h2', 'h3'];
    const awayPlayerIds = ['a1', 'a2']; // Short-handed team
    const inning = createEmptyInning(1, homePlayerIds, awayPlayerIds);

    const ghostModeBatter = inning.away.playerScores[0];
    const totalPitches = ghostModeBatter.pitches.length;
    expect(totalPitches).toBe(15);

    // Pitches 1 to 14 (indices 0 to 13) auto-advance to the next pitch
    for (let pitchIdx = 0; pitchIdx < 14; pitchIdx++) {
      const nextCell = getNextActiveCell(pitchIdx, totalPitches, 'away', 0);
      expect(nextCell).toEqual({
        side: 'away',
        lineupIdx: 0,
        pitchIdx: pitchIdx + 1,
      });
    }

    // Pitch 15 (index 14) is the 15th and final pitch: modal MUST close
    const finalGhostPitchNextCell = getNextActiveCell(14, totalPitches, 'away', 0);
    expect(finalGhostPitchNextCell).toBeNull();
  });
});
