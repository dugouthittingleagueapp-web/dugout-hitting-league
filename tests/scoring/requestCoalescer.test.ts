import { describe, expect, it } from 'vitest';
import { coalesceInFlightGet } from '../../utils/requestCoalescer';

describe('In-flight GET coalescing', () => {
  it('makes only one network request for concurrent identical reads', async () => {
    let requests = 0;
    let resolveRequest!: (r: Response) => void;
    const deferred = new Promise<Response>(resolve => { resolveRequest = resolve; });
    const fetcher = () => { requests++; return deferred; };

    const a = coalesceInFlightGet('teams:test', fetcher);
    const b = coalesceInFlightGet('teams:test', fetcher);
    resolveRequest(new Response(JSON.stringify({ teams: [1, 2] })));
    const [resA, resB] = await Promise.all([a, b]);
    expect(requests).toBe(1);
    expect(await resA.json()).toEqual({ teams: [1, 2] });
    expect(await resB.json()).toEqual({ teams: [1, 2] });
  });

  it('does not cache data after a GET finishes', async () => {
    let requests = 0;
    const fetcher = async () => new Response(String(++requests));
    const a = await coalesceInFlightGet('matches:no-cache', fetcher);
    expect(await a.text()).toBe('1');
    const b = await coalesceInFlightGet('matches:no-cache', fetcher);
    expect(await b.text()).toBe('2');
    expect(requests).toBe(2);
  });

  it('does not share requests for different users or query parameters', async () => {
    let requests = 0;
    const fetcher = async () => new Response(String(++requests));
    const [a, b, c] = await Promise.all([
      coalesceInFlightGet('matches?season=2026|auth:a', fetcher),
      coalesceInFlightGet('matches?season=2026|auth:b', fetcher),
      coalesceInFlightGet('matches?season=2025|auth:a', fetcher)
    ]);
    expect(await Promise.all([a.text(), b.text(), c.text()])).toEqual(['1', '2', '3']);
  });

  it('clears failed requests so the next call can retry', async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts++;
      if (attempts === 1) throw new Error('offline');
      return new Response('reconnected');
    };
    await expect(coalesceInFlightGet('retry-after-failure', fetcher)).rejects.toThrow('offline');
    const recovered = await coalesceInFlightGet('retry-after-failure', fetcher);
    expect(await recovered.text()).toBe('reconnected');
    expect(attempts).toBe(2);
  });
});
