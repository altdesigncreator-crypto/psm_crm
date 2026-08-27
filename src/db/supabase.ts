import {createClient} from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const REMEMBER_ME_FLAG = 'psm_remember_me';

const rememberAwareStorage = {
  getItem: (key: string) => {
    const remembered = localStorage.getItem(REMEMBER_ME_FLAG) === 'true';
    const primary = remembered ? localStorage : sessionStorage;
    const secondary = remembered ? sessionStorage : localStorage;
    const value = primary.getItem(key);
    if (value !== null) return value;
    const fallback = secondary.getItem(key);
    if (fallback !== null) {
      primary.setItem(key, fallback);
      secondary.removeItem(key);
    }
    return fallback;
  },
  setItem: (key: string, value: string) => {
    const remembered = localStorage.getItem(REMEMBER_ME_FLAG) === 'true';
    (remembered ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

// Mobile networks routinely stall a request mid-flight (switching towers,
// weak signal, a backgrounded tab throttled by the OS) without the browser
// ever surfacing an error — fetch() just hangs. Left unbounded, that hangs
// every screen gated on this client (splash screen, route guard, etc.)
// forever. Aborting after a timeout turns "hung forever" into "failed
// fast," which every caller already has to handle anyway.
const FETCH_TIMEOUT_MS = 15_000;

// Some networks block the *.supabase.co hostname itself (DNS/SNI-level
// filtering), not just connections generally — every request to it fails
// or hangs, on every device, on every network, and no retry to that same
// hostname ever helps. netlify.toml proxies /supabase-proxy/* to this same
// project server-side, so requests through our own origin reach Supabase
// even when the direct hostname is blocked client-side. This only ever
// carries REST/Auth HTTP traffic — Realtime's WebSocket connection isn't
// routed through fetch() at all, so it still dials the direct host and,
// for users on a blocking network, simply won't connect (live updates
// silently stop arriving; a normal page load/refetch is unaffected).
//
// That redirect is defined in netlify.toml, which only Netlify's own edge
// evaluates — `vite dev` has no idea it exists, so /supabase-proxy/* is a
// genuine 404 in local dev. Gated on PROD so a dev-mode network blip can
// never "commit" the session to a proxy path that doesn't exist there
// (which previously broke every request after the first failure — even
// login — with a raw "Unexpected end of JSON input" from parsing that
// 404's empty body as if it were a real API response).
const PROXY_BASE = `${window.location.origin}/supabase-proxy`;
const USE_PROXY_KEY = 'psm_use_supabase_proxy';
const PROXY_FALLBACK_ENABLED = import.meta.env.PROD;

if (!PROXY_FALLBACK_ENABLED) {
  // Self-heal a session that got poisoned by this bug before this fix
  // shipped — otherwise the flag survives page refreshes (sessionStorage)
  // and keeps failing every request until the tab is closed.
  sessionStorage.removeItem(USE_PROXY_KEY);
}

function toProxyUrl(url: string): string {
  return PROXY_BASE + url.slice(supabaseUrl.length);
}

async function rawFetch(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: init?.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!PROXY_FALLBACK_ENABLED) return rawFetch(input, init);

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const isDirectSupabaseUrl = url.startsWith(supabaseUrl);

  // Already know this session needs the proxy — skip straight to it
  // instead of re-waiting on a doomed direct attempt every single call.
  if (isDirectSupabaseUrl && sessionStorage.getItem(USE_PROXY_KEY) === '1') {
    return rawFetch(toProxyUrl(url), init);
  }

  try {
    return await rawFetch(input, init);
  } catch (err) {
    if (!isDirectSupabaseUrl) throw err;
    const response = await rawFetch(toProxyUrl(url), init);
    sessionStorage.setItem(USE_PROXY_KEY, '1');
    return response;
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: rememberAwareStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

/** Call before login() with the state of the "Remember me" checkbox — it
 * decides where the resulting session gets written (see storage above). */
export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_ME_FLAG, remember ? 'true' : 'false');
}
