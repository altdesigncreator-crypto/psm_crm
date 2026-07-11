import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import type { Profile } from '@/types';

/** Fetches the profiles visible to the current user under RLS (self for
 * Sales, department for Manager, everyone for Admin/Boss/Super Admin) —
 * used to populate "assign to" / "agent" pickers and name lookups. */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, name, phone, role, department_code, status, avatar_url, created_at')
        .order('name');
      if (active) {
        if (!error && data) setProfiles(data as Profile[]);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const nameOf = (id?: string | null) => (id ? byId[id]?.name || '—' : '—');

  return { profiles, byId, nameOf, loading };
}
