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

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ?? controller.signal }).finally(() => clearTimeout(timeout));
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
