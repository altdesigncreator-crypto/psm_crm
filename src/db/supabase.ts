import {createClient} from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const REMEMBER_ME_FLAG = 'psm_remember_me';

// "Remember me" storage: while the flag is on, the session is written to
// localStorage (survives closing the browser/app). While it's off, the
// session lives only in sessionStorage, so it disappears once the tab/app
// is closed and the user has to sign in again next time.
const rememberAwareStorage = {
  getItem: (key: string) => {
    const remembered = localStorage.getItem(REMEMBER_ME_FLAG) === 'true';
    const primary = remembered ? localStorage : sessionStorage;
    const secondary = remembered ? sessionStorage : localStorage;
    const value = primary.getItem(key);
    if (value !== null) return value;
    // Heal flag/location mismatches (flag flipped between sessions, or a
    // session written by an older build): migrate the session to where
    // reads look now instead of silently "forgetting" the login.
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

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: rememberAwareStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** Call before login() with the state of the "Remember me" checkbox — it
 * decides where the resulting session gets written (see storage above). */
export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_ME_FLAG, remember ? 'true' : 'false');
}
