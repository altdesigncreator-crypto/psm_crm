import { supabase } from '@/db/supabase';

/** PostgREST caps any single request at 1000 rows — paging through in
 * chunks is the only way to get everything past that, capped at a generous
 * 20,000 as a sane ceiling. Shared by every page that still loads a full
 * table into memory (Pipeline Board, Dashboard, Follow-Ups) rather than
 * paginating server-side, so none of them silently drop data past 1000
 * rows the way a plain unbounded select() would.
 *
 * Ordering by created_at alone isn't enough to page safely: bulk-seeded
 * rows routinely share the exact same timestamp (100+ leads at once), and
 * Postgres doesn't guarantee a stable order for tied sort keys across
 * separate queries — rows can land on neither page's slice, silently
 * undercounting the total (e.g. dashboard showing 2,400 leads when there
 * are really 2,504). Adding `id` as a secondary sort key makes the order
 * total/deterministic, so every row is guaranteed exactly one page. */
export async function fetchAllRows<T>(table: string, maxRows = 20_000): Promise<T[]> {
  const chunkSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (all.length < maxRows) {
    const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + chunkSize - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < chunkSize) break;
    from += chunkSize;
  }
  return all.slice(0, maxRows);
}
