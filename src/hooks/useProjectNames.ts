import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';

/** Preferred-project is free text (no fixed table backs it), so "the list
 * of known projects" is just whatever distinct values already exist on
 * leads — sampled once per session rather than re-queried on every
 * keystroke of an autocomplete. */
export function useProjectNames() {
  const [projectNames, setProjectNames] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    supabase.from('leads').select('preferred_project').not('preferred_project', 'is', null).limit(5000)
      .then(({ data }) => {
        if (!active) return;
        const names = Array.from(new Set((data || []).map((r) => (r as { preferred_project: string | null }).preferred_project).filter((v): v is string => !!v && v.trim().length > 0)));
        setProjectNames(names.sort((a, b) => a.localeCompare(b)));
      });
    return () => { active = false; };
  }, []);

  return { projectNames };
}
