import type { Match } from '../types';
import { applyPitchChange, type PitchChange } from '../utils/pitchSync';

export interface PendingPitch extends PitchChange {
  operationId: string;
}

const PENDING_KEY = 'dugout_pending_pitch_changes_v1';
const PROTECTED_KEY = 'dugout_pitch_patch_protected_v1';
const CONFLICT_KEY = 'dugout_pitch_conflicts_v1';
const inflight = new Map<string, Promise<void>>();
type AuthFetch = (url: string, options: RequestInit) => Promise<Response>;

const readObject = <T>(key: string, empty: T): T => {
  if (typeof window === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : empty;
  } catch { return empty; }
};
const storeObject = (key: string, value: unknown) => {
  if (typeof window === 'undefined') throw new Error('Cannot save scores on this device.');
  // Storage exceptions must propagate. Never accept a tap without a local copy.
  localStorage.setItem(key, JSON.stringify(value));
};
const getQueues = () => readObject<Record<string, PendingPitch[]>>(PENDING_KEY, {});
export const getPendingPitchChanges = (matchId: string): PendingPitch[] =>
  getQueues()[matchId] || [];
export const isPitchProtected = (matchId: string): boolean =>
  Boolean(readObject<Record<string, boolean>>(PROTECTED_KEY, {})[matchId]);
export const getPitchSyncConflict = (matchId: string): string | null =>
  readObject<Record<string, string>>(CONFLICT_KEY, {})[matchId] || null;
const saveConflict = (matchId: string, reason: string) => {
  const conflicts = readObject<Record<string, string>>(CONFLICT_KEY, {});
  conflicts[matchId] = reason;
  storeObject(CONFLICT_KEY, conflicts);
};

/** Persist the change before painting it. Protect against older full-match replay. */
export const queuePitchChange = (change: PitchChange): PendingPitch => {
  if (getPitchSyncConflict(change.matchId)) {
    throw new Error(getPitchSyncConflict(change.matchId)!);
  }
  const protectedIds = readObject<Record<string, boolean>>(PROTECTED_KEY, {});
  protectedIds[change.matchId] = true;
  storeObject(PROTECTED_KEY, protectedIds);

  const queues = getQueues();
  const current = queues[change.matchId] || [];
  if (current.length >= 1000) {
    throw new Error('This game has too many unsaved pitches. Reconnect before recording more.');
  }
  const operation: PendingPitch = {
    ...change,
    operationId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`
  };
  queues[change.matchId] = [...current, operation];
  storeObject(PENDING_KEY, queues);
  return operation;
};

/** Preserve the latest server snapshot locally and layer any queued edits on top. */
export const replayPendingPitchChanges = (match: Match): Match =>
  getPendingPitchChanges(match.id).reduce<Match>((current, change) =>
    applyPitchChange(current, change), match);

const acknowledgePitch = (change: PendingPitch, rowVersion: string | undefined) => {
  if (typeof window === 'undefined') return;
  // Update the local recovery snapshot before removing its pending operation.
  // If there isn't one, retain the operation until the server copy is fetched.
  const key = `dugout_match_${change.matchId}`;
  const cached = localStorage.getItem(key);
  if (cached) {
    const match = applyPitchChange(JSON.parse(cached) as Match, change);
    localStorage.setItem(key, JSON.stringify({ ...match, rowVersion: rowVersion || match.rowVersion }));
  }

  const queues = getQueues();
  queues[change.matchId] = (queues[change.matchId] || []).filter(x => x.operationId !== change.operationId);
  if (!queues[change.matchId].length) delete queues[change.matchId];
  storeObject(PENDING_KEY, queues);
  if (rowVersion) {
    window.dispatchEvent(new CustomEvent('dugout:pitch-synced', {
      detail: { matchId: change.matchId, rowVersion }
    }));
  }
};

/**
 * One in-flight replay per match/device. Retry transient disconnections later,
 * but permanently stop on a real 409 conflict. Keep the queued score available
 * for admin reconciliation—never send a stale complete match as a fallback.
 */
export const flushPitchChanges = (matchId: string, transport: AuthFetch): Promise<void> => {
  const ongoing = inflight.get(matchId);
  if (ongoing) return ongoing;
  const process = async () => {
    while (true) {
      const conflict = getPitchSyncConflict(matchId);
      if (conflict) throw new Error(conflict);
      const change = getPendingPitchChanges(matchId)[0];
      if (!change) return;
      let res: Response;
      try {
        res = await transport('/api/pitch', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change)
        });
      } catch {
        // The browser remains usable offline; queued edits survive reloads.
        return;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        const reason = body.error || 'This pitch changed on another device. Your unsent score is still on this device. Ask an admin to compare the scores before continuing.';
        saveConflict(matchId, reason);
        throw new Error(reason);
      }
      if (res.status === 401 || res.status === 403 || res.status === 400) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'This score needs an authorized umpire. Sign in and try again.');
      }
      if (!res.ok) return; // Keep queued edits for transient server errors.
      const body = await res.json() as { saved?: boolean; rowVersion?: string };
      if (!body.saved) return;
      acknowledgePitch(change, body.rowVersion);
    }
  };
  const running = process().finally(() => {
    if (inflight.get(matchId) === running) inflight.delete(matchId);
  });
  inflight.set(matchId, running);
  return running;
};

export const flushAllPitchChanges = async (transport: AuthFetch): Promise<void> => {
  const ids = Object.keys(getQueues());
  await Promise.all(ids.map(async id => {
    try { await flushPitchChanges(id, transport); }
    catch (error) { console.warn('Pitch sync requires review:', error); }
  }));
};
