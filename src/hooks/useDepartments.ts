import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { setDepartmentsCache, type DepartmentRecord } from '@/lib/departments';

/** Departments are managed data (public.departments), not a fixed list —
 * this hook is the single place every department <Select> should read from. */
export function useDepartments() {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from('departments').select('code, name, is_active').eq('is_active', true).order('name');
    const list = (data || []) as DepartmentRecord[];
    setDepartments(list);
    setDepartmentsCache(list);
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

  return { departments, loading, createDepartment, refresh: load };
}
