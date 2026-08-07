import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { cacheGet, cacheSetDebounced } from '@/lib/localCache';
import type { Profile } from '@/types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheKey = (userId: string) => `profiles-list:${userId}`;

interface ProfilesStore {
  profiles: Profile[];
  loading: boolean;
}

/** useProfiles() is called from nearly every page (Leads, LeadDetail,
 * Pipeline Board, Follow-Ups, User Management, Team Activity/Management,
 * Dashboard, Profile) — a naive per-component fetch-and-subscribe would
 * mean that many duplicate realtime channels open on the same table at
 * once. This module-level store is the single fetch + single subscription
 * for the whole app; every hook call just reads from it via
 * useSyncExternalStore, React's built-in primitive for exactly this
 * "many components, one external data source" shape. */
let store: ProfilesStore = { profiles: [], loading: true };
let subscribedUserId: string | undefined;
let channel: ReturnType<typeof supabase.channel> | null = null;
const listeners = new Set<() => void>();

function publish(next: ProfilesStore) {
  store = next;
  listeners.forEach((l) => l());
}

function patchAndCache(userId: string, next: Profile[]) {
  publish({ profiles: next, loading: false });
  cacheSetDebounced(cacheKey(userId), next);
}

function teardown() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  subscribedUserId = undefined;
}

function subscribeForUser(userId: string) {
  if (subscribedUserId === userId) return;
  teardown();
  subscribedUserId = userId;

  const cached = cacheGet<Profile[]>(cacheKey(userId), CACHE_TTL_MS);
  publish({ profiles: cached ?? [], loading: cached === undefined });

  supabase
    .from('profiles')
    .select('id, email, name, phone, role, department_code, status, avatar_url, created_at')
    .order('name')
    .then(({ data, error }) => {
      if (subscribedUserId !== userId) return;
      if (!error && data) patchAndCache(userId, data as Profile[]);
      else publish({ ...store, loading: false });
    });

  channel = supabase
    .channel('profiles-shared')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, (payload) => {
      const row = payload.new as Profile;
      const next = store.profiles.some((p) => p.id === row.id)
        ? store.profiles
        : [...store.profiles, row].sort((a, b) => a.name.localeCompare(b.name));
      patchAndCache(userId, next);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
      const row = payload.new as Profile;
      patchAndCache(userId, store.profiles.map((p) => (p.id === row.id ? row : p)));
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' }, (payload) => {
      const oldId = (payload.old as { id: string }).id;
      patchAndCache(userId, store.profiles.filter((p) => p.id !== oldId));
    })
    .subscribe();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getSnapshot() {
  return store;
}

export function useProfiles() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      subscribeForUser(user.id);
    } else if (channel) {
      teardown();
      publish({ profiles: [], loading: true });
    }
  }, [user?.id]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  // Memoized on the profiles array itself, not recreated every render —
  // callers that put nameOf/byId in a dependency array (e.g. a data-fetch
  // effect) need a reference that's actually stable across unrelated
  // re-renders, or that effect refires every render, not just when the
  // underlying data changes.
  const byId = useMemo(() => Object.fromEntries(snapshot.profiles.map((p) => [p.id, p])), [snapshot.profiles]);
  const nameOf = useCallback((id?: string | null) => (id ? byId[id]?.name || '—' : '—'), [byId]);

  return { profiles: snapshot.profiles, byId, nameOf, loading: snapshot.loading };
}
