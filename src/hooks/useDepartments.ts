import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { cacheGet, cacheSet } from '@/lib/localCache';
import { setDepartmentsCache, sortDepartments, type DepartmentRecord } from '@/lib/departments';
import type { EnquiryCategory } from '@/types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = 'departments-list';

/** Departments are managed data (public.departments), not a fixed list —
 * this hook is the single place every department <Select> should read from.
 * Visible identically to every authenticated user (departments_select RLS
 * has no per-viewer scoping), so the cache doesn't need to be user-keyed.
 *
 * `departments` is the active ones, in branch order — what pickers offer.
 * The shared lookup cache keeps inactive ones too, since saved records still
 * reference them. */
export function useDepartments() {
  const cached = cacheGet<DepartmentRecord[]>(CACHE_KEY, CACHE_TTL_MS);
  if (cached) setDepartmentsCache(cached);
  const [all, setAll] = useState<DepartmentRecord[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === undefined);
  const departments = useMemo(() => sortDepartments(all.filter((d) => d.is_active)), [all]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('departments').select('code, name, branch_code, category, is_active').order('name');
    const list = (data || []) as DepartmentRecord[];
    setAll(list);
    setDepartmentsCache(list);
    cacheSet(CACHE_KEY, list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('departments').on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => load()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const createDepartment = useCallback(async (code: string, name: string, branchCode: string, category: EnquiryCategory | null) => {
    const { error } = await supabase.from('departments').insert({
      code: code.trim().toLowerCase(), name: name.trim(), branch_code: branchCode, category,
    });
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
