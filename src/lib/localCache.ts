/** Tiny localStorage-backed cache for "boot instantly from what we already
 * know, then quietly confirm it's still correct" — used for the handful of
 * things that gate first paint (session profile, maintenance status) so a
 * repeat visit doesn't have to sit through a network round trip before
 * showing anything. Not a source of truth: every consumer treats a cache
 * hit as a placeholder to render immediately while it kicks off the real
 * fetch in the background, and Postgres RLS remains the actual security
 * boundary regardless of what's sitting in this cache.
 *
 * Deliberately not cookies: cookies are capped at ~4KB per domain and ride
 * along with every HTTP request for no benefit here, since nothing server-
 * side needs to read this — localStorage is the right tool for client-only
 * bootstrap data. */

const PREFIX = 'psm_cache_v1:';
const CACHE_VERSION = 1;

interface CacheEnvelope<T> {
  v: number;
  t: number;
  data: T;
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    const envelope: CacheEnvelope<T> = { v: CACHE_VERSION, t: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(envelope));
  } catch {
  }
}

/** Returns the cached value, or `undefined` on a miss/expiry/corruption —
 * `undefined` (not `null`) so callers can still legitimately cache `null`
 * as a real value (e.g. "no maintenance row exists"). */
export function cacheGet<T>(key: string, maxAgeMs: number): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.v !== CACHE_VERSION || Date.now() - parsed.t > maxAgeMs) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function cacheClear(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // noop — nothing to clean up if storage isn't available.
  }
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

/** Same as cacheSet, but coalesces bursts of rapid calls for the same key
 * into a single write. Realtime patch handlers call this on every single
 * INSERT/UPDATE/DELETE — during a bulk import or bulk delete that's dozens
 * of events within milliseconds, and without coalescing that's dozens of
 * full JSON.stringify + localStorage.setItem passes over an array that's
 * already gotten large, each one a synchronous main-thread stall for no
 * visible benefit (the UI itself updates instantly via React state on every
 * event regardless — only the persistence step is delayed). Only the last
 * write in a burst actually reaches storage. */
export function cacheSetDebounced<T>(key: string, data: T, delayMs = 150): void {
  const existing = pendingWrites.get(key);
  if (existing) clearTimeout(existing);
  pendingWrites.set(key, setTimeout(() => {
    pendingWrites.delete(key);
    cacheSet(key, data);
  }, delayMs));
}
