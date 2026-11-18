import type { Match } from '../types';
import { applyPitchCommand, sameScores, stableJson, validatePitchCommand, type PitchCommand } from '../utils/scoringProtocol';

const PREFIX = 'dugout_scoring_journal_v1:';
const BASE = `${PREFIX}base:`, ENTRY = `${PREFIX}entry:`;
export const SCORING_REQUEST_TIMEOUT_MS = 12000;
const rejectedMessage = (status: number) => status === 401 || status === 403
  ? 'Please sign in again with help from the person running the league. Your saved copy stays on this device.'
  : status === 423 ? 'Scoring moved to another device. Your saved copy is safe. Ask the person running the league to compare it before continuing.'
  : status === 409 ? 'This game has different information. Your saved copy is safe. Ask the person running the league to compare it before continuing.'
  : 'This scoring save needs checking. Your saved copy is safe. Keep this page open and ask the person running the league for help.';
const storageError = () => new Error('The device storage could not save a recovery copy. This pitch was not accepted. Keep this page open and ask the person running the league for help.');
type Base = { version: 1; id: string; match: Match; createdAt: number };
export type JournalEntry = {
  version: 1; id: string; baseId: string; matchId: string; parentId?: string;
  revision: number; command: PitchCommand; createdAt: number; scoringToken: string;
  ack?: { revision: number };
};
type Context = { baseId: string; parentId: string };
const contexts = new WeakMap<Match, Context>();

const read = (key: string) => {
  try { const raw = localStorage.getItem(key); return raw === null ? undefined : JSON.parse(raw); }
  catch { throw new Error('The saved recovery copy is unreadable. Do not clear browser data. Ask the person running the league for help.'); }
};
const write = (key: string, value: unknown) => {
  try {
    const encoded = JSON.stringify(value);
    localStorage.setItem(key, encoded);
    if (localStorage.getItem(key) !== encoded) throw storageError();
  } catch { throw storageError(); }
};
const keys = (prefix: string): string[] => {
  try {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) result.push(key); }
    return result.sort();
  } catch { throw storageError(); }
};
export const journalEntries = (id?: string): JournalEntry[] => keys(ENTRY).map(key => {
  const e = read(key) as JournalEntry;
  if (!e || e.version !== 1 || typeof e.id !== 'string' || `${ENTRY}${e.id}` !== key ||
      typeof e.baseId !== 'string' || typeof e.matchId !== 'string' || !Number.isSafeInteger(e.revision) || e.revision < 0 ||
      (e.ack && (!Number.isSafeInteger(e.ack.revision) || e.ack.revision < 1)))
    throw new Error('The saved recovery copy is unreadable. Keep it on this device and ask for help.');
  validatePitchCommand(e.command);
  return e;
}).filter(e => id === undefined || e.matchId === id);
export const hasJournalPending = (id: string): boolean => journalEntries(id).some(e => !e.ack);
export const journalToken = (id: string): string | undefined => {
  const entries = journalEntries(id);
  return (entries.find(e => !e.ack) || entries.sort((a, b) => b.createdAt - a.createdAt)[0])?.scoringToken;
};
const baseFor = (id: string): Base => {
  const b = read(`${BASE}${id}`) as Base;
  if (!b || b.version !== 1 || b.id !== id || !b.match || !Array.isArray(b.match.innings))
    throw new Error('The saved recovery copy is unreadable. Do not clear browser data.');
  return b;
};

const modelAt = (entry: JournalEntry, entries: JournalEntry[]): Match => {
  const chain: JournalEntry[] = []; const seen = new Set<string>(); let current: JournalEntry | undefined = entry;
  while (current) {
    if (seen.has(current.id) || current.baseId !== entry.baseId || current.matchId !== entry.matchId) throw new Error('The saved recovery copy needs an admin review.');
    seen.add(current.id); chain.unshift(current);
    if (!current.parentId) break;
    current = entries.find(e => e.id === current!.parentId);
    if (!current) throw new Error('Part of the saved recovery copy is missing. Keep this device open and ask for help.');
  }
  let model = baseFor(entry.baseId).match;
  if (model.id !== entry.matchId) throw new Error('The saved recovery copy belongs to a different game.');
  for (const c of chain) model = applyPitchCommand(model, c.command);
  model = { ...model, revision: entry.ack?.revision ?? entry.revision };
  contexts.set(model, { baseId: entry.baseId, parentId: entry.id });
  return model;
};

export const recoverJournal = (id: string): Match | undefined => {
  const entries = journalEntries(id), pending = entries.filter(e => !e.ack);
  if (!pending.length) return undefined;
  const heads = pending.filter(e => !pending.some(n => n.parentId === e.id));
  if (heads.length !== 1) throw new Error('Two saved scoring copies need checking. Both are safe on this device. Ask the person running the league for help.');
  return modelAt(heads[0], entries);
};

export const journalRevisionFor = (match: Match): number | undefined => {
  const c = contexts.get(match);
  if (!c) return match.revision;
  const entry = read(`${ENTRY}${c.parentId}`) as JournalEntry;
  if (!entry?.ack) throw new Error('Some pitches are only saved on this device. Synchronize them before changing the lineup or ending the game.');
  // Only this explicitly linked parent can supply its acknowledged revision.
  // Reads and unrelated tab acknowledgements never update this context.
  if (!sameScores(modelAt(entry, journalEntries(match.id)), match)) throw new Error('The current scoring version is unknown. Ask for help before saving.');
  return entry.ack.revision;
};

export interface JournalDependencies {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  getToken: (id: string) => string | null;
  mapResponse: (row: unknown) => Match;
  notify: (id: string, state: 'saving' | 'saved' | 'offline' | 'attention', message?: string) => void;
  uuid: () => string;
}

export const createScoringJournal = (d: JournalDependencies) => {
  const running = new Map<string, Promise<void>>();
  const failures = new Map<string, string>();
  const pending = (id: string) => journalEntries(id).filter(e => !e.ack);
  const syncGame = (id: string): Promise<void> => {
    const prior = running.get(id); if (prior) return prior;
    if (!pending(id).length) return Promise.resolve();
    const run = async () => {
      failures.delete(id);
      while (pending(id).length) {
        // Ambiguous branches are retained for review, never arbitrarily merged.
        recoverJournal(id);
        const entries = journalEntries(id);
        const next = entries.find(e => !e.ack && (!e.parentId || entries.find(p => p.id === e.parentId)?.ack));
        if (!next) throw new Error('The saved scores need checking before they can be sent.');
        const parent = next.parentId ? entries.find(e => e.id === next.parentId) : undefined;
        const revision = parent?.ack?.revision ?? next.revision;
        const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Scoring request timed out')); }, SCORING_REQUEST_TIMEOUT_MS); });
          const request = async () => {
            const response = await d.apiFetch('/api/scoring', {
              method: 'POST', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'X-Scoring-Token': next.scoringToken },
              body: JSON.stringify({ protocol: 1, id, revision, writeId: next.id, command: next.command }),
            });
            let data;
            try { data = await response.json(); }
            catch {
              throw Object.assign(new Error('The scoring connection could not be checked. Your saved copy stays on this device. Ask the person running the league for help.'), { rejected: true });
            }
            return { response, data };
          };
          const { response, data } = await Promise.race([request(), timeout]);
          if (!response.ok) {
            if (response.status >= 500 || response.status === 429) { d.notify(id, 'offline'); return; }
            throw Object.assign(new Error(rejectedMessage(response.status)), { rejected: true });
          }
          const saved = d.mapResponse(data);
          const expected = modelAt(next, entries);
          if (saved.id !== id || saved.revision !== revision + 1 || !sameScores(expected, saved))
            throw Object.assign(new Error('The server response could not confirm these pitches. Your recovery copy is still on this device.'), { rejected: true });
          // Keep the command until a matching acknowledgement is itself durable.
          write(`${ENTRY}${next.id}`, { ...next, ack: { revision: saved.revision } });
          d.notify(id, pending(id).length ? 'saving' : 'saved');
        } catch (error) {
          if ((error as { rejected?: boolean }).rejected || /storage|recovery copy/i.test(String(error))) throw error;
          d.notify(id, 'offline'); return;
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
      d.notify(id, 'saved');
    };
    const work = run().catch(error => {
      failures.set(id, error instanceof Error ? error.message : 'The saved scores need checking.');
      d.notify(id, 'attention', failures.get(id));
    });
    running.set(id, work);
    void work.finally(() => { if (running.get(id) === work) running.delete(id); });
    return work;
  };
  return {
    syncGame,
    async syncAll() { for (const id of new Set(journalEntries().filter(e => !e.ack).map(e => e.matchId))) await syncGame(id); },
    stage(before: Match, command: PitchCommand): { match: Match; saved: Promise<Match> } {
      if (failures.has(before.id)) throw new Error(failures.get(before.id));
      let context = contexts.get(before);
      if (!context && hasJournalPending(before.id)) throw new Error('Some pitches are only saved on this device. Open their recovery copy before scoring again.');
      if (!Number.isSafeInteger(before.revision) || before.revision! < 0) throw new Error('The current scoring version is unknown. Reopen the game before scoring.');
      const after = applyPitchCommand(before, command);
      const token = d.getToken(before.id);
      if (!token) throw new Error('Scoring access is not ready. Keep the game open and ask for help.');
      if (!context) {
        const base: Base = { version: 1, id: d.uuid(), match: before, createdAt: Date.now() };
        write(`${BASE}${base.id}`, base);
        context = { baseId: base.id, parentId: '' };
      }
      const entry: JournalEntry = {
        version: 1, id: d.uuid(), baseId: context.baseId, matchId: before.id,
        ...(context.parentId ? { parentId: context.parentId } : {}),
        revision: before.revision!, command, createdAt: Date.now(), scoringToken: token,
      };
      // This synchronous, verified write happens before the caller acknowledges input.
      write(`${ENTRY}${entry.id}`, entry);
      contexts.set(after, { baseId: entry.baseId, parentId: entry.id });
      d.notify(before.id, 'saving');
      const saved = syncGame(before.id).then(() => {
        if (failures.has(before.id)) throw new Error(failures.get(before.id));
        if (before.isComplete && !(read(`${ENTRY}${entry.id}`) as JournalEntry).ack)
          throw new Error('This official correction is only saved on this device. Keep the page open and synchronize it before continuing.');
        return modelAt(read(`${ENTRY}${entry.id}`), journalEntries(before.id));
      });
      return { match: after, saved };
    },
  };
};

/** No authentication or scoring capability is included in a shared recovery file. */
export const exportScoringRecovery = (id: string): string => {
  const raw: Record<string, unknown> = {};
  for (const key of keys(PREFIX)) {
    const value = localStorage.getItem(key);
    try {
      const parsed = JSON.parse(value || 'null');
      if (parsed?.matchId === id || parsed?.match?.id === id) raw[key] = parsed;
    } catch { raw[key] = value?.replace(/("(?:scoringToken|authorization|password|secret)"\s*:\s*)"(?:\\.|[^"\\])*(?:"|$)/gi, '$1"[redacted]"'); }
  }
  const legacy = localStorage.getItem('dugout_pending_sync_matches');
  if (legacy) { try { const pending = JSON.parse(legacy); if (pending[id]) raw.legacy = pending[id]; } catch { raw.legacyUnreadable = legacy; } }
  return JSON.stringify({ format: 'dugout-scoring-recovery-v1', matchId: id, exportedAt: new Date().toISOString(), records: raw },
    (key, value) => /token|authorization|secret|password/i.test(key) ? undefined : value, 2);
};
