import { describe, it, expect } from 'vitest';
import { parseVoiceTranscript } from '../../hooks/useVoiceScoring';

describe('Voice Scoring Vocabulary & Phonetic Parser', () => {
  describe('Score 0 matching', () => {
    const zeroPhrases = [
      '0', 'zero', 'hero', 'cero', 'sierra',
      'out', 'miss', 'missed', 'strike', 'whiff',
      'foul', 'foul ball', 'ground out', 'fly out', 'pop out', 'line out',
      'struck out', 'swing and miss', 'ball', 'take',
      'nothing', 'zip', 'nada', 'zilch', 'donut', 'oh',
      'strike one', 'strike two', 'strike three',
      'That was an out', 'he missed it', 'ground out to third'
    ];

    zeroPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as score 0`, () => {
        const result = parseVoiceTranscript(phrase);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('score');
        expect(result?.score).toBe(0);
      });
    });
  });

  describe('Score 1 matching', () => {
    const onePhrases = [
      '1', 'one', 'single', 'singles', 'base hit', 'basehit',
      'single hit', 'first base', 'won', 'juan', 'wan',
      'one point', '1 point',
      'That is a single', 'He got a base hit', 'scored one'
    ];

    onePhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as score 1`, () => {
        const result = parseVoiceTranscript(phrase);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('score');
        expect(result?.score).toBe(1);
      });
    });
  });

  describe('Score 2 matching', () => {
    const twoPhrases = [
      '2', 'two', 'double', 'doubles', 'second', 'second base',
      'two bagger', '2 bagger', 'two points', '2 points',
      'to', 'too', 'tu', 'due', 'dew', 'deuce',
      'That was a double', 'he got two', 'scored two'
    ];

    twoPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as score 2`, () => {
        const result = parseVoiceTranscript(phrase);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('score');
        expect(result?.score).toBe(2);
      });
    });
  });

  describe('Score 3 matching', () => {
    const threePhrases = [
      '3', 'three', 'triple', 'triples', 'third', 'third base',
      'tree', 'free', 'three points', '3 points',
      'That is a triple', 'he got three', 'scored three'
    ];

    threePhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as score 3`, () => {
        const result = parseVoiceTranscript(phrase);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('score');
        expect(result?.score).toBe(3);
      });
    });
  });

  describe('Score 4 matching', () => {
    const fourPhrases = [
      '4', 'four', 'for', 'fore', 'fourth', 'ford', 'fort',
      'homer', 'home run', 'homerun', 'dinger', 'bomb', 'blast',
      'grand slam', 'four bagger', 'moonshot', 'big fly', 'yard',
      'four points', '4 points', 'over the fence',
      'That is a home run', 'huge bomb', 'blast to center'
    ];

    fourPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as score 4`, () => {
        const result = parseVoiceTranscript(phrase);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('score');
        expect(result?.score).toBe(4);
      });
    });
  });

  describe('Undo commands matching', () => {
    const undoPhrases = [
      'undo', 'un-do', 'and do', 'on do', 'in do',
      'take back', 'scratch', 'scratch that', 'cancel',
      'oops', 'delete', 'erase', 'go back', 'mistake', 'wrong'
    ];

    undoPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as undo`, () => {
        const result = parseVoiceTranscript(phrase);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('undo');
      });
    });
  });

  describe('Handling punctuation and capitalization', () => {
    it('handles trailing punctuation correctly', () => {
      expect(parseVoiceTranscript('Two.')?.score).toBe(2);
      expect(parseVoiceTranscript('4!')?.score).toBe(4);
      expect(parseVoiceTranscript('Single,')?.score).toBe(1);
      expect(parseVoiceTranscript('OUT???')?.score).toBe(0);
      expect(parseVoiceTranscript('Home Run!')?.score).toBe(4);
      expect(parseVoiceTranscript('Undo.')?.type).toBe('undo');
    });
  });
});
