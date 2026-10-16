/** Preferred-project is free text, so the same project arrives under many
 * spellings — "Ba Htoo Gyi Condo" / "BaHtooGyi Condo" / "Bahtoogyi",
 * "Lilie’s Apartment" / "Lilies Apartment" / "LiLi Apartment", "NDG 40*60" /
 * "North Dagon" / "မြောက်ဒဂုံ", typos like "MPT" for "MTP", and so on.
 *
 * This module folds those raw values into canonical project groups without
 * touching the stored data:
 *
 *   1. Every raw value is normalized to a comparison key (case, spacing,
 *      punctuation, curly quotes, "20*60"/"20-60"/"20×60" plot sizes…).
 *   2. Keys are matched against a curated catalog of known projects using
 *      approximate substring matching, so a one- or two-letter typo still
 *      lands in the right group. One raw value can mention several projects
 *      ("Mahar Swe Condo & MTP Condo") and then belongs to each of them.
 *   3. Anything the catalog doesn't know is clustered with its own near-
 *      duplicates (same key, or within a small edit distance) and labelled
 *      by its most common spelling — so brand-new projects still group well
 *      before anyone adds them to the catalog.
 *
 * Filters select *groups* and expand them back to the raw variants, so a
 * server-side `.in('preferred_project', variants)` keeps working unchanged. */

interface CatalogEntry {
  /** Display name for the group. */
  label: string;
  /** Spellings to detect, written naturally — they go through the same
   * normalization as the data, so "Ba Htoo Gyi" covers "BaHtooGyi" too. */
  aliases: string[];
  /** Match aliases exactly, no typo tolerance — for codes like "ERC"/"GRC"/
   * "KER" that sit one letter apart from a *different* project, and for
   * townships whose names differ only by a direction ("North"/"South"/
   * "East" Dagon) where an edit or two would cross the boundary. List
   * genuinely common misspellings of those as aliases instead. */
  exact?: boolean;
}

/** Known projects and townships. Extend this list when a new project shows
 * up under several spellings — no other change is needed. Order only
 * affects which label is listed first for a value naming several. */
const PROJECT_CATALOG: CatalogEntry[] = [
  { label: 'Orchard', aliases: ['Orchard', 'Orchid'] },
  { label: 'Shwe Padauk Avenue', aliases: ['Shwe Padauk', 'Shwe Padukha'] },
  { label: 'Ba Htoo Gyi Condo', aliases: ['Ba Htoo Gyi'] },
  { label: '441 Apartment', aliases: ['441 Apartment'], exact: true },
  { label: 'Dagon Landmark Residence', aliases: ['Dagon Landmark'] },
  { label: "Lilie's Apartment", aliases: ['Lilie', 'LiLi Apartment'] },
  { label: 'MTP Condo', aliases: ['MTP', 'MPT'], exact: true },
  { label: '65K Residence', aliases: ['65K'], exact: true },
  { label: 'Mahar Swe Condo', aliases: ['Mahar Swe', 'Maha Swe'] },
  { label: 'Grand Sayarsan Condo', aliases: ['Grand Sayarsan'] },
  { label: 'Aung Zay Ya City', aliases: ['Aung Zay Ya'] },
  { label: 'Aung Chanthar Condo', aliases: ['Aung Chanthar'] },
  { label: 'Diamond Inya Palace', aliases: ['Diamond Inya'] },
  { label: 'ERC Condo', aliases: ['ERC Condo'], exact: true },
  { label: 'GRC Condo', aliases: ['GRC Condo'], exact: true },
  { label: 'KER Condo', aliases: ['KER Condo'], exact: true },
  { label: 'Emerald Bay', aliases: ['Emerald Bay'] },
  { label: 'Inno City', aliases: ['Inno City', 'Inni City'] },
  { label: 'My Condo Residence', aliases: ['My Condo'], exact: true },
  { label: 'Magical World', aliases: ['Magical World'] },
  { label: 'Topaz Condo (Bahan)', aliases: ['Topaz'] },
  { label: 'Kamayut Mini Condo', aliases: ['Kamayut', 'Kamaryut'] },
  { label: 'Kanthayar Residence', aliases: ['Kanthayar'] },
  { label: 'Einzali Residence', aliases: ['Einzali'] },
  { label: 'Gonyi Residence', aliases: ['Gonyi'] },
  { label: 'Myathida Condo', aliases: ['Myathida'] },
  { label: 'Brilliant Mansion', aliases: ['Brilliant Mansion'] },
  { label: 'AMPS Avenue', aliases: ['AMPS Avenue'] },
  { label: 'Zarwana', aliases: ['Zarwana'] },
  { label: 'North Dagon', aliases: ['North Dagon', 'N/Dagon', 'NDG', 'မြောက်ဒဂုံ', 'မြောကိဒဂုံ'], exact: true },
  { label: 'East Dagon', aliases: ['East Dagon', 'အရှေ့ဒဂုံ'], exact: true },
  { label: 'South Dagon', aliases: ['South Dagon', 'တောင်ဒဂုံ'], exact: true },
  { label: 'South Okkalapa', aliases: ['South Okkalapa'], exact: true },
  { label: 'Hlaing Tharyar', aliases: ['Hlaing Tharyar', 'လှိုင်သာယာ'] },
  { label: 'Mayangone', aliases: ['Mayangon'] },
  { label: 'Bahan', aliases: ['Bahan'] },
  { label: 'Insein', aliases: ['Insein'] },
];

/* ───────────────────────── normalization ───────────────────────── */

/** A land-plot size, written any of "20*60", "20-60", "20/60", "20×60",
 * "20x60". Two-to-three digits each side, so "7/8/9 mile" isn't one. */
const PLOT_SIZE = /(?<!\d)(\d{2,3})\s*[*x×/\-]\s*(\d{2,3})(?!\d)/g;

/** Reduces a raw value to a comparison key: NFKC-folded, lowercased, curly
 * quotes and possessive "'s" removed, plot sizes unified to "AxB", and every
 * remaining non-letter/non-digit (spaces, punctuation) stripped. Burmese
 * letters and combining marks are kept, so Myanmar text compares as well. */
export function projectKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'s\b/g, 's')
    .replace(PLOT_SIZE, '$1x$2')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

/** Generic words that don't distinguish one project from another — dropped
 * when clustering unknown values, so "Foo Condo" and "Foo Residence" meet. */
const GENERIC_SUFFIXES = /(condominium|condo|residences?|resident|apartments?|mansion|tower|project)$/;

/** Values that name no project but do name a plot size ("20-60", "27000L
 * (40-60)") group under that size, since that's what the lead asked for. */
function plotSizeLabel(raw: string): string | null {
  const m = new RegExp(PLOT_SIZE.source).exec(raw.normalize('NFKC'));
  return m ? `${m[1]}×${m[2]} plot` : null;
}

function clusterKey(raw: string): string {
  const key = projectKey(raw);
  const stripped = key.replace(GENERIC_SUFFIXES, '');
  return stripped.length >= 3 ? stripped : key;
}

/* ───────────────────────── fuzzy matching ───────────────────────── */

/** Typos tolerated for a term of this length — none for short codes like
 * "NDG"/"MTP" (one edit would make them match almost anything). */
function maxEdits(length: number): number {
  if (length < 5) return 0;
  if (length < 10) return 1;
  return 2;
}

/** Smallest edit distance between `needle` and any substring of
 * `haystack` (Sellers' algorithm), short-circuiting once it can't get
 * under `limit`. O(|needle|·|haystack|), fine for short project names. */
function approxSubstringDistance(needle: string, haystack: string, limit: number): number {
  if (haystack.includes(needle)) return 0;
  if (limit === 0) return Infinity;
  const m = needle.length;
  let prev = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = prev[m];
  for (let j = 1; j <= haystack.length; j++) {
    const cur = new Array<number>(m + 1);
    cur[0] = 0;
    for (let i = 1; i <= m; i++) {
      const cost = needle[i - 1] === haystack[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + cost);
    }
    if (cur[m] < best) best = cur[m];
    prev = cur;
  }
  return best;
}

/** Plain Levenshtein distance, bailing out early past `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return Infinity;
    prev = cur;
  }
  return prev[b.length];
}

const COMPILED_CATALOG = PROJECT_CATALOG.map((entry) => ({
  label: entry.label,
  keys: Array.from(new Set(entry.aliases.map(projectKey))).filter(Boolean),
  exact: entry.exact ?? false,
}));

const resolveCache = new Map<string, string[]>();

/** Canonical catalog labels a raw value refers to (possibly several, or
 * none). Memoized — the same few hundred spellings get resolved by every
 * page and every render. */
export function matchCatalog(raw: string): string[] {
  const key = projectKey(raw);
  const cached = resolveCache.get(key);
  if (cached) return cached;
  const labels: string[] = [];
  if (key) {
    for (const entry of COMPILED_CATALOG) {
      const hit = entry.keys.some((k) => {
        const limit = entry.exact ? 0 : maxEdits(k.length);
        return approxSubstringDistance(k, key, limit) <= limit;
      });
      if (hit) labels.push(entry.label);
    }
  }
  resolveCache.set(key, labels);
  return labels;
}

/** Catalog projects a value names, else its plot size, else nothing. */
function knownLabels(raw: string): string[] {
  const labels = matchCatalog(raw);
  if (labels.length > 0) return labels;
  const plot = plotSizeLabel(raw);
  return plot ? [plot] : [];
}

/* ───────────────────────── grouping ───────────────────────── */

export interface ProjectGroup {
  /** Stable identifier and display name — the canonical/most-common spelling. */
  label: string;
  /** Every raw stored value that belongs to this group. */
  variants: string[];
  /** Number of leads in the group (sum over its variants). */
  count: number;
}

export interface ProjectIndex {
  groups: ProjectGroup[];
  /** raw value → labels of the groups it belongs to. */
  groupsOf: (raw: string | null | undefined) => string[];
  /** Projects mentioned anywhere inside free text (e.g. an enquiry
   * message): catalog projects, plot sizes, plus any known group whose
   * name appears in the text. */
  detectIn: (text: string | null | undefined) => string[];
  /** Selected group labels → every raw value to filter on. Unknown
   * selections (e.g. a raw value restored from an older saved filter) are
   * passed through as-is, so nothing silently stops matching. */
  expand: (selected: string[]) => string[];
}

/** Builds the grouping from raw values and their lead counts. Cheap enough
 * to run in a useMemo over a few thousand leads. */
export function buildProjectIndex(counts: Map<string, number>): ProjectIndex {
  const byLabel = new Map<string, { variants: Set<string>; count: number }>();
  const memberOf = new Map<string, string[]>();

  const add = (label: string, raw: string, n: number) => {
    let g = byLabel.get(label);
    if (!g) byLabel.set(label, (g = { variants: new Set(), count: 0 }));
    g.variants.add(raw);
    g.count += n;
    const labels = memberOf.get(raw) ?? [];
    if (!labels.includes(label)) labels.push(label);
    memberOf.set(raw, labels);
  };

  // Pass 1: catalog matches. Pass 2: cluster the rest among themselves.
  const unmatched: { raw: string; key: string; n: number }[] = [];
  for (const [raw, n] of counts) {
    const labels = knownLabels(raw);
    if (labels.length > 0) labels.forEach((label) => add(label, raw, n));
    else unmatched.push({ raw, key: clusterKey(raw), n });
  }

  // Most common spelling first, so it becomes the cluster's label.
  unmatched.sort((a, b) => b.n - a.n || a.raw.localeCompare(b.raw));
  const clusters: { key: string; label: string }[] = [];
  for (const item of unmatched) {
    // Digits carry meaning ("20x60" vs "40x60", "Tower 1" vs "Tower 2"), so
    // only digit-free keys get typo tolerance.
    const limit = /\d/.test(item.key) ? 0 : maxEdits(item.key.length);
    const home = clusters.find((c) => c.key === item.key || (limit > 0 && editDistance(c.key, item.key, limit) <= limit));
    if (home) add(home.label, item.raw, item.n);
    else {
      const label = item.raw.trim().replace(/\s+/g, ' ');
      // A free-text label could collide with a catalog label; keep them apart.
      const unique = byLabel.has(label) ? `${label} ` : label;
      clusters.push({ key: item.key, label: unique });
      add(unique, item.raw, item.n);
    }
  }

  const groups: ProjectGroup[] = Array.from(byLabel, ([label, g]) => ({
    label,
    variants: Array.from(g.variants).sort((a, b) => a.localeCompare(b)),
    count: g.count,
  })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));

  const variantsOf = new Map(groups.map((g) => [g.label, g.variants]));
  // Non-catalog groups detectable in free text: distinctive names only —
  // "Condo" or "Apartment" alone would match nearly every message.
  const textKeys = groups
    .map((g) => ({ label: g.label, key: clusterKey(g.label) }))
    .filter(({ key }) => key.length >= 5 && !/^[\d x]+$/.test(key) && !GENERIC_SUFFIXES.test(key) && !/^(mini|luxury)/.test(key));

  return {
    groups,
    groupsOf: (raw) => (raw ? memberOf.get(raw) ?? knownLabels(raw) : []),
    detectIn: (text) => {
      if (!text?.trim()) return [];
      const found = new Set(knownLabels(text));
      const key = projectKey(text);
      for (const g of textKeys) if (key.includes(g.key)) found.add(g.label);
      return Array.from(found);
    },
    expand: (selected) => Array.from(new Set(selected.flatMap((s) => variantsOf.get(s) ?? [s]))),
  };
}

/** Counts non-empty preferred_project values on a list of leads. */
export function countProjects(rows: { preferred_project?: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r.preferred_project;
    if (v && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

/** Case/spacing/typo-insensitive "does this group match what was typed" —
 * checks the label and every variant, for search boxes over groups. */
export function groupMatchesQuery(group: ProjectGroup, query: string): boolean {
  const q = projectKey(query);
  if (!q) return true;
  return [group.label, ...group.variants].some((v) => {
    const key = projectKey(v);
    return key.includes(q) || (q.length >= 5 && approxSubstringDistance(q, key, maxEdits(q.length)) <= maxEdits(q.length));
  });
}
