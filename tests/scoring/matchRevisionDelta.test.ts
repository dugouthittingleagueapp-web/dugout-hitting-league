import { describe, expect, it } from 'vitest';
import { getMatchRevisionDelta } from '../../utils/matchRevisionDelta';

describe('lightweight dashboard change detection', () => {
  it('does not download full match details when nothing changed', () => {
    const previous = [{ id: 'game-1', revision: 'abc' }, { id: 'game-2', revision: 'def' }];
    expect(getMatchRevisionDelta(previous, [...previous])).toEqual({ changedIds: [], removedIds: [] });
  });

  it('fetches only the game with changed pitches or corrected metadata', () => {
    expect(getMatchRevisionDelta(
      [{ id: 'one', revision: 'score-a' }, { id: 'two', revision: 'same' }],
      [{ id: 'one', revision: 'score-b' }, { id: 'two', revision: 'same' }]
    )).toEqual({ changedIds: ['one'], removedIds: [] });
  });

  it('adds new games without refreshing all historical records', () => {
    expect(getMatchRevisionDelta(
      [{ id: 'old', revision: 'x' }],
      [{ id: 'old', revision: 'x' }, { id: 'new', revision: 'y' }]
    )).toEqual({ changedIds: ['new'], removedIds: [] });
  });

  it('removes deleted practice games from the schedule', () => {
    expect(getMatchRevisionDelta(
      [{ id: 'old', revision: 'x' }, { id: 'practice-123', revision: 'y' }],
      [{ id: 'old', revision: 'x' }]
    )).toEqual({ changedIds: [], removedIds: ['practice-123'] });
  });

  it('does not miss a corrected pitch with the same score total', () => {
    // Revision is calculated using the full stored DB row, not just point totals.
    expect(getMatchRevisionDelta(
      [{ id: 'one', revision: 'pitch-value-1' }],
      [{ id: 'one', revision: 'pitch-value-0-and-other-pitch-1' }]
    ).changedIds).toEqual(['one']);
  });
});
