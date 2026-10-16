import { useEffect, useMemo, useState } from 'react';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { buildProjectIndex, countProjects, type ProjectIndex } from '@/lib/projectNames';

type ProjectRow = { preferred_project: string | null };

/** Preferred-project is free text (no fixed table backs it), so "the list
 * of known projects" is every distinct value on the leads the user can
 * see. This reads *all* of them — paged past PostgREST's 1000-row cap,
 * one narrow column — because a bounded sample silently drops whole
 * projects from the filter (that's how "Orchard" went missing).
 *
 * One fetch is shared by every consumer and reused for a few minutes, so
 * opening a filter or focusing the Add Lead field doesn't re-query. */
const TTL_MS = 5 * 60_000;
let cache: { at: number; promise: Promise<Map<string, number>> } | null = null;

function loadProjectCounts(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetchAllRows<ProjectRow>('leads', 50_000, 'preferred_project').then(countProjects);
  cache = { at: Date.now(), promise };
  // Don't pin a failed request — the next consumer should retry.
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}

/** Call after creating/editing a lead so the next read sees new spellings. */
export function invalidateProjectNames() {
  cache = null;
}

/** Grouped preferred projects across all leads (see lib/projectNames). Pass
 * a changing `refreshKey` (e.g. the user id) to reload. */
export function useProjectIndex(refreshKey?: unknown): { index: ProjectIndex; loading: boolean } {
  const [counts, setCounts] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let active = true;
    loadProjectCounts()
      .then((c) => { if (active) setCounts(c); })
      .catch(() => { if (active) setCounts(new Map()); });
    return () => { active = false; };
  }, [refreshKey]);

  const index = useMemo(() => buildProjectIndex(counts ?? new Map()), [counts]);
  return { index, loading: counts === null };
}
