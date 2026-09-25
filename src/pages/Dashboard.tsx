import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import {
  Chart as ChartJS, ArcElement, Tooltip as ChartTooltip, Legend as ChartLegend,
  LineElement, PointElement, Filler, CategoryScale, LinearScale,
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import {
  Users, PhoneCall, Trophy, Activity, Clock, ArrowUpRight,
  ChevronRight, Download, FileSpreadsheet, FileText as FileTextIcon, File as FilePdf,
  CheckCircle2, Percent, PieChart, BarChart3, Star, ArrowUp, ArrowDown, CalendarDays, Calendar, Crown, Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LEAD_STAGES, type Lead } from '@/types';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { useTeams } from '@/hooks/useTeams';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { enumLabel } from '@/lib/translations';
import { canAssignEnquiry, type CurrentUser } from '@/lib/permissions';
import StatusColorDialog from '@/components/StatusColorDialog';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import NameLink from '@/components/NameLink';
import { exportAsExcel, exportAsPDF, exportAsHTML } from '@/lib/exportUtils';
import { toast } from 'sonner';
import { cacheGet, cacheSetDebounced } from '@/lib/localCache';
import { fetchAllRows } from '@/lib/fetchAllRows';

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const dashboardCacheKey = (userId: string) => `dashboard-leads:${userId}`;

ChartJS.register(ArcElement, ChartTooltip, ChartLegend, LineElement, PointElement, Filler, CategoryScale, LinearScale);

const PIE_COLORS = [
  'hsl(208, 96%, 43%)', 'hsl(173, 58%, 39%)', 'hsl(197, 37%, 24%)', 'hsl(43, 74%, 66%)', 'hsl(280, 60%, 55%)',
  'hsl(15, 75%, 55%)', 'hsl(340, 65%, 55%)', 'hsl(120, 40%, 45%)',
];
// Chart stays readable past this many slices — everything beyond the
// biggest MAX_TEAM_SLICES - 1 teams gets folded into a single "Other"
// slice instead of silently disappearing off a hard-coded top-5 cutoff.
const MAX_TEAM_SLICES = PIE_COLORS.length;

type DateFilter = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'levelA';

/** Keyed off translation keys rather than plain strings so both filter
 * pill rows re-render in the active language instead of staying English. */
const FILTER_LABEL_KEYS: Record<DateFilter, string> = {
  all: 'filter.all', thisMonth: 'filter.thisMonth', lastMonth: 'filter.lastMonth', thisYear: 'filter.thisYear', levelA: 'filter.gradeAOnly',
};

const TEAM_PERIOD_OPTIONS: DateFilter[] = ['thisMonth', 'lastMonth', 'thisYear'];

type AgentPeriod = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';

const AGENT_PERIOD_LABEL_KEYS: Record<AgentPeriod, string> = {
  all: 'filter.allTime', thisMonth: 'filter.thisMonth', lastMonth: 'filter.lastMonth', thisYear: 'filter.thisYear',
};

function filterLeadsByDate(leads: Lead[], filter: DateFilter | AgentPeriod): Lead[] {
  if (filter === 'levelA') return leads.filter((l) => l.lead_grade === 'A');
  if (filter === 'all') return leads;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return leads.filter((l) => {
    const d = new Date(l.created_at);
    const y = d.getFullYear();
    const m = d.getMonth();
    if (filter === 'thisYear') return y === currentYear;
    if (filter === 'thisMonth') return y === currentYear && m === currentMonth;
    if (filter === 'lastMonth') {
      const targetYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const targetMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      return y === targetYear && m === targetMonth;
    }
    return true;
  });
}

function metricsFor(leads: Lead[]) {
  const total = leads.length;
  const followUp = leads.filter((l) => ['contacted', 'qualified', 'negotiation'].includes(l.status)).length;
  const sold = leads.filter((l) => l.status === 'sold').length;
  const gradeA = leads.filter((l) => l.lead_grade === 'A').length;
  const conversion = total > 0 ? Math.round((sold / total) * 1000) / 10 : 0;
  return { total, followUp, sold, gradeA, conversion };
}

/** vs-last-month delta, always computed off the real calendar month
 * regardless of whichever filter pill is currently selected — a 0 base
 * shows as +100%/0% instead of a meaningless Infinity. */
function pctDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** Daily counts for the last N days, bucketed by created_at — used only for
 * the small trend sparklines in each KPI card. Since the app doesn't record
 * historical status-change timestamps, this approximates "trend" from
 * creation date rather than literal day-the-status-changed, which is fine
 * for a decorative trend line. */
function dailyCounts(leads: Lead[], predicate: (l: Lead) => boolean, days = 7): number[] {
  const buckets = Array.from({ length: days }, () => 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const l of leads) {
    if (!predicate(l)) continue;
    const d = new Date(l.created_at); d.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diff >= 0 && diff < days) buckets[days - 1 - diff] += 1;
  }
  return buckets;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = {
    labels: data.map((_, i) => i),
    datasets: [{
      data, borderColor: color, backgroundColor: `${color}20`, fill: true,
      borderWidth: 2, tension: 0.4, pointRadius: 0,
    }],
  };
  const options = {
    responsive: true, maintainAspectRatio: false,
    scales: { x: { display: false }, y: { display: false } },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
  };
  return <div className="h-7 w-12 sm:h-8 sm:w-16 shrink-0"><Line data={chartData} options={options} /></div>;
}

function TrendLine({ delta }: { delta: number }) {
  const { t } = useTranslation();
  const positive = delta >= 0;
  return (
    <p className="text-[10px] md:text-[11px] text-muted-foreground flex items-center gap-0.5 md:gap-1 shrink-0 min-w-0">
      {positive ? <ArrowUp className="w-3 h-3 text-emerald-500 shrink-0" /> : <ArrowDown className="w-3 h-3 text-destructive shrink-0" />}
      <span className={`font-semibold ${positive ? 'text-emerald-600' : 'text-destructive'}`}>{Math.abs(delta)}%</span>
      <span className="truncate hidden md:inline">{t('dashboard.vsLastMonth')}</span>
    </p>
  );
}

const RANK_CROWN_STYLES: Record<number, string> = {
  1: 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white',
  2: 'bg-gradient-to-br from-slate-300 to-slate-400 text-white',
  3: 'bg-gradient-to-br from-amber-600 to-amber-700 text-white',
};

function RankBadge({ rank }: { rank: number }) {
  const crownClass = RANK_CROWN_STYLES[rank];
  if (crownClass) {
    return (
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm ${crownClass}`}>
        <Crown className="w-3.5 h-3.5" fill="currentColor" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{rank}</div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { t, lang } = useTranslation();
  const currentUser: CurrentUser | null = user ? { id: user.id, role, department } : null;
  const canAssignEnq = canAssignEnquiry(currentUser);
  const cachedLeads = user ? cacheGet<Lead[]>(dashboardCacheKey(user.id), DASHBOARD_CACHE_TTL_MS) : undefined;
  const [rawLeads, setRawLeads] = useState<Lead[]>(cachedLeads ?? []);
  const [loading, setLoading] = useState(cachedLeads === undefined);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [agentPeriod, setAgentPeriod] = useState<AgentPeriod>('thisMonth');
  const { colors: statusColors, saveColors } = useStatusColors();
  const { teams } = useTeams();
  const { nameOf, byId } = useProfiles();
  const today = useMemo(() => new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const writeCache = (list: Lead[]) => { cacheSetDebounced(dashboardCacheKey(user.id), list); return list; };
    const load = async () => {
      try {
        const rows = await fetchAllRows<Lead>('leads');
        if (!active) return;
        setRawLeads(writeCache(rows));
      } catch {
        if (active) toast.error(t('dashboard.loadError'));
      }
      if (active) setLoading(false);
    };
    load();
    const channel = supabase
      .channel('dashboard-leads')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setRawLeads((prev) => writeCache(prev.some((l) => l.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setRawLeads((prev) => writeCache(prev.map((l) => (l.id === row.id ? row : l))));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setRawLeads((prev) => writeCache(prev.filter((l) => l.id !== oldId)));
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  // Just a count, not the full row set the Enquiries page needs — this tile
  // only ever shows "how many need action right now," so a head-only count
  // query is enough and avoids pulling every enquiry's data onto Dashboard.
  const [pendingEnquiryCount, setPendingEnquiryCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const fetchCount = async () => {
      let query = supabase.from('enquiries').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (!canAssignEnq) query = query.eq('assigned_to', user.id);
      const { count } = await query;
      if (active) setPendingEnquiryCount(count || 0);
    };
    fetchCount();
    const channel = supabase
      .channel('dashboard-enquiries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, fetchCount)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id, canAssignEnq]);

  const filteredLeads = useMemo(() => filterLeadsByDate(rawLeads, dateFilter), [rawLeads, dateFilter]);

  const totalLeads = filteredLeads.length;
  const followUpCount = filteredLeads.filter((l) => ['contacted', 'qualified', 'negotiation'].includes(l.status)).length;
  const soldLeads = filteredLeads.filter((l) => l.status === 'sold');
  const soldCount = soldLeads.length;
  const levelACount = filteredLeads.filter((l) => l.lead_grade === 'A').length;
  const conversionRate = totalLeads > 0 ? Math.round((soldCount / totalLeads) * 1000) / 10 : 0;

  // Deltas and sparklines are always anchored to the real calendar month —
  // independent of whichever filter pill is currently selected above — so
  // "vs last month" stays meaningful even while viewing e.g. "This Year".
  const thisMonthMetrics = useMemo(() => metricsFor(filterLeadsByDate(rawLeads, 'thisMonth')), [rawLeads]);
  const lastMonthMetrics = useMemo(() => metricsFor(filterLeadsByDate(rawLeads, 'lastMonth')), [rawLeads]);
  const deltas = {
    total: pctDelta(thisMonthMetrics.total, lastMonthMetrics.total),
    followUp: pctDelta(thisMonthMetrics.followUp, lastMonthMetrics.followUp),
    gradeA: pctDelta(thisMonthMetrics.gradeA, lastMonthMetrics.gradeA),
    sold: pctDelta(thisMonthMetrics.sold, lastMonthMetrics.sold),
    conversion: pctDelta(thisMonthMetrics.conversion, lastMonthMetrics.conversion),
  };
  const sparklines = useMemo(() => ({
    total: dailyCounts(rawLeads, () => true),
    followUp: dailyCounts(rawLeads, (l) => ['contacted', 'qualified', 'negotiation'].includes(l.status)),
    gradeA: dailyCounts(rawLeads, (l) => l.lead_grade === 'A'),
    sold: dailyCounts(rawLeads, (l) => l.status === 'sold'),
    conversion: dailyCounts(rawLeads, (l) => l.status === 'sold'),
  }), [rawLeads]);

  const statusCounts = LEAD_STAGES.map((s) => filteredLeads.filter((l) => l.status === s.value).length);

  const topTeams = useMemo(() => {
    const teamName = new Map(teams.map((team) => [team.id, team.name]));
    const counts: Record<string, number> = {};
    filteredLeads.forEach((l) => {
      const label = (l.team_id && teamName.get(l.team_id)) || t('dashboard.unassignedTeam');
      counts[label] = (counts[label] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length <= MAX_TEAM_SLICES) return sorted;
    const top = sorted.slice(0, MAX_TEAM_SLICES - 1);
    const otherCount = sorted.slice(MAX_TEAM_SLICES - 1).reduce((sum, [, c]) => sum + c, 0);
    return [...top, [t('dashboard.otherTeams'), otherCount] as [string, number]];
  }, [filteredLeads, teams, t]);

  const pieData = {
    labels: topTeams.map((t) => t[0]),
    datasets: [{ data: topTeams.map((t) => t[1]), backgroundColor: PIE_COLORS, borderWidth: 2, borderColor: '#ffffff' }],
  };

  const pieOptions = {
    responsive: true, maintainAspectRatio: false, cutout: '72%',
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: 'rgba(10,37,64,0.92)', padding: 12, cornerRadius: 10, displayColors: true, titleFont: { size: 13, weight: 'bold' as const }, bodyFont: { size: 12 }, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 },
    },
    interaction: { mode: 'nearest' as const, intersect: true },
  };

  const agentPeriodLeads = useMemo(() => filterLeadsByDate(rawLeads, agentPeriod), [rawLeads, agentPeriod]);
  const agentPerformance = useMemo(() => {
    const agents: Record<string, { name: string; count: number }> = {};
    for (const l of agentPeriodLeads) {
      if (l.status !== 'sold' || !l.owner_id) continue;
      if (!agents[l.owner_id]) agents[l.owner_id] = { name: nameOf(l.owner_id), count: 0 };
      agents[l.owner_id].count += 1;
    }
    const sorted = Object.entries(agents).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    const max = sorted[0]?.[1].count || 1;
    return sorted.map(([id, { name, count }]) => ({ id, name, count, pct: Math.round((count / max) * 100), avatarUrl: byId[id]?.avatar_url || null }));
  }, [agentPeriodLeads, nameOf, byId]);

  const activityFeed = useMemo(() => [...filteredLeads].slice(0, 5), [filteredLeads]);

  const exportableLeads = filteredLeads.map((l) => ({ ...l, owner_name: nameOf(l.owner_id) }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl md:text-[26px] font-bold text-foreground tracking-tight leading-tight">
              {t('dashboard.welcomeBack')}, {user?.name || t('dashboard.thereFallback')} <span aria-hidden="true">👋</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={filteredLeads.length === 0} size="icon" className="lg:hidden h-9 w-9 gradient-primary hover:gradient-primary-hover text-white shrink-0" aria-label={t('common.export')}>
                <Download className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-lg border-border p-1">
              <DropdownMenuItem onClick={() => exportAsExcel(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FileSpreadsheet className="w-5 h-5 shrink-0" /> <span>{t('common.exportAsExcel')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsPDF(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FilePdf className="w-5 h-5 shrink-0" /> <span>{t('common.exportAsPdf')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsHTML(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FileTextIcon className="w-5 h-5 shrink-0" /> <span>{t('common.exportAsHtml')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0 pb-1 lg:pb-0">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground whitespace-nowrap shrink-0">
            <CalendarDays className="w-3.5 h-3.5" /> {today}
          </span>
          {(Object.keys(FILTER_LABEL_KEYS) as DateFilter[]).map((key) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0 ${
                dateFilter === key ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
            >
              {t(FILTER_LABEL_KEYS[key])}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={filteredLeads.length === 0} className="hidden lg:inline-flex h-9 gradient-primary hover:gradient-primary-hover text-white text-sm font-medium gap-2 px-3 shrink-0">
                <Download className="w-4 h-4" /> {t('common.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-lg border-border p-1">
              <DropdownMenuItem onClick={() => exportAsExcel(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FileSpreadsheet className="w-5 h-5 shrink-0" /> <span>{t('common.exportAsExcel')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsPDF(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FilePdf className="w-5 h-5 shrink-0" /> <span>{t('common.exportAsPdf')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsHTML(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FileTextIcon className="w-5 h-5 shrink-0" /> <span>{t('common.exportAsHtml')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* KPI Cards — each links through to the Leads list pre-filtered to
          match, so a count is never a dead end. */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 sm:gap-3">
        <Card
          role="button" tabIndex={0}
          onClick={() => navigate('/enquiries')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/enquiries'); }}
          className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 cursor-pointer active:scale-[0.98]"
        >
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <div className="w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-sky-500/15 to-sky-500/5 flex items-center justify-center shrink-0"><Inbox className="w-3.5 h-3.5 md:w-4 md:h-4 text-sky-600" /></div>
              <p className="text-[11px] md:text-xs font-medium text-muted-foreground truncate">{t('dashboard.pendingEnquiries')}</p>
            </div>
            <p className="text-lg md:text-2xl font-bold text-foreground tabular-nums truncate">{pendingEnquiryCount.toLocaleString()}</p>
            <p className="text-[10px] md:text-[11px] text-muted-foreground mt-1.5 md:mt-2 truncate">{t('dashboard.pendingEnquiriesCaption')}</p>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => navigate('/leads')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/leads'); }}
          className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 cursor-pointer active:scale-[0.98]"
        >
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <div className="w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shrink-0"><Users className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" /></div>
              <p className="text-[11px] md:text-xs font-medium text-muted-foreground truncate">{t('dashboard.totalLeads')}</p>
            </div>
            <p className="text-lg md:text-2xl font-bold text-foreground tabular-nums truncate">{totalLeads.toLocaleString()}</p>
            <div className="flex items-center justify-between gap-2 mt-1.5 md:mt-2">
              <TrendLine delta={deltas.total} />
              <Sparkline data={sparklines.total} color="#0463CA" />
            </div>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => navigate('/follow-ups')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/follow-ups'); }}
          className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 cursor-pointer active:scale-[0.98]"
        >
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <div className="w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-teal-500/15 to-teal-500/5 flex items-center justify-center shrink-0"><PhoneCall className="w-3.5 h-3.5 md:w-4 md:h-4 text-teal-600" /></div>
              <p className="text-[11px] md:text-xs font-medium text-muted-foreground truncate">{t('dashboard.followUp')}</p>
            </div>
            <p className="text-lg md:text-2xl font-bold text-foreground tabular-nums truncate">{followUpCount.toLocaleString()}</p>
            <div className="flex items-center justify-between gap-2 mt-1.5 md:mt-2">
              <TrendLine delta={deltas.followUp} />
              <Sparkline data={sparklines.followUp} color="#0D9488" />
            </div>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => navigate('/leads?grade=A')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/leads?grade=A'); }}
          className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 cursor-pointer active:scale-[0.98]"
        >
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <div className="w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-violet-500/15 to-violet-500/5 flex items-center justify-center shrink-0"><Star className="w-3.5 h-3.5 md:w-4 md:h-4 text-violet-500" /></div>
              <p className="text-[11px] md:text-xs font-medium text-muted-foreground truncate">{t('dashboard.gradeA')}</p>
            </div>
            <p className="text-lg md:text-2xl font-bold text-foreground tabular-nums truncate">{levelACount.toLocaleString()}</p>
            <div className="flex items-center justify-between gap-2 mt-1.5 md:mt-2">
              <TrendLine delta={deltas.gradeA} />
              <Sparkline data={sparklines.gradeA} color="#8B5CF6" />
            </div>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => navigate('/leads?status=sold')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/leads?status=sold'); }}
          className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 cursor-pointer active:scale-[0.98]"
        >
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <div className="w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-500" /></div>
              <p className="text-[11px] md:text-xs font-medium text-muted-foreground truncate">{t('stage.sold')}</p>
            </div>
            <p className="text-lg md:text-2xl font-bold text-foreground tabular-nums truncate">{soldCount.toLocaleString()}</p>
            <div className="flex items-center justify-between gap-2 mt-1.5 md:mt-2">
              <TrendLine delta={deltas.sold} />
              <Sparkline data={sparklines.sold} color="#059669" />
            </div>
          </CardContent>
        </Card>
        <Card
          role="button" tabIndex={0}
          onClick={() => navigate('/kpi-board')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/kpi-board'); }}
          className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 relative overflow-hidden cursor-pointer active:scale-[0.98]"
        >
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-bl-full pointer-events-none" />
          <CardContent className="p-3 md:p-4 relative">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <div className="w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-500/5 flex items-center justify-center shrink-0"><Percent className="w-3.5 h-3.5 md:w-4 md:h-4 text-amber-500" /></div>
              <p className="text-[11px] md:text-xs font-medium text-muted-foreground truncate">{t('dashboard.conversionRate')}</p>
            </div>
            <p className="text-lg md:text-2xl font-bold text-foreground tabular-nums truncate">{conversionRate}%</p>
            <div className="flex items-center justify-between gap-2 mt-1.5 md:mt-2">
              <TrendLine delta={deltas.conversion} />
              <Sparkline data={sparklines.conversion} color="#F59E0B" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><PieChart className="w-4 h-4 text-primary" /></div>
                <h3 className="text-base font-semibold">{t('dashboard.leadsByTeam')}</h3>
              </div>
              <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-0.5">
                {TEAM_PERIOD_OPTIONS.map((key) => (
                  <button
                    key={key}
                    onClick={() => setDateFilter(key)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                      dateFilter === key ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(FILTER_LABEL_KEYS[key])}
                  </button>
                ))}
              </div>
            </div>
            {topTeams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <PieChart className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{t('dashboard.noLeadsPeriod')}</p>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="relative w-44 h-44 shrink-0">
                  <Doughnut data={pieData} options={pieOptions} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
                    <p className="text-2xl font-bold text-foreground tabular-nums leading-tight">{totalLeads.toLocaleString()}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">{t('dashboard.totalLeads')}</p>
                  </div>
                </div>
                <div className="flex-1 w-full space-y-3 min-w-0">
                  {topTeams.map(([name, count], i) => (
                    <div key={name} className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                      <span className="text-sm text-foreground truncate flex-1 min-w-0">{name}</span>
                      <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">{count.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right shrink-0">{totalLeads > 0 ? ((count / totalLeads) * 100).toFixed(1) : '0.0'}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-primary" /></div>
                <h3 className="text-base font-semibold whitespace-nowrap">{t('analytics.leadsByStatus')}</h3>
              </div>
              <StatusColorDialog colors={statusColors} onSave={saveColors} />
            </div>
            <div className="space-y-3">
              {LEAD_STAGES.map((s, i) => {
                const count = statusCounts[i];
                const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
                const color = statusColors[s.value] || '#0463CA';
                return (
                  <div key={s.value} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-muted-foreground w-[88px] shrink-0 truncate">{enumLabel('stage', s.value, s.label, lang)}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-xs font-semibold text-foreground tabular-nums w-10 text-right shrink-0">{count.toLocaleString()}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-12 text-right shrink-0">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Trophy className="w-4 h-4 text-primary" /></div>
                <h3 className="text-base font-semibold whitespace-nowrap">{t('analytics.agentPerformance')}</h3>
              </div>
              <Select value={agentPeriod} onValueChange={(v) => setAgentPeriod(v as AgentPeriod)}>
                <SelectTrigger className="h-8 w-[124px] text-xs rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(AGENT_PERIOD_LABEL_KEYS) as AgentPeriod[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">{t(AGENT_PERIOD_LABEL_KEYS[k])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {agentPerformance.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Trophy className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{t('dashboard.noSalesPeriod')}</p>
              </div>
            ) : (
              <div className="space-y-5">
                {agentPerformance.map((agent, idx) => (
                  <div key={agent.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <RankBadge rank={idx + 1} />
                        <NameLink id={agent.id} name={agent.name} avatarUrl={agent.avatarUrl} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-primary tabular-nums">{agent.count} {t('dashboard.soldSuffix')}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                      </div>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${agent.pct}%`, background: 'linear-gradient(90deg, #0463CA 0%, #0487E2 100%)' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Activity className="w-4 h-4 text-primary" /></div>
                <h3 className="text-base font-semibold">{t('dashboard.recentActivity')}</h3>
              </div>
              <button type="button" onClick={() => navigate('/leads')} className="text-xs font-medium text-primary hover:underline shrink-0">{t('common.viewAll')}</button>
            </div>
            {activityFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{t('dashboard.noActivity')}</p>
              </div>
            ) : (
              <div className="space-y-0">
                {activityFeed.map((lead, idx) => {
                  const timeStr = new Date(lead.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  const isLast = idx === activityFeed.length - 1;
                  const ownerNode = lead.owner_id ? <NameLink id={lead.owner_id} name={nameOf(lead.owner_id)} showAvatar={false} /> : t('dashboard.someone');
                  return (
                    <div key={lead.id} className={`flex gap-4 py-3 ${!isLast ? 'border-b border-border' : ''}`}>
                      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                        {!isLast && <div className="w-px flex-1 bg-border min-h-[20px]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground leading-snug">
                          {/* Burmese is verb-final (SOV), so the sentence order flips
                              relative to English rather than just swapping words in
                              place — "X added a lead for Y" becomes "X ... Y ... [verb]". */}
                          {lang === 'mm' ? (
                            <>{ownerNode} — <span className="text-primary">{lead.name}</span> {t('dashboard.addedLeadForSuffix')}</>
                          ) : (
                            <>{ownerNode} added a new lead for <span className="text-primary">{lead.name}</span></>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                          <Calendar className="w-3 h-3" /> {timeStr}
                          <ChevronRight className="w-3 h-3 mx-0.5" />
                          <LeadLevelBadge grade={lead.lead_grade} />
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border"
                            style={{ backgroundColor: `${statusColors[lead.status] || '#8FA3BF'}20`, color: statusColors[lead.status] || '#8FA3BF', borderColor: `${statusColors[lead.status] || '#8FA3BF'}40` }}
                          >
                            {enumLabel('stage', lead.status, LEAD_STAGES.find((s) => s.value === lead.status)?.label || lead.status, lang)}
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
