import { buildProjectIndex, countProjects, type ProjectIndex } from '@/lib/projectNames';

/** Per-project demand analysis — enquiries, leads, sources, conversion —
 * as pure functions over already-loaded rows, so the page stays a thin
 * view and the numbers can be reasoned about (and tested) in isolation.
 *
 * Attribution rules, in order of trust:
 *   Leads      → their preferred_project, folded into project groups.
 *   Enquiries  → (1) the project of the lead they were converted into;
 *                (2) otherwise a project named in the enquiry's message;
 *                (3) otherwise "unattributed" — counted in totals, never
 *                    guessed into a project.
 * A row naming several projects counts once toward each of them, so
 * per-project figures can sum to more than the overall total. */

export interface InsightLead {
  id: string;
  preferred_project: string | null;
  lead_source: string | null;
  status: string;
  lead_grade: string | null;
  sale_amount: number | null;
  created_at: string;
}

export interface InsightEnquiry {
  id: string;
  source: string | null;
  message: string | null;
  status: string;
  converted_lead_id: string | null;
  created_at: string;
}

export const LEAD_COLUMNS = 'id,preferred_project,lead_source,status,lead_grade,sale_amount,created_at';
export const ENQUIRY_COLUMNS = 'id,source,message,status,converted_lead_id,created_at';

/** Sentinel group for leads with no project / unmatched enquiries. */
export const UNSPECIFIED = '__unspecified__';
/** Sentinel source for rows with no source recorded. */
export const NO_SOURCE = '__no_source__';

export type DateRange = { gte: string; lt: string } | null;

export interface MonthPoint { month: string; enquiries: number; leads: number }

export interface ProjectStats {
  label: string;
  variants: string[];
  enquiries: number;
  enquiriesPrev: number;
  /** Enquiries in the period that were converted into a lead. */
  convertedEnquiries: number;
  leads: number;
  leadsPrev: number;
  sold: number;
  revenue: number;
  leadSources: Map<string, number>;
  enquirySources: Map<string, number>;
  statuses: Map<string, number>;
  grades: Map<string, number>;
  /** Trailing 12 months, independent of the selected period. */
  trend: MonthPoint[];
}

export interface InsightsResult {
  projects: ProjectStats[];
  totals: {
    enquiries: number;
    enquiriesPrev: number;
    convertedEnquiries: number;
    leads: number;
    leadsPrev: number;
    sold: number;
    revenue: number;
    /** Enquiries in the period that could be tied to a project. */
    attributedEnquiries: number;
    attributedByConversion: number;
    attributedByMessage: number;
  };
  /** Every source seen in the period, most used first (leads + enquiries). */
  sources: { source: string; leads: number; enquiries: number }[];
  index: ProjectIndex;
}

type MsRange = { gte: number; lt: number } | null;
const toMs = (r: DateRange): MsRange => (r ? { gte: Date.parse(r.gte), lt: Date.parse(r.lt) } : null);
/** Compared as epoch ms — Postgres ("…+00:00", microseconds) and JS
 * ("….000Z") ISO strings don't order correctly as plain strings. */
const inRange = (iso: string, r: MsRange) => {
  if (!r) return true;
  const t = Date.parse(iso);
  return t >= r.gte && t < r.lt;
};

/** created_at → "YYYY-MM" in local time, matching how the period filter
 * buckets months. */
function monthOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function trailingMonthKeys(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const sourceKey = (s: string | null) => s?.trim() || NO_SOURCE;

export function computeProjectInsights(
  leads: InsightLead[],
  enquiries: InsightEnquiry[],
  periodRange: DateRange,
  prevPeriodRange: DateRange,
): InsightsResult {
  const range = toMs(periodRange);
  const prevRange = toMs(prevPeriodRange);
  // Grouping is built from *all* leads, not just this period's, so a
  // project keeps the same name and spellings as you page through months.
  const index = buildProjectIndex(countProjects(leads));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const months = trailingMonthKeys(12);
  const monthSet = new Set(months);

  const byLabel = new Map<string, ProjectStats>();
  const statsFor = (label: string): ProjectStats => {
    let s = byLabel.get(label);
    if (!s) {
      s = {
        label,
        variants: index.groups.find((g) => g.label === label)?.variants ?? [],
        enquiries: 0, enquiriesPrev: 0, convertedEnquiries: 0,
        leads: 0, leadsPrev: 0, sold: 0, revenue: 0,
        leadSources: new Map(), enquirySources: new Map(), statuses: new Map(), grades: new Map(),
        trend: months.map((month) => ({ month, enquiries: 0, leads: 0 })),
      };
      byLabel.set(label, s);
    }
    return s;
  };
  const addTrend = (s: ProjectStats, iso: string, field: 'enquiries' | 'leads') => {
    const m = monthOf(iso);
    if (monthSet.has(m)) s.trend[months.indexOf(m)][field] += 1;
  };

  const totals: InsightsResult['totals'] = {
    enquiries: 0, enquiriesPrev: 0, convertedEnquiries: 0, leads: 0, leadsPrev: 0, sold: 0, revenue: 0,
    attributedEnquiries: 0, attributedByConversion: 0, attributedByMessage: 0,
  };
  const sourceTotals = new Map<string, { leads: number; enquiries: number }>();
  const bumpSource = (src: string, field: 'leads' | 'enquiries') => {
    const row = sourceTotals.get(src) ?? { leads: 0, enquiries: 0 };
    row[field] += 1;
    sourceTotals.set(src, row);
  };

  for (const lead of leads) {
    const groups = index.groupsOf(lead.preferred_project);
    const labels = groups.length > 0 ? groups : [UNSPECIFIED];
    const current = inRange(lead.created_at, range);
    const previous = !!prevRange && inRange(lead.created_at, prevRange);
    const isSold = lead.status === 'sold';
    const src = sourceKey(lead.lead_source);

    if (current) {
      totals.leads += 1;
      if (isSold) { totals.sold += 1; totals.revenue += lead.sale_amount ?? 0; }
      bumpSource(src, 'leads');
    }
    if (previous) totals.leadsPrev += 1;

    for (const label of labels) {
      const s = statsFor(label);
      addTrend(s, lead.created_at, 'leads');
      if (previous) s.leadsPrev += 1;
      if (!current) continue;
      s.leads += 1;
      bump(s.leadSources, src);
      bump(s.statuses, lead.status);
      if (lead.lead_grade) bump(s.grades, lead.lead_grade);
      if (isSold) { s.sold += 1; s.revenue += lead.sale_amount ?? 0; }
    }
  }

  for (const enq of enquiries) {
    const converted = enq.converted_lead_id ? leadById.get(enq.converted_lead_id) : undefined;
    const viaLead = converted ? index.groupsOf(converted.preferred_project) : [];
    const viaMessage = viaLead.length > 0 ? [] : index.detectIn(enq.message);
    const groups = viaLead.length > 0 ? viaLead : viaMessage;
    const labels = groups.length > 0 ? groups : [UNSPECIFIED];
    const current = inRange(enq.created_at, range);
    const previous = !!prevRange && inRange(enq.created_at, prevRange);
    const isConverted = !!enq.converted_lead_id;
    const src = sourceKey(enq.source);

    if (current) {
      totals.enquiries += 1;
      if (isConverted) totals.convertedEnquiries += 1;
      if (viaLead.length > 0) { totals.attributedEnquiries += 1; totals.attributedByConversion += 1; }
      else if (viaMessage.length > 0) { totals.attributedEnquiries += 1; totals.attributedByMessage += 1; }
      bumpSource(src, 'enquiries');
    }
    if (previous) totals.enquiriesPrev += 1;

    for (const label of labels) {
      const s = statsFor(label);
      addTrend(s, enq.created_at, 'enquiries');
      if (previous) s.enquiriesPrev += 1;
      if (!current) continue;
      s.enquiries += 1;
      if (isConverted) s.convertedEnquiries += 1;
      bump(s.enquirySources, src);
    }
  }

  // Only projects with activity in the selected or previous period — a
  // project last enquired about two years ago isn't noise worth a row.
  const projects = Array.from(byLabel.values())
    .filter((s) => s.leads + s.enquiries + s.leadsPrev + s.enquiriesPrev > 0)
    .sort((a, b) => (b.leads + b.enquiries) - (a.leads + a.enquiries) || a.label.localeCompare(b.label));

  const sources = Array.from(sourceTotals, ([source, v]) => ({ source, ...v }))
    .sort((a, b) => (b.leads + b.enquiries) - (a.leads + a.enquiries));

  return { projects, totals, sources, index };
}

/** Percentage change, or null when there's no baseline to compare with. */
export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function ratio(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Entries of a count map, largest first. */
export function topEntries(m: Map<string, number>, limit = Infinity): [string, number][] {
  return Array.from(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

/** Distinct sources (leads + enquiries) a project drew from. */
export function sourceCount(s: ProjectStats): number {
  return new Set([...s.leadSources.keys(), ...s.enquirySources.keys()].filter((k) => k !== NO_SOURCE)).size;
}

/** The source that brought the most leads + enquiries to a project. */
export function topSource(s: ProjectStats): string | null {
  const merged = new Map(s.leadSources);
  s.enquirySources.forEach((n, k) => bump(merged, k, n));
  merged.delete(NO_SOURCE);
  return topEntries(merged, 1)[0]?.[0] ?? null;
}
