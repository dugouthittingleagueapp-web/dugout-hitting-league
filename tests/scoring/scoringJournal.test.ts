import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createScoringJournal, journalEntries, recoverJournal, exportScoringRecovery, journalRevisionFor, journalToken, SCORING_REQUEST_TIMEOUT_MS } from '../../services/scoringJournal';
import { applyPitchCommand, type PitchCommand } from '../../utils/scoringProtocol';
import { scoringFixture, memoryScoringStorage } from './scoringFixtures';
import type { Match } from '../../types';

const pitch = (index = 0, points: number | null = 4, expected: number | null = null): PitchCommand =>
  ({ kind: 'pitch', inning: 1, side: 'home', playerId: 'h1', pitchIndex: index, expected, points });

describe('Durable pitch journal', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryScoringStorage()); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const setup = (apiFetch: any) => {
    const notify = vi.fn();
    const journal = createScoringJournal({ apiFetch, getToken: () => '11111111-1111-4111-8111-111111111111', mapResponse: row => row as Match, uuid: randomUUID, notify });
    return { journal, notify };
  };

  it('backs up every accepted pitch synchronously even behind a hanging request', async () => {
    vi.useFakeTimers();
    const api = vi.fn(() => new Promise<Response>(() => {}));
    const { journal } = setup(api), before = scoringFixture().game;
    const first = journal.stage(before, pitch());
    const second = journal.stage(first.match, pitch(1, 3));
    expect(api).toHaveBeenCalledTimes(1);
    expect(journalEntries(before.id)).toHaveLength(2);
    expect(recoverJournal(before.id)!.innings[0].home.playerScores[0].pitches.slice(0, 2)).toEqual([{ points: 4 }, { points: 3 }]);
    await vi.advanceTimersByTimeAsync(SCORING_REQUEST_TIMEOUT_MS + 1);
    await Promise.all([first.saved, second.saved]);
    expect(journalEntries(before.id).every(e => !e.ack)).toBe(true);
  });

  it('also times out when headers arrive but the response body hangs', async () => {
    vi.useFakeTimers();
    const { journal, notify } = setup(vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })));
    const staged = journal.stage(scoringFixture().game, pitch());
    await vi.advanceTimersByTimeAsync(SCORING_REQUEST_TIMEOUT_MS + 1);
    await staged.saved;
    expect(notify).toHaveBeenCalledWith('journal-test', 'offline');
    expect(journalEntries('journal-test')[0].ack).toBeUndefined();
  });

  it.each(['base', 'entry'])('rejects input before UI acknowledgement when %s storage is unavailable', keyPart => {
    const store = memoryScoringStorage();
    const original = store.setItem;
    store.setItem = (key, value) => { if (key.includes(`:${keyPart}:`)) throw new DOMException('full', 'QuotaExceededError'); original(key, value); };
    vi.stubGlobal('localStorage', store);
    const api = vi.fn(); const { journal, notify } = setup(api);
    const before = scoringFixture().game;
    expect(() => journal.stage(before, pitch())).toThrow(/device storage/);
    expect(before.innings[0].home.playerScores[0].pitches[0].points).toBeNull();
    expect(api).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith(before.id, 'saved');
  });

  it('does not accept a browser silently ignoring the journal write', () => {
    const store = memoryScoringStorage(), original = store.setItem;
    store.setItem = (key, value) => { if (!key.includes(':entry:')) original(key, value); };
    vi.stubGlobal('localStorage', store);
    const api = vi.fn(); const { journal } = setup(api);
    expect(() => journal.stage(scoringFixture().game, pitch())).toThrow(/device storage/);
    expect(api).not.toHaveBeenCalled();
  });

  it('retries a committed lost response with the same ID and records the pitch once', async () => {
    let server = scoringFixture().game, applied = 0, first = true;
    const receipts = new Map<string, Match>();
    const api = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (!receipts.has(body.writeId)) {
        expect(body.revision).toBe(server.revision);
        server = { ...applyPitchCommand(server, body.command), revision: server.revision! + 1 };
        receipts.set(body.writeId, server); applied++;
      }
      if (first) { first = false; throw new Error('Response lost after commit'); }
      return new Response(JSON.stringify(receipts.get(body.writeId)));
    });
    const { journal } = setup(api);
    await journal.stage(server, pitch()).saved;
    expect(journalEntries(server.id)[0].ack).toBeUndefined();
    await journal.syncGame(server.id);
    expect(applied).toBe(1);
    expect(JSON.parse(api.mock.calls[0][1].body)).toEqual(JSON.parse(api.mock.calls[1][1].body));
    expect(recoverJournal(server.id)).toBeUndefined();
  });

  it('chains only its own parent acknowledgements, never a read or other-tab revision', async () => {
    let server = scoringFixture().game;
    const api = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.revision !== server.revision) return new Response(JSON.stringify({ error: 'Game changed' }), { status: 409 });
      server = { ...applyPitchCommand(server, body.command), revision: server.revision! + 1 };
      return new Response(JSON.stringify(server));
    });
    const { journal } = setup(api);
    const first = journal.stage(server, pitch()); await first.saved;
    // Simulate an unrelated read of another tab's accepted update.
    server = { ...applyPitchCommand(server, { ...pitch(2, 2), expected: null }), revision: 2 };
    const readSnapshot = JSON.parse(JSON.stringify(server)); expect(readSnapshot.revision).toBe(2);
    const stale = journal.stage(first.match, pitch(1, 3));
    await expect(stale.saved).rejects.toThrow('different information');
    expect(JSON.parse(api.mock.calls[1][1].body).revision).toBe(1);
    expect(server.innings[0].home.playerScores[0].pitches[2].points).toBe(2);
    expect(journalEntries(server.id).filter(e => !e.ack)).toHaveLength(1);
  });

  it('retains duplicate-tab work instead of merging stale branches', async () => {
    let server = scoringFixture().game;
    const tabTwoSnapshot = JSON.parse(JSON.stringify(server));
    const api = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.revision !== server.revision) return new Response(JSON.stringify({ error: 'Different scoring copy' }), { status: 409 });
      server = { ...applyPitchCommand(server, body.command), revision: server.revision! + 1 };
      return new Response(JSON.stringify(server));
    });
    const one = setup(api).journal, two = setup(api).journal;
    await one.stage(server, pitch()).saved;
    await expect(two.stage(tabTwoSnapshot, pitch(1, 3)).saved).rejects.toThrow('different information');
    expect(server.innings[0].home.playerScores[0].pitches[0].points).toBe(4);
    expect(server.innings[0].home.playerScores[0].pitches[1].points).toBeNull();
    expect(journalEntries(server.id).filter(e => !e.ack)).toHaveLength(1);
  });

  it.each([5, 3, 1])('recovers %i-pitch extras including zero, edits and undo', async limit => {
    const game = scoringFixture().game;
    game.tieBreaker = [5, 3, 1].slice(0, limit === 5 ? 1 : limit === 3 ? 2 : 3).map((n, i) => ({
      roundNumber: i + 1, pitchLimit: n, homePlayerId: 'h1', awayPlayerId: 'a1', homeScores: Array(n).fill(null), awayScores: Array(n).fill(null),
    }));
    const round = game.tieBreaker.length;
    const { journal } = setup(vi.fn(async () => { throw new Error('offline'); }));
    const cmd: PitchCommand = { kind: 'extraPitch', round, side: 'home', playerId: 'h1', pitchIndex: 0, expected: null, points: 0 };
    const zero = journal.stage(game, cmd); await zero.saved;
    const edited = journal.stage(zero.match, { ...cmd, expected: 0, points: 4 }); await edited.saved;
    expect(recoverJournal(game.id)!.tieBreaker![round - 1].homeScores[0]).toBe(4);
    const undone = journal.stage(edited.match, { ...cmd, expected: 4, points: null }); await undone.saved;
    expect(recoverJournal(game.id)!.tieBreaker![round - 1].homeScores[0]).toBeNull();
    expect(journalEntries(game.id)).toHaveLength(3);
  });

  it('preserves a committed command if persisting its acknowledgement fails', async () => {
    const store = memoryScoringStorage(), original = store.setItem;
    let failAck = true, server = scoringFixture().game, applied = false;
    store.setItem = (key, value) => { if (failAck && key.includes(':entry:') && JSON.parse(value).ack) throw new Error('quota'); original(key, value); };
    vi.stubGlobal('localStorage', store);
    const { journal } = setup(vi.fn(async () => {
      if (!applied) { server = { ...applyPitchCommand(server, pitch()), revision: 1 }; applied = true; }
      return new Response(JSON.stringify(server));
    }));
    await expect(journal.stage(server, pitch()).saved).rejects.toThrow(/device storage/);
    expect(journalEntries(server.id)[0].ack).toBeUndefined();
    failAck = false; await journal.syncGame(server.id);
    expect(journalEntries(server.id)[0].ack?.revision).toBe(1);
  });

  it('does not show an offline correction to final results as confirmed', async () => {
    const game = { ...scoringFixture().game, isComplete: true, status: 'FINAL' as const };
    const { journal } = setup(vi.fn(async () => { throw new Error('offline'); }));
    await expect(journal.stage(game, pitch()).saved).rejects.toThrow(/only saved on this device/);
    expect(journalEntries(game.id)).toHaveLength(1);
    expect(game.innings[0].home.playerScores[0].pitches[0].points).toBeNull();
  });
  it('keeps the recovery command when a response unexpectedly reopens a final game', async () => {
    const game = { ...scoringFixture().game, isComplete: true, status: 'FINAL' as const };
    const reopened = { ...applyPitchCommand(game, pitch()), revision: 1, isComplete: false, status: 'IN_PROGRESS' };
    const { journal } = setup(vi.fn(async () => new Response(JSON.stringify(reopened))));
    await expect(journal.stage(game, pitch()).saved).rejects.toThrow(/could not confirm/);
    expect(journalEntries(game.id)[0].ack).toBeUndefined();
  });

  it('exports recovery commands without scoring/authentication capabilities', async () => {
    const { journal } = setup(vi.fn(async () => { throw new Error('offline'); }));
    await journal.stage(scoringFixture().game, pitch()).saved;
    const text = exportScoringRecovery('journal-test');
    expect(text).toContain('"points": 4');
    expect(text).not.toContain('scoringToken');
    expect(text).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('preserves unreadable journal data for recovery and rejects new input', () => {
    const key = 'dugout_scoring_journal_v1:entry:broken'; localStorage.setItem(key, '{broken');
    const { journal } = setup(vi.fn());
    expect(() => journal.stage(scoringFixture().game, pitch())).toThrow(/unreadable/);
    expect(localStorage.getItem(key)).toBe('{broken');
    expect(exportScoringRecovery('journal-test')).toContain('{broken');
  });

  it('only supplies the revision acknowledged for the exact accepted parent', async () => {
    const before = scoringFixture().game;
    const { journal } = setup(vi.fn(async () => new Response(JSON.stringify({ ...applyPitchCommand(before, pitch()), revision: 1 }))));
    const staged = journal.stage(before, pitch()); await staged.saved;
    expect(journalRevisionFor(staged.match)).toBe(1);
    expect(journalRevisionFor({ ...before, revision: 99 })).toBe(99);
    expect(journalToken(before.id)).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('redacts capabilities even from a truncated unreadable recovery record', () => {
    localStorage.setItem('dugout_scoring_journal_v1:entry:broken', '{"scoringToken":"11111111-1111-4111-8111-111111111111');
    expect(exportScoringRecovery('journal-test')).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(localStorage.getItem('dugout_scoring_journal_v1:entry:broken')).toContain('11111111');
  });
  it('uses only the versioned scoring route and retains work when an old backend has no handler', async () => {
    const api = vi.fn(async (url, init) => {
      expect(url).toBe('/api/scoring'); expect(init.method).toBe('POST');
      expect(JSON.parse(init.body).protocol).toBe(1);
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    });
    const { journal } = setup(api);
    await expect(journal.stage(scoringFixture().game, pitch()).saved).rejects.toThrow(/saved copy is safe/);
    expect(journalEntries('journal-test')[0].ack).toBeUndefined();
  });
});
