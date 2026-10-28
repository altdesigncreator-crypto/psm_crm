import { buildProjectIndex, countProjects, type ProjectIndex } from '@/lib/projectNames';
import { soldDateOf } from '@/lib/soldDate';

/** Per-project demand analysis — enquiries, leads, sources, conversion —
 * as pure functions over already-loaded rows, so the page stays a thin
 * view and the numbers can be reasoned about (and tested) in isolation.
 *
 * Attribution rules, in order of trust:
 *   Leads      → their preferred_project, folded into project groups.
 *   Enquiries  → (1) the project of the lead they were converted into;
 *                (2) otherwise the Preferred project picked on the enquiry;
 *                (3) otherwise a project named in the enquiry's message;
 *                (4) otherwise "unattributed" — counted in totals, never
 *                    guessed into a project.
 * A row naming several projects counts once toward each of them, so
 * per-project figures can sum to more than the overall total. */

export interface InsightLead {
  id: string;
  name: string;
  phone: string | null;
  owner_id: string | null;
  preferred_project: string | null;
  lead_source: string | null;
  status: string;
  lead_grade: string | null;
  sale_amount: number | null;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
}

export interface InsightEnquiry {
  id: string;
  enquiry_no: string;
  name: string;
  phone: string | null;
  assigned_to: string | null;
  source: string | null;
  preferred_project: string | null;
  message: string | null;
  status: string;
  converted_lead_id: string | null;
  created_at: string;
}

// name/phone/owner columns are only for listing the records behind a
// number (the drill-down) — the analysis itself never reads them.
export const LEAD_COLUMNS = 'id,name,phone,owner_id,preferred_project,lead_source,status,lead_grade,sale_amount,created_at,updated_at,sold_at';
export const ENQUIRY_COLUMNS = 'id,enquiry_no,name,phone,assigned_to,source,preferred_project,message,status,converted_lead_id,created_at';

/** Sentinel group for leads with no project / unmatched enquiries. */
export const UNSPECIFIED = '__unspecified__';
/** Sentinel source for rows with no source recorded. */
export const NO_SOURCE = '__no_source__';

export type DateRange = { gte: string; lt: string } | null;

export type EnquiryAttribution = { labels: string[]; via: 'lead' | 'project' | 'message' | null };

/** Which project(s) an enquiry is about — the single rule shared by the
 * Project Insights page and the Enquiries page's Project filter, so the
 * two can never disagree. The converted lead's project wins (a Shwe Padauk
 * enquiry that became an Orchard lead is an Orchard enquiry), then the
 * project picked on the enquiry, then one named in the message;
 * unattributed enquiries get UNSPECIFIED. */
export function attributeEnquiry(
  enq: { message?: string | null; preferred_project?: string | null; converted_lead_id?: string | null },
  projectOfLead: (leadId: string) => string | null | undefined,
  index: ProjectIndex,
): EnquiryAttribution {
  if (enq.converted_lead_id) {
    const viaLead = index.groupsOf(projectOfLead(enq.converted_lead_id));
    if (viaLead.length > 0) return { labels: viaLead, via: 'lead' };
  }
  const picked = enq.preferred_project?.trim();
  if (picked) {
    // Fold into the same group its leads use ("The Century Condo" joins the
    // leads typed "The Century Condo "); a project with no leads yet keeps
    // its own name.
    const groups = index.groupsOf(picked);
    const labels = groups.length > 0 ? groups : index.detectIn(picked);
    return { labels: labels.length > 0 ? labels : [picked], via: 'project' };
  }
  const viaMessage = index.detectIn(enq.message);
  if (viaMessage.length > 0) return { labels: viaMessage, via: 'message' };
  return { labels: [UNSPECIFIED], via: null };
}

/** Why an enquiry counted in the period has no matching lead in the same
 * project and period. */
export type EnquiryOnlyReason =
  | 'open'            // not converted yet — still pending/accepted
  | 'closedNoLead'    // completed without ever becoming a lead
  | 'leadOtherPeriod' // converted, but the lead was created outside the period
  | 'leadNoProject'   // converted into a lead with no preferred project
  | 'leadHidden'      // converted into a lead the viewer can't see
  | 'duplicate';      // a second enquiry converted into the same lead

/** Why a lead counted in the period has no matching enquiry in the same
 * project and period. */
export type LeadOnlyReason =
  | 'noEnquiry'           // added directly, or its enquiry isn't visible
  | 'enquiryOtherPeriod'  // its enquiry arrived outside the period
  | 'enquiryOtherProject'; // its enquiry is counted under another project

/** Display order: most common and most actionable first. */
export const ENQUIRY_ONLY_REASONS: EnquiryOnlyReason[] = ['open', 'closedNoLead', 'leadOtherPeriod', 'leadNoProject', 'duplicate', 'leadHidden'];
export const LEAD_ONLY_REASONS: LeadOnlyReason[] = ['noEnquiry', 'enquiryOtherPeriod', 'enquiryOtherProject'];

/** How an enquiry count and a lead count relate. The two are counted
 * independently — enquiries by when they arrived, leads by when they were
 * created — so they rarely match. This splits both into the customers they
 * share and the reasons each side has extra. Every counted record lands in
 * exactly one bucket, so by construction:
 *   enquiries = shared + duplicate + Σ other enquiryOnly
 *   leads     = shared + Σ leadOnly */
export interface Reconciliation {
  /** Leads in the period created from an enquiry counted alongside them. */
  shared: number;
  enquiryOnly: Record<EnquiryOnlyReason, number>;
  leadOnly: Record<LeadOnlyReason, number>;
  /** The records behind every number above, so each one can be opened:
   * lead ids for `shared` and `leadOnly`, enquiry ids for `enquiryOnly`. */
  members: {
    shared: string[];
    enquiryOnly: Record<EnquiryOnlyReason, string[]>;
    leadOnly: Record<LeadOnlyReason, string[]>;
  };
}

const emptyReconciliation = (): Reconciliation => ({
  shared: 0,
  enquiryOnly: { open: 0, closedNoLead: 0, leadOtherPeriod: 0, leadNoProject: 0, leadHidden: 0, duplicate: 0 },
  leadOnly: { noEnquiry: 0, enquiryOtherPeriod: 0, enquiryOtherProject: 0 },
  members: {
    shared: [],
    enquiryOnly: { open: [], closedNoLead: [], leadOtherPeriod: [], leadNoProject: [], leadHidden: [], duplicate: [] },
    leadOnly: { noEnquiry: [], enquiryOtherPeriod: [], enquiryOtherProject: [] },
  },
});

export const sumValues = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

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
  /** Why `enquiries` and `leads` differ for this project. */
  reconciliation: Reconciliation;
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
    attributedByProject: number;
    attributedByMessage: number;
  };
  /** Every source seen in the period, most used first (leads + enquiries). */
  sources: { source: string; leads: number; enquiries: number }[];
  /** Why totals.enquiries and totals.leads differ, across all projects. */
  reconciliation: Reconciliation;
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
  const leadProject = new Map(leads.map((l) => [l.id, l.preferred_project]));
  const projectOfLead = (id: string) => leadProject.get(id);
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
        reconciliation: emptyReconciliation(),
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
    attributedEnquiries: 0, attributedByConversion: 0, attributedByProject: 0, attributedByMessage: 0,
  };
  const sourceTotals = new Map<string, { leads: number; enquiries: number }>();
  const bumpSource = (src: string, field: 'leads' | 'enquiries') => {
    const row = sourceTotals.get(src) ?? { leads: 0, enquiries: 0 };
    row[field] += 1;
    sourceTotals.set(src, row);
  };

  // Reconciliation state. `leadInfo` is every lead visible to the viewer;
  // `sharedLeads` holds, per project, the leads already paired with one of
  // its enquiries (ALL is the cross-project total).
  const ALL = '\u0000all';
  const totalRecon = emptyReconciliation();
  const reconFor = (label: string) => (label === ALL ? totalRecon : statsFor(label).reconciliation);
  const leadInfo = new Map<string, { labels: string[]; current: boolean }>();
  const sharedLeads = new Map<string, Set<string>>();
  const sharedFor = (label: string) => {
    let s = sharedLeads.get(label);
    if (!s) sharedLeads.set(label, (s = new Set()));
    return s;
  };
  const leadsWithEnquiry = new Set<string>();
  const leadsWithCurrentEnquiry = new Set<string>();

  /** One counted enquiry, seen from one project (or ALL). The order of the
   * checks matters: each enquiry must land in exactly one bucket. */
  const classifyEnquiry = (enq: InsightEnquiry, label: string) => {
    const r = reconFor(label);
    const place = (reason: EnquiryOnlyReason) => { r.enquiryOnly[reason] += 1; r.members.enquiryOnly[reason].push(enq.id); };
    if (!enq.converted_lead_id) {
      place(enq.status === 'completed' ? 'closedNoLead' : 'open');
      return;
    }
    const lead = leadInfo.get(enq.converted_lead_id);
    if (!lead) place('leadHidden');
    else if (label !== ALL && !lead.labels.includes(label)) place('leadNoProject');
    else if (!lead.current) place('leadOtherPeriod');
    else {
      const shared = sharedFor(label);
      if (shared.has(enq.converted_lead_id)) place('duplicate');
      else shared.add(enq.converted_lead_id);
    }
  };

  /** One counted lead, seen from one project (or ALL). Runs after every
   * enquiry has been classified, so `sharedFor` is complete. */
  const classifyLead = (leadId: string, label: string) => {
    const r = reconFor(label);
    const place = (reason: LeadOnlyReason) => { r.leadOnly[reason] += 1; r.members.leadOnly[reason].push(leadId); };
    if (sharedFor(label).has(leadId)) return; // tallied from sharedLeads below
    if (leadsWithCurrentEnquiry.has(leadId)) place('enquiryOtherProject');
    else if (leadsWithEnquiry.has(leadId)) place('enquiryOtherPeriod');
    else place('noEnquiry');
  };

  for (const lead of leads) {
    const groups = index.groupsOf(lead.preferred_project);
    const labels = groups.length > 0 ? groups : [UNSPECIFIED];
    const current = inRange(lead.created_at, range);
    leadInfo.set(lead.id, { labels, current });
    const previous = !!prevRange && inRange(lead.created_at, prevRange);
    // A sale counts in the period it was sold in, not when its lead was added.
    const soldDate = soldDateOf(lead);
    const soldNow = soldDate !== null && inRange(soldDate, range);
    const revenue = Number(lead.sale_amount) || 0;
    const src = sourceKey(lead.lead_source);

    if (current) {
      totals.leads += 1;
      bumpSource(src, 'leads');
    }
    if (soldNow) { totals.sold += 1; totals.revenue += revenue; }
    if (previous) totals.leadsPrev += 1;

    for (const label of labels) {
      const s = statsFor(label);
      addTrend(s, lead.created_at, 'leads');
      if (previous) s.leadsPrev += 1;
      if (soldNow) { s.sold += 1; s.revenue += revenue; }
      if (!current) continue;
      s.leads += 1;
      bump(s.leadSources, src);
      bump(s.statuses, lead.status);
      if (lead.lead_grade) bump(s.grades, lead.lead_grade);
    }
  }

  for (const enq of enquiries) {
    const { labels, via } = attributeEnquiry(enq, projectOfLead, index);
    const current = inRange(enq.created_at, range);
    const previous = !!prevRange && inRange(enq.created_at, prevRange);
    const isConverted = !!enq.converted_lead_id;
    const src = sourceKey(enq.source);

    if (enq.converted_lead_id) {
      leadsWithEnquiry.add(enq.converted_lead_id);
      if (current) leadsWithCurrentEnquiry.add(enq.converted_lead_id);
    }

    if (current) {
      totals.enquiries += 1;
      if (isConverted) totals.convertedEnquiries += 1;
      if (via === 'lead') { totals.attributedEnquiries += 1; totals.attributedByConversion += 1; }
      else if (via === 'project') { totals.attributedEnquiries += 1; totals.attributedByProject += 1; }
      else if (via === 'message') { totals.attributedEnquiries += 1; totals.attributedByMessage += 1; }
      bumpSource(src, 'enquiries');
      classifyEnquiry(enq, ALL);
      labels.forEach((label) => classifyEnquiry(enq, label));
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

  for (const [leadId, { labels, current }] of leadInfo) {
    if (!current) continue;
    classifyLead(leadId, ALL);
    labels.forEach((label) => classifyLead(leadId, label));
  }
  for (const [label, ids] of sharedLeads) {
    const r = reconFor(label);
    r.shared = ids.size;
    r.members.shared = Array.from(ids);
  }

  // Only projects with activity in the selected or previous period — a
  // project last enquired about two years ago isn't noise worth a row.
  const projects = Array.from(byLabel.values())
    .filter((s) => s.leads + s.enquiries + s.leadsPrev + s.enquiriesPrev + s.sold > 0)
    .sort((a, b) => (b.leads + b.enquiries) - (a.leads + a.enquiries) || a.label.localeCompare(b.label));

  const sources = Array.from(sourceTotals, ([source, v]) => ({ source, ...v }))
    .sort((a, b) => (b.leads + b.enquiries) - (a.leads + a.enquiries));

  return { projects, totals, sources, reconciliation: totalRecon, index };
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
