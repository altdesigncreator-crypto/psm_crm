import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { buildProjectIndex, countProjects, type ProjectIndex } from '@/lib/projectNames';

type ProjectRow = { id: string; preferred_project: string | null };

/** Preferred-project is free text (no fixed table backs it), so "the list
 * of known projects" is every distinct value on the leads the user can
 * see. This reads *all* of them — paged past PostgREST's 1000-row cap,
 * two narrow columns — because a bounded sample silently drops whole
 * projects from the filter (that's how "Orchard" went missing).
 *
 * One fetch is shared by every consumer and reused for a few minutes, so
 * opening a filter or focusing the Add Lead field doesn't re-query. */
const TTL_MS = 5 * 60_000;
let cache: { at: number; promise: Promise<ProjectRow[]> } | null = null;

function loadProjectRows(): Promise<ProjectRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetchAllRows<ProjectRow>('leads', 50_000, 'id,preferred_project');
  cache = { at: Date.now(), promise };
  // Don't pin a failed request — the next consumer should retry.
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}

/** Call after creating/editing a lead so the next read sees new spellings. */
export function invalidateProjectNames() {
  cache = null;
}

/** Grouped preferred projects across all leads (see lib/projectNames), plus
 * a lead id → preferred_project lookup for tying enquiries to the lead they
 * converted into. Pass a changing `refreshKey` (e.g. the user id) to reload. */
export function useProjectIndex(refreshKey?: unknown): {
  index: ProjectIndex;
  projectOfLead: (leadId: string) => string | null | undefined;
  loading: boolean;
} {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);

  useEffect(() => {
    let active = true;
    loadProjectRows()
      .then((r) => { if (active) setRows(r); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [refreshKey]);

  const index = useMemo(() => buildProjectIndex(countProjects(rows ?? [])), [rows]);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r.preferred_project])), [rows]);
  const projectOfLead = useCallback((leadId: string) => byId.get(leadId), [byId]);
  return { index, projectOfLead, loading: rows === null };
}
