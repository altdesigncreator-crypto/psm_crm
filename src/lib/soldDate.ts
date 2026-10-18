/**
 * The one rule for *when* a sale happened, shared by every screen that
 * counts sales (Dashboard, KPI Board, Analytics, Project Insights) so they
 * can never disagree: a sale belongs to the period it was sold in — never
 * the period its lead was added in.
 *
 * sold_at is stamped by the database when a lead enters Sold (and was
 * backfilled for older sales). updated_at is only a fallback for rows read
 * from a cache written before that column existed.
 */
export function soldDateOf(lead: { status: string; sold_at?: string | null; updated_at?: string | null; created_at: string }): string | null {
  if (lead.status !== 'sold') return null;
  return lead.sold_at ?? lead.updated_at ?? lead.created_at;
}

/** Leads sold within a period, by sold date. */
export function soldIn<T extends Parameters<typeof soldDateOf>[0]>(leads: T[], inPeriod: (iso: string) => boolean): T[] {
  return leads.filter((l) => {
    const d = soldDateOf(l);
    return d !== null && inPeriod(d);
  });
}
