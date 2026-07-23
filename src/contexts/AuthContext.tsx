import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { isBiometricEnabledFor } from '@/lib/biometricAuth';
import { cacheGet, cacheSet, cacheClear } from '@/lib/localCache';
import type { RoleTier, Department } from '@/lib/permissions';

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: RoleTier;
  department: Department | null;
  status: 'active' | 'inactive';
  avatar_url: string | null;
}

interface AuthContextType {
  user: StaffUser | null;
  role: RoleTier | null;
  department: Department | null;
  /** Ids of teams this user is part of — teams they manage (Manager) or
   * teams they're a member of (Sales Person). Empty for Admin/exec, who
   * stay department-wide/global and don't need team scoping. */
  myTeamIds: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<StaffUser>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** True only when a "Remember me" session was silently restored on app
   * start and the user has biometric sign-in enrolled on this device. A
   * fresh email/password login never sets this — biometrics are an
   * alternative way in, not a second gate. */
  needsBiometricUnlock: boolean;
  completeBiometricUnlock: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Thrown by loadProfile. `definitive` = the account truly can't be used
 * (missing or deactivated) — as opposed to a transient network/API failure
 * that should never cost the user their remembered session. */
class ProfileLoadError extends Error {
  constructor(message: string, public definitive: boolean) {
    super(message);
  }
}

async function loadProfile(userId: string): Promise<StaffUser> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, role, department_code, status, avatar_url')
    .eq('id', userId)
    .single();

  if (error || !data) {
    // PGRST116 = zero rows: the profile genuinely doesn't exist. Anything
    // else (network drop, timeout, transient API error) is retryable.
    const missing = (error as { code?: string } | null)?.code === 'PGRST116';
    throw new ProfileLoadError('Could not load your staff profile. Contact your administrator.', missing);
  }
  if (data.status !== 'active') {
    throw new ProfileLoadError('Your account has been deactivated. Contact your administrator.', true);
  }

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: data.role as RoleTier,
    department: (data.department_code as Department) ?? null,
    status: data.status as 'active' | 'inactive',
    avatar_url: data.avatar_url ?? null,
  };
}

// Backstop only — the background revalidation on every hydrate() call (and
// the Realtime-driven refreshes elsewhere) keep this fresh long before a
// cache this old would ever actually be read.
const PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const profileCacheKey = (userId: string) => `profile:${userId}`;
const teamsCacheKey = (userId: string) => `teams:${userId}`;

async function loadMyTeamIds(userId: string, role: RoleTier): Promise<string[]> {
  if (role === 'manager') {
    const { data } = await supabase.from('teams').select('id').eq('manager_id', userId);
    return (data || []).map((t) => t.id);
  }
  if (role === 'sale') {
    const { data } = await supabase.from('team_members').select('team_id').eq('sale_person_id', userId);
    return (data || []).map((t) => t.team_id);
  }
  return [];
}

// Set once biometrics (or a password login) verified this browser session —
// sessionStorage survives refreshes but not closing the browser/app, so the
// biometric prompt appears once per session instead of on every refresh.
const BIO_UNLOCKED_FLAG = 'psm_bio_unlocked';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [myTeamIds, setMyTeamIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsBiometricUnlock, setNeedsBiometricUnlock] = useState(false);

  const hydrate = useCallback(async (sessionUserId: string | null, opts?: { force?: boolean }) => {
    if (!sessionUserId) {
      setUser(null);
      setMyTeamIds([]);
      return;
    }

    // Boot instantly from the last known-good profile for this device, if
    // we have one, instead of blocking first paint on a network round trip
    // every single launch — this is the "super fast next time" path. It's
    // only ever a placeholder: Postgres RLS is the real access boundary
    // (see permissions.ts), so showing a few-second-stale name/role/avatar
    // is harmless, and the real fetch below still runs to confirm or
    // correct it. Skipped when force-refreshing right after the user
    // changed their own profile (Settings) — applying stale cache there
    // would flash the old value back before the real fetch corrects it.
    const cachedProfile = opts?.force ? undefined : cacheGet<StaffUser>(profileCacheKey(sessionUserId), PROFILE_CACHE_TTL_MS);
    if (cachedProfile) {
      setUser(cachedProfile);
      setMyTeamIds(cacheGet<string[]>(teamsCacheKey(sessionUserId), PROFILE_CACHE_TTL_MS) ?? []);
    }

    const revalidate = async () => {
      // Retry transient failures — a flaky mobile connection on app start
      // used to hit the catch below and sign the user out, permanently
      // destroying the "Remember me" session over a hiccup.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const profile = await loadProfile(sessionUserId);
          const teamIds = await loadMyTeamIds(profile.id, profile.role);
          setUser(profile);
          setMyTeamIds(teamIds);
          cacheSet(profileCacheKey(sessionUserId), profile);
          cacheSet(teamsCacheKey(sessionUserId), teamIds);
          return;
        } catch (err) {
          if (err instanceof ProfileLoadError && err.definitive) {
            // Account is really gone/deactivated — only then drop the session.
            setUser(null);
            setMyTeamIds([]);
            cacheClear(profileCacheKey(sessionUserId));
            cacheClear(teamsCacheKey(sessionUserId));
            await supabase.auth.signOut();
            return;
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      // Still failing after retries (offline?): if we already had a cached
      // profile on screen, leave it there rather than yanking the user back
      // to the login screen over a transient blip — only a genuine cache
      // miss falls back to signed-out.
      if (!cachedProfile) setUser(null);
    };

    if (cachedProfile) {
      // Cached data is already live on screen — don't make the caller (and
      // therefore the splash screen) wait on this; it's a background
      // revalidation now, not a blocking load.
      void revalidate();
    } else {
      await revalidate();
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      const restoredUserId = data.session?.user.id ?? null;
      // Session came back from storage without the user typing anything —
      // if they enrolled biometrics, offer the biometric sign-in gate, but
      // only once per browser session: a plain refresh after unlocking
      // must not ask again.
      if (
        restoredUserId
        && isBiometricEnabledFor(restoredUserId)
        && sessionStorage.getItem(BIO_UNLOCKED_FLAG) !== restoredUserId
      ) {
        setNeedsBiometricUnlock(true);
      }
      hydrate(restoredUserId).finally(() => {
        if (active) setLoading(false);
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      hydrate(session?.user.id ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [hydrate]);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      throw new Error(error?.message === 'Invalid login credentials'
        ? 'Incorrect email or password.'
        : error?.message || 'Unable to sign in.');
    }
    const profile = await loadProfile(data.user.id);
    const teamIds = await loadMyTeamIds(profile.id, profile.role);
    setUser(profile);
    setMyTeamIds(teamIds);
    cacheSet(profileCacheKey(profile.id), profile);
    cacheSet(teamsCacheKey(profile.id), teamIds);
    // Signing in with email/password IS the authentication — never stack
    // the biometric gate on top of it, and count it as this session's unlock.
    setNeedsBiometricUnlock(false);
    sessionStorage.setItem(BIO_UNLOCKED_FLAG, profile.id);
    await supabase.from('audit_logs').insert({ action: 'login', performed_by: profile.id });
    return profile;
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      await supabase.from('audit_logs').insert({ action: 'logout', performed_by: user.id });
      cacheClear(profileCacheKey(user.id));
      cacheClear(teamsCacheKey(user.id));
    }
    await supabase.auth.signOut();
    setUser(null);
    setMyTeamIds([]);
    setNeedsBiometricUnlock(false);
    sessionStorage.removeItem(BIO_UNLOCKED_FLAG);
  }, [user]);

  const completeBiometricUnlock = useCallback(() => {
    setNeedsBiometricUnlock(false);
    if (user?.id) sessionStorage.setItem(BIO_UNLOCKED_FLAG, user.id);
  }, [user?.id]);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id) await hydrate(data.session.user.id, { force: true });
  }, [hydrate]);

  return (
    <AuthContext.Provider
      value={{ user, role: user?.role ?? null, department: user?.department ?? null, myTeamIds, loading, login, logout, refreshProfile, needsBiometricUnlock, completeBiometricUnlock }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      user: null,
      role: null,
      department: null,
      myTeamIds: [],
      loading: true,
      login: async () => { throw new Error('Auth Context not mounted'); },
      logout: async () => {},
      refreshProfile: async () => {},
      needsBiometricUnlock: false,
      completeBiometricUnlock: () => {},
    } as AuthContextType;
  }
  return context;
}
