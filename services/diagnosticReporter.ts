import type {
  DiagnosticInput,
  DiagnosticType,
} from "../utils/diagnosticEvents";

/** Bounded memory only. Never reads/writes or evicts scoring recovery storage. */
export const createDiagnosticReporter = (
  send: (event: DiagnosticInput) => Promise<unknown>,
  uuid: () => string,
  clock = Date.now,
) => {
  const queue: DiagnosticInput[] = [];
  const episodes = new Map<
    string,
    { id: string; state: string; count: number; last: number }
  >();
  let running = false;
  let sentWindow = 0;
  let windowStart = clock();
  const flush = async () => {
    if (
      running ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    )
      return;
    running = true;
    try {
      while (queue.length) {
        if (clock() - windowStart >= 60000) {
          windowStart = clock();
          sentWindow = 0;
        }
        if (sentWindow >= 12) return;
        sentWindow++;
        const event = queue[0];
        try {
          await send(event);
          const index = queue.findIndex(
            (item) => item.eventId === event.eventId,
          );
          if (index >= 0) queue.splice(index, 1);
        } catch {
          return;
        }
      }
    } finally {
      running = false;
    }
  };
  const report = (gameId: string, type: DiagnosticType) => {
    try {
      let episode = episodes.get(gameId);
      if (!episode) {
        episode = { id: uuid(), state: "", count: 0, last: 0 };
        episodes.set(gameId, episode);
      }
      if (episode.state === type && clock() - episode.last < 60000) return;
      episode.state = type;
      episode.last = clock();
      if (queue.length >= 20) queue.shift();
      queue.push({
        eventId: uuid(),
        operationId: episode.id,
        correlationId: episode.id,
        type,
        gameId,
      });
      if (type === "recovery_completed") episodes.delete(gameId);
      while (episodes.size > 50) episodes.delete(episodes.keys().next().value!);
      void flush();
    } catch {
      /* Monitoring must never interrupt scoring. */
    }
  };
  const scoringState = (gameId: string, state: string) => {
    const prior = episodes.get(gameId);
    if (state === "offline") {
      if (prior) prior.count++;
      report(
        gameId,
        prior && prior.count > 2
          ? "scoring_repeated_failure"
          : "scoring_timeout",
      );
    } else if (state === "attention") report(gameId, "recovery_manual_review");
    else if (state === "saved" && prior) report(gameId, "recovery_completed");
  };
  return { report, scoringState, flush, pendingCount: () => queue.length };
};
