import type { EnquiryCategory } from '@/types';

/** One source list for enquiries and leads (public.enquiry_sources, managed
 * in Settings → Lead sources). These helpers are shared by the Enquiries and
 * Leads pages so both group, key and filter sources in exactly the same way.
 *
 * A source can sit in both categories ("Boss Viber"), so filter options are
 * keyed "<group>::<source>" to keep Select values unique; filtering always
 * compares on the source part alone. */
export const SOURCE_KEY_SEP = '::';
export const OTHER_SOURCES_GROUP = 'other';

export const sourceKey = (group: string, source: string) => `${group}${SOURCE_KEY_SEP}${source}`;

/** The source name in a filter key. A bare name (e.g. from a deep link) passes through. */
export const sourceOfKey = (key: string) => {
  const i = key.indexOf(SOURCE_KEY_SEP);
  return i < 0 ? key : key.slice(i + SOURCE_KEY_SEP.length);
};

export const groupOfKey = (key: string) => {
  const i = key.indexOf(SOURCE_KEY_SEP);
  return i < 0 ? null : key.slice(0, i);
};

export interface SourceGroup { key: string; label: string; sources: string[] }

/** Leads carry a department, enquiries a category — the same split under
 * two names. Null for departments with no source list of their own. */
export function categoryOfDepartment(code: string | null | undefined): EnquiryCategory | null {
  if (code === 'condo') return 'condo';
  if (code === 'house') return 'house_land';
  return null;
}

/** Filter groups: each category's sources — hidden ones too, since saved
 * records still carry them — then "Other" for any value in use that's in
 * neither list (renamed or deleted since, or from before the lists were
 * shared). `only` narrows to one category; "Other" is always kept. */
export function buildSourceGroups(
  byCategory: Record<EnquiryCategory, { all: string[] }>,
  inUse: Iterable<string | null | undefined>,
  labels: Record<EnquiryCategory | typeof OTHER_SOURCES_GROUP, string>,
  only?: EnquiryCategory | null,
): SourceGroup[] {
  const known = new Set([...byCategory.condo.all, ...byCategory.house_land.all]);
  const other = Array.from(new Set(Array.from(inUse).filter((s): s is string => !!s && !known.has(s))))
    .sort((a, b) => a.localeCompare(b));
  const groups: SourceGroup[] = (['condo', 'house_land'] as const)
    .filter((c) => !only || c === only)
    .map((c) => ({ key: c, label: labels[c], sources: byCategory[c].all }));
  if (other.length > 0) groups.push({ key: OTHER_SOURCES_GROUP, label: labels.other, sources: other });
  return groups;
}

/** A filter key for a bare source name: the first group listing it, so a
 * deep-linked `?source=DLM Hotline` selects the matching option. */
export function keyForSource(source: string, groups: SourceGroup[]): string {
  const group = groups.find((g) => g.sources.includes(source));
  return sourceKey(group?.key ?? OTHER_SOURCES_GROUP, source);
}
