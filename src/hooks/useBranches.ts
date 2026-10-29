import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { cacheGet, cacheSet } from '@/lib/localCache';
import { setBranchesCache, type BranchRecord } from '@/lib/departments';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = 'branches-list';

/** Branches (public.branches) — managed in Settings → System configuration.
 * `branches` is the active ones, in display order; the shared lookup cache
 * keeps inactive ones for labels on older records. */
export function useBranches() {
  const cached = cacheGet<BranchRecord[]>(CACHE_KEY, CACHE_TTL_MS);
  if (cached) setBranchesCache(cached);
  const [all, setAll] = useState<BranchRecord[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === undefined);
  const branches = useMemo(
    () => all.filter((b) => b.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [all],
  );

  const load = useCallback(async () => {
    const { data } = await supabase.from('branches').select('code, name, name_mm, sort_order, is_active').order('sort_order');
    const list = (data || []) as BranchRecord[];
    setAll(list);
    setBranchesCache(list);
    cacheSet(CACHE_KEY, list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('branches').on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, () => load()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const createBranch = useCallback(async (code: string, name: string, nameMm: string) => {
    const sortOrder = Math.max(0, ...all.map((b) => b.sort_order)) + 10;
    const { error } = await supabase.from('branches').insert({
      code: code.trim().toLowerCase(), name: name.trim(), name_mm: nameMm.trim() || null, sort_order: sortOrder,
    });
    if (!error) await load();
    return error;
  }, [all, load]);

  const updateBranch = useCallback(async (code: string, fields: Partial<Pick<BranchRecord, 'name' | 'name_mm' | 'is_active'>>) => {
    const { error } = await supabase.from('branches').update(fields).eq('code', code);
    if (!error) await load();
    return error;
  }, [load]);

  return { branches, allBranches: all, loading, createBranch, updateBranch, refresh: load };
}
