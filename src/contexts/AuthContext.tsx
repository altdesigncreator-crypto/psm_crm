import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { isBiometricEnabledFor } from '@/lib/biometricAuth';
import { cacheGet, cacheSet, cacheClear } from '@/lib/localCache';
import { setBranchesCache, setDepartmentsCache, type BranchRecord, type DepartmentRecord } from '@/lib/departments';
import { rbacStore, useRbacCatalog, type RbacCatalog, type RbacCatalogData, type RoleKey, type Department } from '@/lib/permissions';

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: RoleKey;
  department: Department | null;
  status: 'active' | 'inactive';
  avatar_url: string | null;
}

interface AuthContextType {
  user: StaffUser | null;
  role: RoleKey | null;
  department: Department | null;
  /** Ids of teams this user manages — what 'team'-scoped permissions
   * resolve against. Empty for anyone who doesn't run a team. */
  managedTeamIds: string[];
  /** The live role/permission catalog. Included so every useAuth()
   * consumer re-renders when a role's permissions change. */
  rbac: RbacCatalog;
  /** Retry loading the role catalog now (it also retries on its own). */
  retryRbac: () => void;
  /** Reload the role catalog and wait for it — e.g. right after saving a
   * role, so the screen shows the saved version without waiting on realtime. */
  refreshRbac: () => Promise<void>;
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

/** True for the browser's own connectivity failures (request never got an
 * HTTP response at all) rather than a real rejection from the server —
 * covers Chrome's "Failed to fetch", Safari's "Load failed", and Firefox's
 * "NetworkError when attempting to fetch resource." */
function isNetworkError(message?: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes('failed to fetch') || m.includes('load failed') || m.includes('network');
}

async function loadProfile(userId: string): Promise<StaffUser> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, role, department_code, status, avatar_url')
    .eq('id', userId)
    .single();

  if (error || !data) {
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
    role: data.role as RoleKey,
    department: (data.department_code as Department) ?? null,
    status: data.status as 'active' | 'inactive',
    avatar_url: data.avatar_url ?? null,
  };
}

const PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const profileCacheKey = (userId: string) => `profile:${userId}`;
const teamsCacheKey = (userId: string) => `teams:${userId}`;
const RBAC_CACHE_KEY = 'rbac-catalog';
const ORG_CACHE_KEY = 'org-structure';

interface OrgStructure {
  departments: DepartmentRecord[];
  branches: BranchRecord[];
}

function applyOrgStructure(org: OrgStructure) {
  setBranchesCache(org.branches);
  setDepartmentsCache(org.departments);
}

async function loadManagedTeamIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('teams').select('id').eq('manager_id', userId);
  return (data || []).map((t) => t.id);
}

/** Roles, the permission catalog, every role's grants, and the branch /
 * department structure that branch and department scopes resolve through —
 * small tables, readable by every signed-in user, loaded whole. */
async function fetchRbacCatalog(): Promise<void> {
  const [roles, permissions, grants, departments, branches] = await Promise.all([
    supabase.from('roles').select('key, name, name_mm, description, rank, is_system, is_owner, requires_department'),
    supabase.from('permissions').select('key, category, scopes, sort_order, description, kind'),
    supabase.from('role_permissions').select('role_key, permission_key, scope'),
    supabase.from('departments').select('code, name, branch_code, category, is_active'),
    supabase.from('branches').select('code, name, name_mm, sort_order, is_active'),
  ]);
  const error = roles.error || permissions.error || grants.error || departments.error || branches.error;
  if (error) throw error;
  const org = { departments: departments.data || [], branches: branches.data || [] } as OrgStructure;
  applyOrgStructure(org);
  cacheSet(ORG_CACHE_KEY, org);
  // Set last: it notifies subscribers, who then see the org structure too.
  const next = { roles: roles.data || [], permissions: permissions.data || [], grants: grants.data || [] } as RbacCatalogData;
  rbacStore.set(next);
  cacheSet(RBAC_CACHE_KEY, next);
}

let rbacInFlight: Promise<void> | null = null;

/** Single-flight: sign-in, reconnects, tab focus and realtime events can all
 * ask at once, but only one request is ever outstanding. A failure is
 * recorded on the store (never thrown into sign-in) and retried by the
 * AuthProvider's sync loop. */
function loadRbacCatalog(): Promise<void> {
  rbacInFlight ??= fetchRbacCatalog()
    .catch((err) => {
      rbacStore.markFailed();
      throw err;
    })
    .finally(() => { rbacInFlight = null; });
  return rbacInFlight;
}

const RBAC_RETRY_MAX_MS = 30_000;

const cachedOrg = cacheGet<OrgStructure>(ORG_CACHE_KEY, PROFILE_CACHE_TTL_MS);
if (cachedOrg) applyOrgStructure(cachedOrg);
const cachedRbac = cacheGet<RbacCatalogData>(RBAC_CACHE_KEY, PROFILE_CACHE_TTL_MS);
// Only trust a cached catalog alongside the org structure it resolves through.
if (cachedRbac && cachedOrg) rbacStore.set(cachedRbac);

const BIO_UNLOCKED_FLAG = 'psm_bio_unlocked';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [managedTeamIds, setManagedTeamIds] = useState<string[]>([]);
  const rbac = useRbacCatalog();
  const [loading, setLoading] = useState(true);
  const [needsBiometricUnlock, setNeedsBiometricUnlock] = useState(false);

  const hydrate = useCallback(async (sessionUserId: string | null, opts?: { force?: boolean }) => {
    if (!sessionUserId) {
      setUser(null);
      setManagedTeamIds([]);
      return;
    }

    const cachedProfile = opts?.force ? undefined : cacheGet<StaffUser>(profileCacheKey(sessionUserId), PROFILE_CACHE_TTL_MS);
    if (cachedProfile) {
      setUser(cachedProfile);
      setManagedTeamIds(cacheGet<string[]>(teamsCacheKey(sessionUserId), PROFILE_CACHE_TTL_MS) ?? []);
    }

    const revalidate = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const [profile, teamIds] = await Promise.all([loadProfile(sessionUserId), loadManagedTeamIds(sessionUserId)]);
          setUser(profile);
          setManagedTeamIds(teamIds);
          cacheSet(profileCacheKey(sessionUserId), profile);
          cacheSet(teamsCacheKey(sessionUserId), teamIds);
          return;
        } catch (err) {
          if (err instanceof ProfileLoadError && err.definitive) {
            // Account is really gone/deactivated — only then drop the session.
            setUser(null);
            setManagedTeamIds([]);
            cacheClear(profileCacheKey(sessionUserId));
            cacheClear(teamsCacheKey(sessionUserId));
            await supabase.auth.signOut();
            return;
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      if (!cachedProfile) setUser(null);
    };

    if (cachedProfile) {
      void revalidate();
    } else {
      await revalidate();
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      const restoredUserId = data.session?.user.id ?? null;
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
    }).catch(() => {
      // getSession() itself failed (network/timeout) — fail open into the
      // logged-out state rather than leaving `loading` true forever, which
      // would otherwise strand the app on the splash screen.
      if (active) setLoading(false);
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
    // A cellular handoff or brief signal drop mid-request surfaces as
    // "Failed to fetch" — the underlying HTTP call never completed, not a
    // rejected login. One silent retry clears most of these; if it's a
    // real outage the second attempt fails the same way and falls through
    // to the friendly message below instead of the raw browser error text.
    let { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error && isNetworkError(error.message)) {
      await new Promise((r) => setTimeout(r, 800));
      ({ data, error } = await supabase.auth.signInWithPassword({ email, password }));
    }
    if (error || !data.user) {
      if (error && isNetworkError(error.message)) {
        throw new Error("Can't reach the server. Check your internet connection and try again.");
      }
      throw new Error(error?.message === 'Invalid login credentials'
        ? 'Incorrect email or password.'
        : error?.message || 'Unable to sign in.');
    }
    const [profile, teamIds] = await Promise.all([loadProfile(data.user.id), loadManagedTeamIds(data.user.id)]);
    setUser(profile);
    setManagedTeamIds(teamIds);
    cacheSet(profileCacheKey(profile.id), profile);
    cacheSet(teamsCacheKey(profile.id), teamIds);
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
    setManagedTeamIds([]);
    setNeedsBiometricUnlock(false);
    sessionStorage.removeItem(BIO_UNLOCKED_FLAG);
  }, [user]);

  // Keep the role catalog loaded and current for as long as someone is
  // signed in. Without it every permission check fails closed — menus and
  // pages silently disappear — so a failed load is never left to stand:
  //  - retry with exponential backoff until it succeeds;
  //  - retry immediately when the network returns or the app is reopened;
  //  - reload on any role/permission change (Role Management), and after
  //    the realtime channel reconnects, since changes made while it was
  //    down were never delivered.
  const syncRbacRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    let subscribedBefore = false;

    const sync = () => {
      window.clearTimeout(retryTimer);
      loadRbacCatalog().then(
        () => { attempt = 0; },
        () => {
          if (cancelled) return;
          retryTimer = window.setTimeout(sync, Math.min(RBAC_RETRY_MAX_MS, 1000 * 2 ** attempt++));
        },
      );
    };
    syncRbacRef.current = () => { attempt = 0; sync(); };

    const onVisible = () => { if (document.visibilityState === 'visible' && rbacStore.getSnapshot().failed) sync(); };
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', onVisible);

    const channel = supabase.channel('rbac')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, sync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions' }, sync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, sync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, sync)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (subscribedBefore || !rbacStore.getSnapshot().loaded) sync();
        subscribedBefore = true;
      });

    // A cached catalog renders instantly; this confirms it's still current.
    sync();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
      syncRbacRef.current = () => {};
    };
  }, [user?.id]);

  const retryRbac = useCallback(() => syncRbacRef.current(), []);
  const refreshRbac = useCallback(() => loadRbacCatalog().catch(() => {}), []);

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
      value={{ user, role: user?.role ?? null, department: user?.department ?? null, managedTeamIds, rbac, retryRbac, refreshRbac, loading, login, logout, refreshProfile, needsBiometricUnlock, completeBiometricUnlock }}
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
      managedTeamIds: [],
      rbac: rbacStore.getSnapshot(),
      retryRbac: () => {},
      refreshRbac: async () => {},
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
