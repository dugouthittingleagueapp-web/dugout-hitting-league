import { describe, expect, it } from 'vitest';
import { incompleteLineupMessage, isPlayableLineup, removeDraftLineupPlayer } from '../../utils/lineupDraft';
import { detectForfeit } from '../../services/matchHelpers';

const team = {
  id: 'home', name: 'Home', players: [{ id: 'regular1' }, { id: 'regular2' }, { id: 'regular3' }],
  subs: [{ id: 'sub1' }, { id: 'sub2' }],
};
const opponent = {
  id: 'away', name: 'Away', players: [{ id: 'away1' }, { id: 'away2' }, { id: 'away3' }], subs: [],
};

describe('Substitute lineup editing', () => {
  it('allows temporarily removing two regulars and replacing them with two substitutes', () => {
    let draft = [...team.players];
    draft = removeDraftLineupPlayer(draft, 'regular2');
    expect(draft.map(p => p.id)).toEqual(['regular1', 'regular3']);
    draft = removeDraftLineupPlayer(draft, 'regular3');
    expect(draft.map(p => p.id)).toEqual(['regular1']);
    expect(isPlayableLineup(draft.map(p => p.id))).toBe(false);
    draft = [...draft, team.subs[0], team.subs[1]];
    expect(draft.map(p => p.id)).toEqual(['regular1', 'sub1', 'sub2']);
    expect(isPlayableLineup(draft.map(p => p.id))).toBe(true);
    expect(detectForfeit(team, opponent, draft.map(p => p.id), ['away1', 'away2', 'away3']).isForfeit).toBe(true);
  });

  it('allows temporarily clearing all regulars to use two substitutes', () => {
    let draft = [...team.players];
    for (const player of team.players) draft = removeDraftLineupPlayer(draft, player.id);
    expect(draft).toEqual([]);
    expect(isPlayableLineup([])).toBe(false);
    draft = [...team.subs];
    expect(isPlayableLineup(draft.map(p => p.id))).toBe(true);
  });

  it('rejects incomplete, oversized and duplicate lineups at save/start', () => {
    for (const ids of [[], ['regular1'], ['regular1', 'regular1'], ['a','b','c','d']]) {
      expect(isPlayableLineup(ids)).toBe(false);
    }
    expect(isPlayableLineup(['regular1','sub1'])).toBe(true);
    expect(isPlayableLineup(['regular1','sub1','sub2'])).toBe(true);
    expect(incompleteLineupMessage('Blue')).toMatch(/2 or 3 batters/);
  });

  it('does not mutate the original lineup or remove the wrong player', () => {
    const original = [...team.players];
    expect(removeDraftLineupPlayer(original, 'missing')).toEqual(original);
    expect(removeDraftLineupPlayer(original, 'regular2').map(p => p.id)).toEqual(['regular1','regular3']);
    expect(original).toHaveLength(3);
  });
});
