/**
 * Share only overlapping GETs (never cache successful results).
 * Avoids duplicate Neon reads when dashboard, stats and modals request
 * the same resource at the same moment. Every caller gets its own Response
 * clone so each can read the body independently.
 */
const pendingReads = new Map<string, Promise<Response>>();

export const coalesceInFlightGet = (
  key: string,
  request: () => Promise<Response>
): Promise<Response> => {
  let pending = pendingReads.get(key);
  if (!pending) {
    pending = Promise.resolve().then(request);
    pendingReads.set(key, pending);
    const thisRequest = pending;
    void thisRequest.then(
      () => { if (pendingReads.get(key) === thisRequest) pendingReads.delete(key); },
      () => { if (pendingReads.get(key) === thisRequest) pendingReads.delete(key); }
    );
  }
  return pending.then(response => response.clone());
};
