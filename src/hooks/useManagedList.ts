import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/db/supabase';
import { cacheGet, cacheSet } from '@/lib/localCache';
import type { EnquiryCategory } from '@/types';

/** A short list of names per branch and category (Condo / House & Land)
 * that Manager and above maintain in Settings — enquiry/lead sources and
 * projects today. Each branch keeps its own lists.
 * Every such list is the same shape in the database (category, name,
 * sort_order, is_active; see the enquiry_sources and projects migrations),
 * so one hook, one picker and one Settings screen serve them all. */
export interface ListItem {
  id: string;
  branch_code: string;
  category: EnquiryCategory;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface ManagedListConfig {
  table: 'enquiry_sources' | 'projects';
  /** Security-invoker RPC taking (p_category, p_ids) in their new order. */
  reorderFn: 'reorder_enquiry_sources' | 'reorder_projects';
  cacheKey: string;
  /** Built-in names, shown before the first fetch on a fresh device and
   * whenever the table can't be read — so a form is never left empty. */
  fallback: Record<EnquiryCategory, readonly string[]>;
}

export const ENQUIRY_CATEGORIES: EnquiryCategory[] = ['condo', 'house_land'];

export const CATEGORY_LABEL_KEYS: Record<EnquiryCategory, string> = {
  condo: 'enquiries.categoryCondo',
  house_land: 'enquiries.categoryHouseLand',
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const COLUMNS = 'id, branch_code, category, name, sort_order, is_active';

/** Collapses runs of whitespace — "ACTY  Facebook " and "ACTY Facebook" are one entry. */
export const normalizeListName = (name: string) => name.trim().replace(/\s+/g, ' ');

const byOrder = (a: ListItem, b: ListItem) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

function fallbackRows(config: ManagedListConfig): ListItem[] {
  return ENQUIRY_CATEGORIES.flatMap((category) => config.fallback[category].map((name, i) => ({
    id: `fallback:${category}:${name}`, branch_code: '', category, name, sort_order: (i + 1) * 10, is_active: true,
  })));
}

/** Pass a module-level config constant — it keys the callbacks below.
 * `branch` narrows to that branch's list (what forms and Settings use);
 * leave it out to see every branch's names (what filters use). */
export function useManagedList(config: ManagedListConfig, branch?: string | null) {
  const cached = cacheGet<ListItem[]>(config.cacheKey, CACHE_TTL_MS);
  const [rows, setRows] = useState<ListItem[]>(() => cached ?? fallbackRows(config));
  const [loading, setLoading] = useState(cached === undefined);
  /** True while showing the built-in list because the table couldn't be read. */
  const [unavailable, setUnavailable] = useState(false);
  const channelId = useId();
  const { table, reorderFn, cacheKey } = config;

  const load = useCallback(async (): Promise<PostgrestError | null> => {
    const { data, error } = await supabase.from(table).select(COLUMNS).order('sort_order').order('name');
    if (error) {
      setUnavailable(true);
      setLoading(false);
      return error;
    }
    const list = (data || []) as ListItem[];
    setRows(list);
    setUnavailable(false);
    cacheSet(cacheKey, list);
    setLoading(false);
    return null;
  }, [table, cacheKey]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`${table}-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, table, channelId]);

  /** Per category: `active` for pickers, `all` (hidden ones too) for
   * filters, since saved records still carry hidden names. */
  const byCategory = useMemo(() => {
    const out: Record<EnquiryCategory, { rows: ListItem[]; active: string[]; all: string[] }> = {
      condo: { rows: [], active: [], all: [] },
      house_land: { rows: [], active: [], all: [] },
    };
    // The built-in fallback (branch_code '') stands in for any branch.
    const inBranch = (r: ListItem) => !branch || r.branch_code === branch || r.branch_code === '';
    const seen = new Set<string>();
    for (const r of [...rows].filter(inBranch).sort(byOrder)) {
      // Across branches the same name appears once per branch; list it once.
      const key = `${r.category}|${r.name.toLowerCase()}`;
      if (!branch && seen.has(key)) continue;
      seen.add(key);
      const bucket = out[r.category];
      if (!bucket) continue;
      bucket.rows.push(r);
      bucket.all.push(r.name);
      if (r.is_active) bucket.active.push(r.name);
    }
    return out;
  }, [rows, branch]);

  /** Adds `name` to each given category of this branch, after its last
   * entry. Without a branch the database files it under the creator's own. */
  const create = useCallback(async (name: string, categories: EnquiryCategory[]) => {
    const clean = normalizeListName(name);
    const { error } = await supabase.from(table).insert(categories.map((category) => ({
      ...(branch ? { branch_code: branch } : {}),
      category,
      name: clean,
      sort_order: Math.max(0, ...byCategory[category].rows.map((r) => r.sort_order)) + 10,
    })));
    if (!error) await load();
    return error;
  }, [table, branch, byCategory, load]);

  const rename = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.from(table).update({ name: normalizeListName(name) }).eq('id', id);
    if (!error) await load();
    return error;
  }, [table, load]);

  /** Hide/show in pickers. Saved records are unaffected. */
  const setActive = useCallback(async (id: string, isActive: boolean) => {
    const { error } = await supabase.from(table).update({ is_active: isActive }).eq('id', id);
    if (!error) await load();
    return error;
  }, [table, load]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (!error) await load();
    return error;
  }, [table, load]);

  /** Saves a category's new order in one atomic call. Applied optimistically
   * so the list doesn't jump; a failure reloads the server's order. */
  const reorder = useCallback(async (category: EnquiryCategory, orderedIds: string[]) => {
    const position = new Map(orderedIds.map((id, i) => [id, (i + 1) * 10]));
    setRows((prev) => prev.map((r) => (r.category === category && position.has(r.id) ? { ...r, sort_order: position.get(r.id)! } : r)));
    const { error } = await supabase.rpc(reorderFn, { p_category: category, p_ids: orderedIds });
    await load();
    return error;
  }, [reorderFn, load]);

  return { rows, byCategory, loading, unavailable, create, rename, setActive, remove, reorder, refresh: load };
}

export type ManagedList = ReturnType<typeof useManagedList>;
