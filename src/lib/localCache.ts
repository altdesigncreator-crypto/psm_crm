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
    // Storage full, disabled, or unavailable (private browsing) — caching is
    // a pure speed optimization, never a requirement, so fail silently.
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
