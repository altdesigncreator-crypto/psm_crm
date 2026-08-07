import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { cacheGet, cacheSet } from '@/lib/localCache';
import { setDepartmentsCache, type DepartmentRecord } from '@/lib/departments';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = 'departments-list';

/** Departments are managed data (public.departments), not a fixed list —
 * this hook is the single place every department <Select> should read from.
 * Visible identically to every authenticated user (departments_select RLS
 * has no per-viewer scoping), so the cache doesn't need to be user-keyed. */
export function useDepartments() {
  const cached = cacheGet<DepartmentRecord[]>(CACHE_KEY, CACHE_TTL_MS);
  if (cached) setDepartmentsCache(cached);
  const [departments, setDepartments] = useState<DepartmentRecord[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === undefined);

  const load = useCallback(async () => {
    const { data } = await supabase.from('departments').select('code, name, is_active').eq('is_active', true).order('name');
    const list = (data || []) as DepartmentRecord[];
    setDepartments(list);
    setDepartmentsCache(list);
    cacheSet(CACHE_KEY, list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('departments').on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => load()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const createDepartment = useCallback(async (code: string, name: string) => {
    const { error } = await supabase.from('departments').insert({ code: code.trim().toLowerCase(), name: name.trim() });
    if (!error) await load();
    return error;
  }, [load]);

  const updateDepartment = useCallback(async (code: string, name: string) => {
    const { error } = await supabase.from('departments').update({ name: name.trim() }).eq('code', code);
    if (!error) await load();
    return error;
  }, [load]);

  /** Hard delete — fails with a FK violation if historical rows still
   * reference the code; callers fall back to deactivate. */
  const deleteDepartment = useCallback(async (code: string) => {
    const { error } = await supabase.from('departments').delete().eq('code', code);
    if (!error) await load();
    return error;
  }, [load]);

  /** Soft delete: hides the department from every picker (the hook only
   * loads is_active rows) while historical records keep their labels. */
  const deactivateDepartment = useCallback(async (code: string) => {
    const { error } = await supabase.from('departments').update({ is_active: false }).eq('code', code);
    if (!error) await load();
    return error;
  }, [load]);

  return { departments, loading, createDepartment, updateDepartment, deleteDepartment, deactivateDepartment, refresh: load };
}
