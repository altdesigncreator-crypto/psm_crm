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
    return (remembered ? localStorage : sessionStorage).getItem(key);
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
