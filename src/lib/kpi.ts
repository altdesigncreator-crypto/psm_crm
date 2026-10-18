import type { Lead, Team, TeamMember } from '@/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { soldDateOf } from '@/lib/soldDate';

/** Only what the KPI Board needs — the board loads every lead, so this
 * keeps the payload a fraction of select('*'). */
const KPI_LEAD_COLUMNS = 'id,owner_id,department_code,team_id,status,created_at,updated_at,sold_at,sale_amount,commission_rate,commission_amount';
/** Columns that exist before the sale-commission migration. */
const LEGACY_KPI_LEAD_COLUMNS = 'id,owner_id,department_code,team_id,status,created_at,updated_at,sale_amount';

/** Postgres undefined_column — the DB schema is older than this frontend. */
const isMissingColumn = (e: unknown) => (e as { code?: string } | null)?.code === '42703';

/**
 * Loads every lead the KPI Board needs. If the database hasn't had the
 * sale-commission migration yet (frontend deployed first), falls back to
 * the legacy columns so leads / deals / sales value still report correctly
 * and only company income is unavailable — instead of the whole board
 * failing. Any other error is rethrown for the caller to surface.
 */
export async function fetchKpiLeads(): Promise<{ rows: KpiLead[]; commissionTracking: boolean }> {
  try {
    return { rows: await fetchAllRows<KpiLead>('leads', 20_000, KPI_LEAD_COLUMNS), commissionTracking: true };
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    console.warn('[KPI] Sale-commission columns missing; apply supabase/migrations/20261018120000_lead_sale_commission.sql', e);
    return { rows: await fetchAllRows<KpiLead>('leads', 20_000, LEGACY_KPI_LEAD_COLUMNS), commissionTracking: false };
  }
}

export type KpiLead = Pick<
  Lead,
  'id' | 'owner_id' | 'department_code' | 'team_id' | 'status' | 'created_at' | 'updated_at' | 'sold_at' | 'sale_amount' | 'commission_rate' | 'commission_amount'
>;

/** Team bucket for leads that can't be credited to any team. */
export const NO_TEAM = '__no_team__';

/** Maps a lead to the team it's credited to (a team id, or NO_TEAM). */
export type TeamResolver = (l: KpiLead) => string;

/**
 * Team attribution: the lead's own team_id when set (chosen at creation).
 * Otherwise — older leads predate teams — the owner's team, but only when
 * the owner belongs to exactly one team (as member or manager), so nothing
 * is guessed. Everything else lands in NO_TEAM, visibly, never dropped.
 */
export function makeTeamResolver(
  teams: Pick<Team, 'id' | 'manager_id'>[],
  members: Pick<TeamMember, 'team_id' | 'sale_person_id'>[],
): TeamResolver {
  const teamsOfPerson = new Map<string, Set<string>>();
  const add = (personId: string | null, teamId: string) => {
    if (!personId) return;
    const set = teamsOfPerson.get(personId) ?? new Set<string>();
    set.add(teamId);
    teamsOfPerson.set(personId, set);
  };
  for (const t of teams) add(t.manager_id, t.id);
  for (const m of members) add(m.sale_person_id, m.team_id);

  return (l) => {
    if (l.team_id) return l.team_id;
    const own = l.owner_id ? teamsOfPerson.get(l.owner_id) : undefined;
    return own?.size === 1 ? own.values().next().value! : NO_TEAM;
  };
}

export interface KpiTotals {
  /** New leads received in the period (by created_at). */
  leads: number;
  /** Leads sold in the period (by sold_at). */
  sold: number;
  /** sold ÷ leads, or null when there were no new leads to convert. */
  conversionRate: number | null;
  /** Total sale value (MMK) of deals closed in the period. */
  salesValue: number;
  /** Company commission income (MMK) from deals closed in the period. */
  companyIncome: number;
  /** Deals closed in the period with no commission recorded (sold before
   * commission capture existed) — their income is missing from companyIncome. */
  missingCommission: number;
}

export interface AgentKpi extends KpiTotals { id: string }
export interface DeptKpi extends KpiTotals { department: string; agentCount: number }
/** teamId is a team id or NO_TEAM. agentCount = owners active in the period. */
export interface TeamKpi extends KpiTotals { teamId: string; agentCount: number }

export interface KpiScope {
  /** Department code, or null for all. */
  department?: string | null;
  /** Team id / NO_TEAM, or null for all. Requires teamOf. */
  team?: string | null;
  /** Enables the per-team breakdown. */
  teamOf?: TeamResolver;
}

export type KpiRankBy = 'income' | 'conversion' | 'sold';

interface Accumulator { leads: number; sold: number; salesValue: number; companyIncome: number; missingCommission: number }

const emptyAcc = (): Accumulator => ({ leads: 0, sold: 0, salesValue: 0, companyIncome: 0, missingCommission: 0 });

const finalize = (a: Accumulator): KpiTotals => ({ ...a, conversionRate: a.leads > 0 ? a.sold / a.leads : null });


/** Supabase returns numeric columns as numbers, but coerce defensively so
 * a stray string never turns a sum into concatenation. */
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0);

/**
 * Event-based KPIs for one period: a lead counts toward the period it was
 * created in, a sale toward the period it closed in — so a deal closed in
 * October on a July lead is October's income. Leads and sales are credited
 * to the lead's current owner, and to the team scope.teamOf resolves.
 *
 * Scoping mirrors the board's drill-down: department cards always cover
 * every lead (so you can switch department), team cards cover the selected
 * department (so you can switch team), and totals + agents cover both.
 */
export function buildKpis(
  leads: KpiLead[],
  inPeriod: (iso: string) => boolean,
  scope: KpiScope = {},
): { totals: KpiTotals; departments: DeptKpi[]; teams: TeamKpi[]; agents: AgentKpi[] } {
  const { department = null, team = null, teamOf } = scope;
  const total = emptyAcc();
  const byDept = new Map<string, { acc: Accumulator; agents: Set<string> }>();
  const byTeam = new Map<string, { acc: Accumulator; agents: Set<string> }>();
  const byAgent = new Map<string, Accumulator>();

  const group = (map: Map<string, { acc: Accumulator; agents: Set<string> }>, key: string, ownerId: string | null | undefined) => {
    const g = map.get(key) ?? { acc: emptyAcc(), agents: new Set<string>() };
    map.set(key, g);
    if (ownerId) g.agents.add(ownerId);
    return g.acc;
  };

  for (const l of leads) {
    const isNew = inPeriod(l.created_at);
    const soldDate = soldDateOf(l);
    const isClosed = soldDate !== null && inPeriod(soldDate);
    if (!isNew && !isClosed) continue;

    const targets = [group(byDept, l.department_code, l.owner_id)];
    const inDept = !department || l.department_code === department;
    const teamId = inDept && teamOf ? teamOf(l) : null;
    if (teamId) targets.push(group(byTeam, teamId, l.owner_id));
    if (inDept && (!team || teamId === team)) {
      targets.push(total);
      if (l.owner_id) {
        const agent = byAgent.get(l.owner_id) ?? emptyAcc();
        byAgent.set(l.owner_id, agent);
        targets.push(agent);
      }
    }
    accumulate(targets, l, isNew, isClosed);
  }

  return {
    totals: finalize(total),
    departments: [...byDept.entries()]
      .map(([dept, { acc, agents }]) => ({ department: dept, agentCount: agents.size, ...finalize(acc) }))
      .sort((a, b) => a.department.localeCompare(b.department)),
    teams: [...byTeam.entries()].map(([teamId, { acc, agents }]) => ({ teamId, agentCount: agents.size, ...finalize(acc) })),
    agents: [...byAgent.entries()].map(([id, acc]) => ({ id, ...finalize(acc) })),
  };
}

function accumulate(targets: Accumulator[], l: KpiLead, isNew: boolean, isClosed: boolean) {
  for (const acc of targets) {
    if (isNew) acc.leads += 1;
    if (isClosed) {
      acc.sold += 1;
      acc.salesValue += num(l.sale_amount);
      if (l.commission_amount == null) acc.missingCommission += 1;
      else acc.companyIncome += num(l.commission_amount);
    }
  }
}

export type RelativePeriod = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';

/** Predicate for a period relative to `now`, in the viewer's local time —
 * the same calendar semantics as usePeriodFilter. */
export function relativePeriodMatcher(period: RelativePeriod, now = new Date()): (iso: string) => boolean {
  if (period === 'all') return () => true;
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastMonthYear = month === 0 ? year - 1 : year;
  const lastMonth = month === 0 ? 11 : month - 1;
  return (iso: string) => {
    const d = new Date(iso);
    if (period === 'thisYear') return d.getFullYear() === year;
    if (period === 'thisMonth') return d.getFullYear() === year && d.getMonth() === month;
    return d.getFullYear() === lastMonthYear && d.getMonth() === lastMonth;
  };
}

const conv = (k: KpiTotals) => k.conversionRate ?? -1;

const TIEBREAKERS: Record<KpiRankBy, ((a: KpiTotals, b: KpiTotals) => number)[]> = {
  income: [(a, b) => b.companyIncome - a.companyIncome, (a, b) => b.sold - a.sold, (a, b) => conv(b) - conv(a)],
  conversion: [(a, b) => conv(b) - conv(a), (a, b) => b.sold - a.sold, (a, b) => b.companyIncome - a.companyIncome],
  sold: [(a, b) => b.sold - a.sold, (a, b) => b.companyIncome - a.companyIncome, (a, b) => conv(b) - conv(a)],
};

/** The value an agent is ranked on, for scaling leaderboard bars. */
export function rankValue(k: KpiTotals, rankBy: KpiRankBy): number {
  if (rankBy === 'income') return k.companyIncome;
  if (rankBy === 'sold') return k.sold;
  return k.conversionRate ?? 0;
}

/** Leaderboard order for the chosen metric, with the other two metrics
 * then lead volume as tie-breakers so the order is always deterministic. */
export function rankAgents<T extends KpiTotals>(agents: T[], rankBy: KpiRankBy, nameOf: (a: T) => string): T[] {
  const chain = TIEBREAKERS[rankBy];
  return [...agents].sort((a, b) => {
    for (const cmp of chain) {
      const d = cmp(a, b);
      if (d !== 0) return d;
    }
    return (b.leads - a.leads) || nameOf(a).localeCompare(nameOf(b));
  });
}
