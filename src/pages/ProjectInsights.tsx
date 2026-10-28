import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend,
  type ActiveElement, type ChartEvent, type ChartOptions,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import {
  ArrowLeft, ArrowDownRight, ArrowUpRight, ArrowUpDown, Building2, ChevronRight, FileSpreadsheet, Inbox,
  Info, Layers, Minus, RefreshCw, Scale, Search, Sparkles, Target, Users, Wifi, ExternalLink, Trophy,
} from 'lucide-react';
import { supabase } from '@/db/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PeriodFilterBar from '@/components/PeriodFilterBar';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useProfiles';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePeriodFilter, type Period } from '@/hooks/usePeriodFilter';
import { canAccessRoute, isAdminOrAbove } from '@/lib/permissions';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { enumLabel } from '@/lib/translations';
import { LEAD_STAGES } from '@/types';
import {
  computeProjectInsights, pctDelta, ratio, sourceCount, topEntries, topSource,
  ENQUIRY_COLUMNS, ENQUIRY_ONLY_REASONS, LEAD_COLUMNS, LEAD_ONLY_REASONS, NO_SOURCE, UNSPECIFIED,
  type DateRange, type EnquiryOnlyReason, type InsightEnquiry, type InsightLead, type LeadOnlyReason, type ProjectStats, type Reconciliation,
} from '@/lib/projectInsights';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

/* Series colours — categorical slots 1 & 2 (blue, orange), stepped per
 * theme and validated for colour-blind separation and contrast against
 * both surfaces. Enquiries are always blue and leads always orange, on
 * every chart on this page. */
const SERIES = {
  light: { enquiries: '#2a78d6', leads: '#eb6834', grid: 'rgba(0,0,0,0.06)', tick: '#6b7280' },
  dark: { enquiries: '#3987e5', leads: '#d95926', grid: 'rgba(255,255,255,0.08)', tick: '#9ca3af' },
};

type SortKey = 'project' | 'enquiries' | 'leads' | 'conversion' | 'sold' | 'revenue' | 'sources' | 'growth';
type SourceMode = 'leads' | 'enquiries';
type ReconView = 'projects' | 'overall';

/** Tracks the app's class-based dark mode, so charts (which take literal
 * colours, not CSS tokens) re-render when the theme is toggled. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** The period immediately before the selected one, for "vs previous"
 * deltas. "Overall" has nothing before it. */
function previousRange(period: Period, month: number, year: number): DateRange {
  if (period === 'overall') return null;
  if (period === 'yearly') return { gte: new Date(year - 1, 0, 1).toISOString(), lt: new Date(year, 0, 1).toISOString() };
  return { gte: new Date(year, month - 1, 1).toISOString(), lt: new Date(year, month, 1).toISOString() };
}

const growthOf = (p: ProjectStats) => pctDelta(p.leads + p.enquiries, p.leadsPrev + p.enquiriesPrev);

function monthShort(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export default function ProjectInsights() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { t, lang } = useTranslation();
  const isDark = useIsDark();
  const palette = isDark ? SERIES.dark : SERIES.light;
  usePageHeader(t('projects.pageTitle'), t('projects.subtitle'));

  const allowed = canAccessRoute(role, 'project-insights');
  const { period, setPeriod, selectedMonth, selectedYear, isCurrentPeriod, shiftPeriod, periodLabel, periodRange } = usePeriodFilter();

  const [leads, setLeads] = useState<InsightLead[]>([]);
  const [enquiries, setEnquiries] = useState<InsightEnquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('leads');
  const [sortAsc, setSortAsc] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('leads');
  const [reconView, setReconView] = useState<ReconView>('projects');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  /* ── data ─────────────────────────────────────────────────────────── */

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      // Two narrow, paged reads (past PostgREST's 1000-row cap) — only the
      // columns the analysis needs, not whole rows.
      const [leadRows, enquiryRows] = await Promise.all([
        fetchAllRows<InsightLead>('leads', 50_000, LEAD_COLUMNS),
        fetchAllRows<InsightEnquiry>('enquiries', 50_000, ENQUIRY_COLUMNS),
      ]);
      setLeads(leadRows);
      setEnquiries(enquiryRows);
    } catch {
      toast.error(t('projects.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  // Realtime just invalidates: any change to leads or enquiries schedules
  // one debounced reload, so a bulk import doesn't trigger hundreds.
  const reloadTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    load();
    const schedule = () => {
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => load(), 1500);
    };
    const channel = supabase
      .channel('project-insights')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, schedule)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      window.clearTimeout(reloadTimer.current);
      supabase.removeChannel(channel);
    };
  }, [allowed, load]);

  /* ── analysis ─────────────────────────────────────────────────────── */

  const insights = useMemo(
    () => computeProjectInsights(leads, enquiries, periodRange(), previousRange(period, selectedMonth, selectedYear)),
    [leads, enquiries, periodRange, period, selectedMonth, selectedYear],
  );
  const { totals } = insights;
  const hasPrev = period !== 'overall';
  // Below admin, RLS shows a manager their teams' leads but only their own
  // enquiries — so "added directly" overstates, and the panel says why.
  const enquiriesScopedToSelf = !isAdminOrAbove(role);

  const labelOf = useCallback((label: string) => (label === UNSPECIFIED ? t('projects.unspecified') : label), [t]);
  const sourceLabel = useCallback((s: string) => (s === NO_SOURCE ? t('projects.noSource') : s), [t]);
  const stageLabel = useCallback((s: string) => enumLabel('stage', s, LEAD_STAGES.find((x) => x.value === s)?.label ?? s, lang), [lang]);
  const enquiryStatusLabel = useCallback((s: string) => enumLabel('enquiryStatus', s, s, lang), [lang]);

  /* ── drill-down: the records behind a reconciliation number ────────── */

  const { nameOf } = useProfiles();
  const [openedBucket, setOpenedBucket] = useState<OpenedBucket | null>(null);
  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const enquiriesById = useMemo(() => new Map(enquiries.map((e) => [e.id, e])), [enquiries]);
  // The earliest enquiry converted into each lead — the one it came from.
  const enquiryOfLead = useMemo(() => {
    const m = new Map<string, InsightEnquiry>();
    for (const e of [...enquiries].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
      if (e.converted_lead_id && !m.has(e.converted_lead_id)) m.set(e.converted_lead_id, e);
    }
    return m;
  }, [enquiries]);
  const openLead = useCallback((id: string) => navigate(`/lead/${id}`), [navigate]);
  const openEnquiry = useCallback((no: string) => navigate(`/enquiries?${new URLSearchParams({ q: no })}`), [navigate]);

  // Real projects only (no "unspecified" bucket) for rankings and charts.
  const named = useMemo(() => insights.projects.filter((p) => p.label !== UNSPECIFIED && p.leads + p.enquiries > 0), [insights.projects]);
  const unspecified = insights.projects.find((p) => p.label === UNSPECIFIED);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = insights.projects.filter((p) => {
      if (!q) return true;
      return labelOf(p.label).toLowerCase().includes(q) || p.variants.some((v) => v.toLowerCase().includes(q));
    });
    const value = (p: ProjectStats): number | string => {
      switch (sortKey) {
        case 'project': return labelOf(p.label).toLowerCase();
        case 'enquiries': return p.enquiries;
        case 'leads': return p.leads;
        case 'conversion': return ratio(p.convertedEnquiries, p.enquiries);
        case 'sold': return p.sold;
        case 'revenue': return p.revenue;
        case 'sources': return sourceCount(p);
        case 'growth': return growthOf(p) ?? Number.NEGATIVE_INFINITY;
      }
    };
    const dir = sortAsc ? 1 : -1;
    return rows.sort((a, b) => {
      // "Unspecified" always sinks to the bottom — it's a data-quality
      // bucket, not a project competing for rank.
      if (a.label === UNSPECIFIED) return 1;
      if (b.label === UNSPECIFIED) return -1;
      const va = value(a), vb = value(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return (b.leads + b.enquiries) - (a.leads + a.enquiries);
    });
  }, [insights.projects, search, sortKey, sortAsc, labelOf]);

  const selected = useMemo(() => insights.projects.find((p) => p.label === selectedLabel) ?? null, [insights.projects, selectedLabel]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === 'project'); }
  };

  /* ── headline insight ─────────────────────────────────────────────── */

  const insight = useMemo(() => {
    if (named.length === 0) return t('projects.insightEmpty');
    const byLeads = [...named].sort((a, b) => b.leads - a.leads)[0];
    const byEnq = [...named].sort((a, b) => b.enquiries - a.enquiries)[0];
    const parts = [t('projects.insightTopLeads').replace('{project}', byLeads.label).replace('{n}', String(byLeads.leads))];
    if (byEnq.enquiries > 0 && byEnq.label !== byLeads.label) {
      parts.push(t('projects.insightTopEnquiries').replace('{project}', byEnq.label).replace('{n}', String(byEnq.enquiries)));
    }
    const topSrc = insights.sources.find((s) => s.source !== NO_SOURCE);
    if (topSrc) parts.push(t('projects.insightTopSource').replace('{source}', topSrc.source));
    if (hasPrev) {
      const rising = named
        .filter((p) => p.leads + p.enquiries >= 3)
        .map((p) => ({ p, g: growthOf(p) }))
        .filter((x): x is { p: ProjectStats; g: number } => x.g !== null && x.g > 0)
        .sort((a, b) => b.g - a.g)[0];
      if (rising) parts.push(t('projects.insightRising').replace('{project}', rising.p.label).replace('{pct}', String(rising.g)));
    }
    return parts.join(' ');
  }, [named, insights.sources, hasPrev, t]);

  /* ── export ───────────────────────────────────────────────────────── */

  const handleExport = () => {
    try {
      const wb = XLSX.utils.book_new();
      const projectSheet = tableRows.map((p) => ({
        [t('projects.colProject')]: labelOf(p.label),
        [t('projects.colEnquiries')]: p.enquiries,
        [t('projects.colLeads')]: p.leads,
        [t('projects.colConverted')]: p.convertedEnquiries,
        [t('projects.colConversion')]: `${ratio(p.convertedEnquiries, p.enquiries)}%`,
        [t('projects.colSold')]: p.sold,
        [t('projects.colSoldRate')]: `${ratio(p.sold, p.leads)}%`,
        [t('projects.colRevenue')]: p.revenue,
        [t('projects.colSources')]: sourceCount(p),
        [t('projects.colTopSource')]: topSource(p) ?? '',
        ...(hasPrev ? { [t('projects.colGrowth')]: growthOf(p) === null ? 'new' : `${growthOf(p)}%` } : {}),
        [t('projects.colSpellings')]: p.variants.join(' | '),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projectSheet), 'Projects');

      const reconSheet = tableRows.map((p) => ({
        [t('projects.colProject')]: labelOf(p.label),
        [t('projects.colEnquiries')]: p.enquiries,
        [t('projects.colLeads')]: p.leads,
        [t('projects.recon.shared')]: p.reconciliation.shared,
        ...Object.fromEntries(ENQUIRY_ONLY_REASONS.map((k) => [`${t('projects.recon.onlyEnquiries')}: ${t(`projects.recon.${k}`)}`, p.reconciliation.enquiryOnly[k]])),
        ...Object.fromEntries(LEAD_ONLY_REASONS.map((k) => [`${t('projects.recon.onlyLeads')}: ${t(`projects.recon.${k}`)}`, p.reconciliation.leadOnly[k]])),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reconSheet), 'Enquiries vs leads');

      const matrix: Record<string, string | number>[] = [];
      for (const p of tableRows) {
        for (const [src, n] of topEntries(p.leadSources)) matrix.push({ Project: labelOf(p.label), Type: 'Lead', Source: sourceLabel(src), Count: n });
        for (const [src, n] of topEntries(p.enquirySources)) matrix.push({ Project: labelOf(p.label), Type: 'Enquiry', Source: sourceLabel(src), Count: n });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrix), 'Sources by project');
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(insights.sources.map((s) => ({ Source: sourceLabel(s.source), Leads: s.leads, Enquiries: s.enquiries }))),
        'Sources',
      );
      XLSX.writeFile(wb, `project-insights-${periodLabel.replace(/\s+/g, '-').toLowerCase()}.xlsx`);
      toast.success(t('analytics.exportCompleteToast'));
    } catch {
      toast.error(t('analytics.exportFailedToast'));
    }
  };

  /* ── render ───────────────────────────────────────────────────────── */

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">{t('projects.restricted')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-4 h-4 mr-2" />{t('kpiBoard.backToDashboard')}</Button>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  const attributedPct = ratio(totals.attributedEnquiries, totals.enquiries);

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full mr-auto ${live ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          <Wifi className="w-3 h-3" /> {live ? t('analytics.live') : t('analytics.connecting')}
        </span>
        <Button variant="outline" className="h-11 gap-2" onClick={() => load(true)} disabled={refreshing} aria-label={t('projects.refresh')}>
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{t('projects.refresh')}</span>
        </Button>
        <Button variant="outline" className="h-11 gap-2" onClick={handleExport} disabled={insights.projects.length === 0}>
          <FileSpreadsheet className="w-4 h-4 text-success" /><span className="hidden sm:inline">Excel</span>
        </Button>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-3">
          <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-primary" /></div>
          <p className="text-sm text-foreground leading-relaxed pt-1.5">{insight}</p>
        </CardContent>
      </Card>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        <KpiTile icon={<Building2 className="w-4 h-4 text-primary" />} tone="bg-primary/10" label={t('projects.kpiProjects')} value={named.length.toLocaleString()} />
        <KpiTile icon={<Inbox className="w-4 h-4 text-info" />} tone="bg-info/10" label={t('projects.kpiEnquiries')} value={totals.enquiries.toLocaleString()} delta={hasPrev ? pctDelta(totals.enquiries, totals.enquiriesPrev) : undefined} />
        <KpiTile icon={<Users className="w-4 h-4 text-warning" />} tone="bg-warning/10" label={t('projects.kpiLeads')} value={totals.leads.toLocaleString()} delta={hasPrev ? pctDelta(totals.leads, totals.leadsPrev) : undefined} />
        <KpiTile icon={<Target className="w-4 h-4 text-success" />} tone="bg-success/10" label={t('projects.kpiConversion')} value={`${ratio(totals.convertedEnquiries, totals.enquiries)}%`} hint={`${totals.convertedEnquiries}/${totals.enquiries}`} />
        <KpiTile icon={<Trophy className="w-4 h-4 text-success" />} tone="bg-success/10" label={t('projects.kpiSold')} value={totals.sold.toLocaleString()} hint={totals.revenue > 0 ? totals.revenue.toLocaleString() : undefined} />
        <KpiTile icon={<Layers className="w-4 h-4 text-primary" />} tone="bg-primary/10" label={t('projects.kpiSources')} value={insights.sources.filter((s) => s.source !== NO_SOURCE).length.toLocaleString()} />
      </div>

      {/* Why enquiries and leads differ — per project, or across all of them */}
      {(totals.enquiries > 0 || totals.leads > 0) && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Scale className="w-4 h-4 text-primary" /> {t('projects.recon.title')}</CardTitle>
            <Tabs value={reconView} onValueChange={(v) => setReconView(v as ReconView)}>
              <TabsList className="h-9">
                <TabsTrigger value="projects" className="text-xs">{t('projects.recon.byProject')}</TabsTrigger>
                <TabsTrigger value="overall" className="text-xs">{t('projects.recon.overall')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {reconView === 'projects' ? (
              <ReconciliationByProject projects={insights.projects} palette={palette} labelOf={labelOf} scopeNote={enquiriesScopedToSelf} onSelect={setSelectedLabel} onOpen={(project, bucket) => setOpenedBucket({ ...bucket, project })} t={t} />
            ) : (
              <ReconciliationPanel recon={insights.reconciliation} enquiries={totals.enquiries} leads={totals.leads} palette={palette} scopeNote={enquiriesScopedToSelf} onOpen={(bucket) => setOpenedBucket({ ...bucket, project: null })} t={t} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Enquiries vs leads per project */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> {t('projects.chartTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {named.length === 0 ? (
            <EmptyState text={t('projects.noData')} />
          ) : (
            <ProjectBarChart projects={named.slice(0, 12)} palette={palette} t={t} onSelect={setSelectedLabel} />
          )}
        </CardContent>
      </Card>

      {/* Source mix */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Layers className="w-4 h-4 text-primary" /> {t('projects.sourceMixTitle')}</CardTitle>
          <Tabs value={sourceMode} onValueChange={(v) => setSourceMode(v as SourceMode)}>
            <TabsList className="h-9">
              <TabsTrigger value="leads" className="text-xs">{t('projects.colLeads')}</TabsTrigger>
              <TabsTrigger value="enquiries" className="text-xs">{t('projects.colEnquiries')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <SourceMatrix projects={named} mode={sourceMode} sourceLabel={sourceLabel} emptyText={t('projects.noData')} otherLabel={t('projects.otherSources')} totalLabel={t('projects.total')} onSelect={setSelectedLabel} />
        </CardContent>
      </Card>

      {/* All projects */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> {t('projects.tableTitle')}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">({tableRows.length})</span>
          </CardTitle>
          <div className="relative sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('leads.filter.searchProjects')} className="h-10 pl-9" type="search" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tableRows.length === 0 ? (
            <div className="p-4"><EmptyState text={search ? t('leads.filter.noProjectMatch') : t('projects.noData')} /></div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-xs text-muted-foreground">
                      <SortHeader k="project" align="left" label={t('projects.colProject')} {...{ sortKey, sortAsc, toggleSort }} />
                      <SortHeader k="enquiries" label={t('projects.colEnquiries')} {...{ sortKey, sortAsc, toggleSort }} />
                      <SortHeader k="leads" label={t('projects.colLeads')} {...{ sortKey, sortAsc, toggleSort }} />
                      <SortHeader k="conversion" label={t('projects.colConversion')} {...{ sortKey, sortAsc, toggleSort }} />
                      <SortHeader k="sold" label={t('projects.colSold')} {...{ sortKey, sortAsc, toggleSort }} />
                      <SortHeader k="revenue" label={t('projects.colRevenue')} {...{ sortKey, sortAsc, toggleSort }} />
                      <SortHeader k="sources" label={t('projects.colSources')} {...{ sortKey, sortAsc, toggleSort }} />
                      <th className="px-3 py-2.5 text-left font-medium">{t('projects.colTopSource')}</th>
                      {hasPrev && <SortHeader k="growth" label={t('projects.colGrowth')} {...{ sortKey, sortAsc, toggleSort }} />}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tableRows.map((p) => (
                      <tr key={p.label} onClick={() => setSelectedLabel(p.label)} className="cursor-pointer hover:bg-muted/40 transition-colors">
                        <td className="px-3 py-3 max-w-[260px]">
                          <p className={`font-medium truncate ${p.label === UNSPECIFIED ? 'text-muted-foreground italic' : 'text-foreground'}`}>{labelOf(p.label)}</p>
                          {p.variants.length > 1 && <p className="text-[11px] text-muted-foreground">{t('projects.spellingsCount').replace('{n}', String(p.variants.length))}</p>}
                        </td>
                        <NumCell value={p.enquiries} />
                        <NumCell value={p.leads} />
                        <td className="px-3 py-3 text-right tabular-nums">{p.enquiries > 0 ? `${ratio(p.convertedEnquiries, p.enquiries)}%` : '—'}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{p.sold > 0 ? <>{p.sold} <span className="text-muted-foreground text-xs">({ratio(p.sold, p.leads)}%)</span></> : '—'}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{p.revenue > 0 ? p.revenue.toLocaleString() : '—'}</td>
                        <NumCell value={sourceCount(p)} />
                        <td className="px-3 py-3 text-muted-foreground truncate max-w-[180px]">{topSource(p) ?? '—'}</td>
                        {hasPrev && <td className="px-3 py-3 text-right"><DeltaBadge delta={growthOf(p)} /></td>}
                        <td className="pr-3"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone: one card per project, the four numbers that matter. */}
              <div className="md:hidden px-3 pb-3 space-y-2">
                <div className="flex items-center gap-2 pb-1 overflow-x-auto">
                  {(['leads', 'enquiries', 'conversion', 'sold', 'project'] as SortKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleSort(k)}
                      className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortKey === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                    >
                      {t(SORT_LABEL_KEYS[k])}{sortKey === k && <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
                {tableRows.map((p) => (
                  <button key={p.label} type="button" onClick={() => setSelectedLabel(p.label)} className="w-full text-left rounded-xl border border-border p-3 active:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-semibold truncate ${p.label === UNSPECIFIED ? 'text-muted-foreground italic' : 'text-foreground'}`}>{labelOf(p.label)}</p>
                      {hasPrev ? <DeltaBadge delta={growthOf(p)} /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2.5">
                      <MiniStat label={t('projects.colEnquiries')} value={p.enquiries} />
                      <MiniStat label={t('projects.colLeads')} value={p.leads} />
                      <MiniStat label={t('projects.colSold')} value={p.sold} />
                      <MiniStat label={t('projects.colSources')} value={sourceCount(p)} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Methodology — the numbers are only as trustworthy as people can see they are. */}
      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 px-1">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          {t('projects.methodology')
            .replace('{attributed}', String(totals.attributedEnquiries))
            .replace('{total}', String(totals.enquiries))
            .replace('{pct}', String(attributedPct))
            .replace('{viaLead}', String(totals.attributedByConversion))
            .replace('{viaProject}', String(totals.attributedByProject))
            .replace('{viaMessage}', String(totals.attributedByMessage))}
          {unspecified && unspecified.leads > 0 && ` ${t('projects.unspecifiedLeads').replace('{n}', String(unspecified.leads))}`}
        </span>
      </p>

      <ProjectDetailSheet
        project={selected}
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelectedLabel(null); }}
        palette={palette}
        hasPrev={hasPrev}
        periodLabel={period === 'overall' ? t('period.overall') : periodLabel}
        labelOf={labelOf}
        sourceLabel={sourceLabel}
        stageLabel={stageLabel}
        scopeNote={enquiriesScopedToSelf}
        onOpenBucket={(project, bucket) => setOpenedBucket({ ...bucket, project })}
        onViewLeads={(label, source) => navigate(`/leads?${new URLSearchParams({ project: label, ...(source ? { source } : {}), period, month: String(selectedMonth), year: String(selectedYear) })}`)}
        onViewEnquiries={(label) => navigate(`/enquiries?${new URLSearchParams({ project: label, period, month: String(selectedMonth), year: String(selectedYear) })}`)}
        t={t}
      />

      {/* Opens over the detail sheet when launched from it. */}
      <ReconRecordsDialog
        opened={openedBucket}
        onClose={() => setOpenedBucket(null)}
        leadsById={leadsById}
        enquiriesById={enquiriesById}
        enquiryOfLead={enquiryOfLead}
        nameOf={nameOf}
        labelOf={labelOf}
        stageLabel={stageLabel}
        enquiryStatusLabel={enquiryStatusLabel}
        periodLabel={period === 'overall' ? t('period.overall') : periodLabel}
        onOpenLead={openLead}
        onOpenEnquiry={openEnquiry}
        t={t}
      />
    </div>
  );
}

const SORT_LABEL_KEYS: Record<SortKey, string> = {
  project: 'projects.colProject', enquiries: 'projects.colEnquiries', leads: 'projects.colLeads',
  conversion: 'projects.colConversion', sold: 'projects.colSold', revenue: 'projects.colRevenue',
  sources: 'projects.colSources', growth: 'projects.colGrowth',
};

/* ───────────────────────── building blocks ───────────────────────── */

type T = (key: string) => string;
type Palette = typeof SERIES.light;

function KpiTile({ icon, tone, label, value, delta, hint }: { icon: ReactNode; tone: string; label: string; value: string; delta?: number | null; hint?: string }) {
  return (
    <Card className="shadow-card rounded-xl border-0 h-full">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>{icon}</div>
          <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
          {delta !== undefined && <DeltaBadge delta={delta} />}
        </div>
        {hint && <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Change vs the previous period. Direction is carried by the arrow icon
 * and sign, not by colour alone. */
function DeltaBadge({ delta }: { delta: number | null }) {
  const { t } = useTranslation();
  if (delta === null) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-info/10 text-info">{t('projects.new')}</span>;
  }
  if (delta === 0) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums"><Minus className="w-3 h-3" />0%</span>;
  }
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${up ? 'text-success' : 'text-destructive'}`}>
      <Icon className="w-3 h-3" />{up ? '+' : ''}{delta}%
    </span>
  );
}

function SortHeader({ k, label, align = 'right', sortKey, sortAsc, toggleSort }: { k: SortKey; label: string; align?: 'left' | 'right'; sortKey: SortKey; sortAsc: boolean; toggleSort: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-2.5 font-medium ${align === 'left' ? 'text-left' : 'text-right'}`} aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? 'text-foreground' : ''}`}>
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    </th>
  );
}

function NumCell({ value }: { value: number }) {
  return <td className={`px-3 py-3 text-right tabular-nums ${value === 0 ? 'text-muted-foreground' : 'text-foreground'}`}>{value === 0 ? '—' : value.toLocaleString()}</td>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-base font-bold text-foreground tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[10px] text-muted-foreground truncate">{label}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="h-40 flex items-center justify-center text-sm text-muted-foreground text-center px-4">{text}</div>;
}

/** Horizontal grouped bars — project names are long, so they read along
 * the y-axis instead of being rotated under an x-axis. Clicking a bar
 * opens that project's detail. */
function ProjectBarChart({ projects, palette, t, onSelect }: { projects: ProjectStats[]; palette: Palette; t: T; onSelect: (label: string) => void }) {
  const data = {
    labels: projects.map((p) => p.label),
    datasets: [
      { label: t('projects.colEnquiries'), data: projects.map((p) => p.enquiries), backgroundColor: palette.enquiries, borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.7 },
      { label: t('projects.colLeads'), data: projects.map((p) => p.leads), backgroundColor: palette.leads, borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.7 },
    ],
  };
  const options = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, axis: 'y' as const, intersect: false },
    plugins: {
      legend: { position: 'top' as const, align: 'end' as const, labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: palette.tick, font: { size: 11 } } },
    },
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0, color: palette.tick, font: { size: 10 } }, grid: { color: palette.grid }, border: { display: false } },
      y: {
        ticks: {
          color: palette.tick,
          font: { size: 11 },
          callback: (v: number | string) => {
            const s = projects[Number(v)]?.label ?? '';
            return s.length > 22 ? `${s.slice(0, 21)}…` : s;
          },
        },
        grid: { display: false },
        border: { display: false },
      },
    },
    onClick: (_e: ChartEvent, els: ActiveElement[]) => { if (els[0]) onSelect(projects[els[0].index].label); },
    onHover: (e: ChartEvent, els: ActiveElement[]) => {
      const el = e.native?.target as HTMLElement | null | undefined;
      if (el) el.style.cursor = els.length ? 'pointer' : 'default';
    },
  } satisfies ChartOptions<'bar'>;
  return <div style={{ height: Math.max(220, projects.length * 34 + 60) }}><Bar data={data} options={options} /></div>;
}

/** Project × source heatmap: which channels feed which projects. Shading
 * is one hue scaled by count (darker = more); every cell also shows its
 * number, so nothing relies on reading colour. */
function SourceMatrix({ projects, mode, sourceLabel, emptyText, otherLabel, totalLabel, onSelect }: {
  projects: ProjectStats[]; mode: SourceMode; sourceLabel: (s: string) => string; emptyText: string; otherLabel: string; totalLabel: string; onSelect: (label: string) => void;
}) {
  const MAX_SOURCES = 6;
  const MAX_PROJECTS = 10;
  const pick = (p: ProjectStats) => (mode === 'leads' ? p.leadSources : p.enquirySources);

  const { rows, columns, max } = useMemo(() => {
    const totals = new Map<string, number>();
    projects.forEach((p) => pick(p).forEach((n, s) => totals.set(s, (totals.get(s) ?? 0) + n)));
    const columns = topEntries(totals, MAX_SOURCES).map(([s]) => s);
    const hasOther = totals.size > columns.length;
    const rows = projects
      .filter((p) => pick(p).size > 0)
      .sort((a, b) => sum(pick(b)) - sum(pick(a)))
      .slice(0, MAX_PROJECTS)
      .map((p) => {
        const m = pick(p);
        const cells = columns.map((s) => m.get(s) ?? 0);
        const other = sum(m) - cells.reduce((a, b) => a + b, 0);
        return { label: p.label, cells: hasOther ? [...cells, other] : cells, total: sum(m) };
      });
    const max = Math.max(1, ...rows.flatMap((r) => r.cells));
    return { rows, columns: hasOther ? [...columns, '__other__'] : columns, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, mode]);

  if (rows.length === 0) return <EmptyState text={emptyText} />;

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-xs border-separate border-spacing-[3px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium p-1.5 min-w-[140px]" />
            {columns.map((c) => (
              <th key={c} className="font-medium p-1.5 text-center align-bottom min-w-[64px]">
                <span className="line-clamp-2 leading-tight">{c === '__other__' ? otherLabel : sourceLabel(c)}</span>
              </th>
            ))}
            <th className="font-semibold p-1.5 text-right text-foreground">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="text-left font-medium p-1.5 max-w-[180px]">
                <button type="button" onClick={() => onSelect(r.label)} className="truncate block max-w-full text-foreground hover:text-primary transition-colors">{r.label}</button>
              </th>
              {r.cells.map((n, i) => {
                const intensity = n === 0 ? 0 : 0.14 + 0.76 * (n / max);
                return (
                  <td
                    key={columns[i]}
                    title={`${r.label} · ${columns[i] === '__other__' ? otherLabel : sourceLabel(columns[i])}: ${n}`}
                    className={`rounded-md p-1.5 text-center tabular-nums font-medium ${n === 0 ? 'bg-muted/40 text-muted-foreground/60' : intensity > 0.5 ? 'text-white' : 'text-foreground'}`}
                    style={n === 0 ? undefined : { backgroundColor: `rgba(42, 120, 214, ${intensity.toFixed(2)})` }}
                  >
                    {n === 0 ? '·' : n}
                  </td>
                );
              })}
              <td className="p-1.5 text-right tabular-nums font-semibold text-foreground">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sum(m: Map<string, number>): number {
  let s = 0;
  m.forEach((n) => { s += n; });
  return s;
}

/** Everything about one project: headline numbers, 12-month trend, where
 * its leads and enquiries come from, where its leads sit in the
 * pipeline, and the raw spellings folded into it. */
function ProjectDetailSheet({ project, open, onOpenChange, palette, hasPrev, periodLabel, labelOf, sourceLabel, stageLabel, scopeNote, onOpenBucket, onViewLeads, onViewEnquiries, t }: {
  project: ProjectStats | null; open: boolean; onOpenChange: (o: boolean) => void; palette: Palette; hasPrev: boolean; periodLabel: string;
  labelOf: (l: string) => string; sourceLabel: (s: string) => string; stageLabel: (s: string) => string; scopeNote: boolean;
  onOpenBucket: (project: string, bucket: Bucket) => void;
  onViewLeads: (label: string, source?: string) => void; onViewEnquiries: (label: string) => void; t: T;
}) {
  const [tab, setTab] = useState<SourceMode>('leads');
  useEffect(() => { setTab('leads'); }, [project?.label]);
  if (!project) return null;

  const isUnspecified = project.label === UNSPECIFIED;
  const sources = topEntries(tab === 'leads' ? project.leadSources : project.enquirySources);
  const sourceMax = sources[0]?.[1] ?? 1;
  const stages = LEAD_STAGES.map((s) => [s.value, project.statuses.get(s.value) ?? 0] as const).filter(([, n]) => n > 0);
  const stageMax = Math.max(1, ...stages.map(([, n]) => n));
  const trendData = {
    labels: project.trend.map((p) => monthShort(p.month)),
    datasets: [
      { label: t('projects.colEnquiries'), data: project.trend.map((p) => p.enquiries), borderColor: palette.enquiries, backgroundColor: palette.enquiries, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3 },
      { label: t('projects.colLeads'), data: project.trend.map((p) => p.leads), borderColor: palette.leads, backgroundColor: palette.leads, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3 },
    ],
  };
  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { position: 'top' as const, align: 'end' as const, labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: palette.tick, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: palette.tick, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0, color: palette.tick, font: { size: 10 } }, grid: { color: palette.grid }, border: { display: false } },
    },
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 pr-6"><Building2 className="w-5 h-5 text-primary shrink-0" /><span className="truncate">{labelOf(project.label)}</span></SheetTitle>
          <SheetDescription>{periodLabel}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <DetailStat label={t('projects.colEnquiries')} value={project.enquiries} delta={hasPrev ? pctDelta(project.enquiries, project.enquiriesPrev) : undefined} swatch={palette.enquiries} />
            <DetailStat label={t('projects.colLeads')} value={project.leads} delta={hasPrev ? pctDelta(project.leads, project.leadsPrev) : undefined} swatch={palette.leads} />
            <DetailStat label={t('projects.colConversion')} value={`${ratio(project.convertedEnquiries, project.enquiries)}%`} hint={`${project.convertedEnquiries}/${project.enquiries}`} />
            <DetailStat label={t('projects.colSold')} value={project.sold} hint={project.revenue > 0 ? `${t('projects.colRevenue')}: ${project.revenue.toLocaleString()}` : `${ratio(project.sold, project.leads)}%`} />
          </div>

          {project.enquiries + project.leads > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2"><Scale className="w-4 h-4 text-primary" />{t('projects.recon.title')}</h3>
              <ReconciliationPanel recon={project.reconciliation} enquiries={project.enquiries} leads={project.leads} palette={palette} scopeNote={scopeNote} onOpen={(bucket) => onOpenBucket(project.label, bucket)} t={t} />
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t('projects.trend12mo')}</h3>
            <div className="h-48"><Line data={trendData} options={trendOptions} /></div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-foreground">{t('projects.sourcesTitle')}</h3>
              <Tabs value={tab} onValueChange={(v) => setTab(v as SourceMode)}>
                <TabsList className="h-8">
                  <TabsTrigger value="leads" className="text-xs px-2.5">{t('projects.colLeads')}</TabsTrigger>
                  <TabsTrigger value="enquiries" className="text-xs px-2.5">{t('projects.colEnquiries')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">{t('projects.noData')}</p>
            ) : (
              <div className="space-y-2.5">
                {/* A lead source opens the Leads list filtered to this
                    project + source, so every number here is one tap from
                    the records behind it. */}
                {sources.map(([src, n]) => (
                  <BarRow
                    key={src} label={sourceLabel(src)} value={n} max={sourceMax} color={tab === 'leads' ? palette.leads : palette.enquiries}
                    onClick={tab === 'leads' && !isUnspecified ? () => onViewLeads(project.label, src) : undefined}
                  />
                ))}
              </div>
            )}
          </section>

          {stages.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">{t('projects.pipelineTitle')}</h3>
              <div className="space-y-2.5">
                {stages.map(([s, n]) => <BarRow key={s} label={stageLabel(s)} value={n} max={stageMax} color={palette.leads} />)}
              </div>
              {project.grades.size > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {['A', 'B', 'C'].filter((g) => project.grades.has(g)).map((g) => (
                    <span key={g} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted text-foreground">
                      {t('leads.filter.gradePrefix')} {g} <span className="font-semibold tabular-nums">{project.grades.get(g)}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {project.variants.length > 1 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">{t('projects.spellingsTitle')}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {project.variants.map((v) => <li key={v} className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground max-w-full truncate">{v}</li>)}
              </ul>
            </section>
          )}

          {/* Both lists open pre-filtered with the same rules used here, so
              the counts on the other side match these exactly. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {project.enquiries > 0 && (
              <Button variant="outline" className="h-11 gap-2" onClick={() => onViewEnquiries(project.label)}>
                <Inbox className="w-4 h-4" /> {t('projects.viewEnquiries')}
              </Button>
            )}
            {!isUnspecified && project.leads > 0 && (
              <Button className="h-11 gap-2" onClick={() => onViewLeads(project.label)}>
                <ExternalLink className="w-4 h-4" /> {t('projects.viewLeads')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailStat({ label, value, delta, hint, swatch }: { label: string; value: number | string; delta?: number | null; hint?: string; swatch?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        {swatch && <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: swatch }} />}{label}
      </p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-xl font-bold text-foreground tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        {delta !== undefined && <DeltaBadge delta={delta} />}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground tabular-nums truncate">{hint}</p>}
    </div>
  );
}

function BarRow({ label, value, max, color, onClick }: { label: string; value: number; max: number; color: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs mb-1">
        <span className="text-foreground truncate">{label}</span>
        <span className="text-muted-foreground tabular-nums shrink-0 inline-flex items-center gap-0.5">
          {value}{onClick && <ChevronRight className="w-3 h-3" />}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, (value / max) * 100)}%`, backgroundColor: color }} />
      </div>
    </>
  );
  if (!onClick) return <div>{body}</div>;
  return (
    <button type="button" onClick={onClick} className="block w-[calc(100%+0.75rem)] text-left rounded-md -mx-1.5 px-1.5 py-1 hover:bg-muted/60 active:bg-muted transition-colors">
      {body}
    </button>
  );
}

/** One number on the reconciliation, ready to be opened. */
type BucketKey = 'shared' | EnquiryOnlyReason | LeadOnlyReason;
interface Bucket { key: BucketKey; kind: 'leads' | 'enquiries'; ids: string[] }
type OpenBucket = (bucket: Bucket) => void;

/** Every non-empty bucket of a reconciliation, in display order. */
function bucketsOf(r: Reconciliation): { enquiryOnly: Bucket[]; leadOnly: Bucket[]; shared: Bucket } {
  return {
    enquiryOnly: ENQUIRY_ONLY_REASONS.filter((k) => r.enquiryOnly[k] > 0).map((k) => ({ key: k, kind: 'enquiries', ids: r.members.enquiryOnly[k] })),
    leadOnly: LEAD_ONLY_REASONS.filter((k) => r.leadOnly[k] > 0).map((k) => ({ key: k, kind: 'leads', ids: r.members.leadOnly[k] })),
    shared: { key: 'shared', kind: 'leads', ids: r.members.shared },
  };
}

const bucketTitleKey = (key: BucketKey) => (key === 'shared' ? 'projects.recon.shared' : `projects.recon.${key}`);
const bucketHintKey = (key: BucketKey) => (key === 'shared' ? 'projects.recon.sharedHint' : `projects.recon.${key}Hint`);

/** Explains the gap between an enquiry count and a lead count. Two bars on
 * one scale: each starts with the customers both sides share (solid), then
 * what only that side has (striped), so the gap is visible at a glance.
 * Every bucket is itemised underneath with its count and cause, so nothing
 * depends on reading the bars or telling colours apart — and every count
 * opens the exact records behind it. */
function ReconciliationPanel({ recon, enquiries, leads, palette, scopeNote, onOpen, t }: {
  recon: Reconciliation; enquiries: number; leads: number; palette: Palette; scopeNote: boolean; onOpen: OpenBucket; t: T;
}) {
  const buckets = bucketsOf(recon);
  const enquiryRows = buckets.enquiryOnly;
  const leadRows = buckets.leadOnly;
  const matches = enquiryRows.length === 0 && leadRows.length === 0;
  const scale = Math.max(1, enquiries, leads);

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground leading-relaxed">
        {matches
          ? t('projects.recon.match')
          : t('projects.recon.summary').replace('{enquiries}', enquiries.toLocaleString()).replace('{leads}', leads.toLocaleString()).replace('{shared}', recon.shared.toLocaleString())}
      </p>

      <div className="space-y-2" role="img" aria-label={`${t('projects.colEnquiries')} ${enquiries}, ${t('projects.colLeads')} ${leads}, ${t('projects.recon.shared')} ${recon.shared}`}>
        <ReconBar label={t('projects.colEnquiries')} total={enquiries} shared={recon.shared} scale={scale} color={palette.enquiries} />
        <ReconBar label={t('projects.colLeads')} total={leads} shared={recon.shared} scale={scale} color={palette.leads} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-muted-foreground" />{t('projects.recon.shared')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm opacity-70" style={{ backgroundImage: stripes('hsl(var(--muted-foreground))') }} />{t('projects.recon.onlyEnquiries')} / {t('projects.recon.onlyLeads')}</span>
          {recon.shared > 0 && (
            <button type="button" onClick={() => onOpen(buckets.shared)} className="ml-auto inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
              {t('projects.recon.viewShared').replace('{n}', recon.shared.toLocaleString())}<ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {!matches && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ReconList title={t('projects.recon.onlyEnquiries')} extra={enquiries - recon.shared} rows={enquiryRows} color={palette.enquiries} onOpen={onOpen} t={t} />
          <ReconList title={t('projects.recon.onlyLeads')} extra={leads - recon.shared} rows={leadRows} color={palette.leads} onOpen={onOpen} t={t} />
        </div>
      )}

      {scopeNote && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{t('projects.recon.scopeNote')}</span>
        </p>
      )}
    </div>
  );
}

/** The same reconciliation, one row per project: its two bars plus a chip
 * per reason, so you can scan which projects don't line up and why without
 * opening each one. Biggest mismatch first; "no project" always last. */
function ReconciliationByProject({ projects, palette, labelOf, scopeNote, onSelect, onOpen, t }: {
  projects: ProjectStats[]; palette: Palette; labelOf: (l: string) => string; scopeNote: boolean;
  onSelect: (label: string) => void; onOpen: (project: string, bucket: Bucket) => void; t: T;
}) {
  const LIMIT = 8;
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => projects
    .filter((p) => p.enquiries + p.leads > 0)
    .map((p) => ({ p, unmatched: p.enquiries + p.leads - 2 * p.reconciliation.shared }))
    .sort((a, b) => Number(a.p.label === UNSPECIFIED) - Number(b.p.label === UNSPECIFIED)
      || b.unmatched - a.unmatched
      || (b.p.leads + b.p.enquiries) - (a.p.leads + a.p.enquiries)), [projects]);

  if (rows.length === 0) return <EmptyState text={t('projects.noData')} />;
  const visible = expanded ? rows : rows.slice(0, LIMIT);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{t('projects.recon.byProjectHint')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.enquiries }} />{t('projects.recon.onlyEnquiries')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.leads }} />{t('projects.recon.onlyLeads')}</span>
      </div>

      <ul className="divide-y divide-border -mx-1">
        {visible.map(({ p, unmatched }) => {
          const r = p.reconciliation;
          const { enquiryOnly, leadOnly } = bucketsOf(r);
          const chips = [
            ...enquiryOnly.map((b) => ({ bucket: b, color: palette.enquiries })),
            ...leadOnly.map((b) => ({ bucket: b, color: palette.leads })),
          ];
          const scale = Math.max(1, p.enquiries, p.leads);
          // The row opens the project's detail; each chip opens just its
          // records. Chips are real buttons (not nested in the row's), so
          // both work from the keyboard.
          return (
            <li
              key={p.label}
              onClick={() => onSelect(p.label)}
              className="cursor-pointer px-1 py-3 rounded-lg hover:bg-muted/40 transition-colors grid gap-2.5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,1.15fr)_2rem] md:items-center md:gap-4"
            >
              <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(p.label); }} className="min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className={`text-sm font-medium truncate ${p.label === UNSPECIFIED ? 'text-muted-foreground italic' : 'text-foreground'}`}>{labelOf(p.label)}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">{t('projects.recon.shared')}: {r.shared.toLocaleString()}</p>
              </button>
              <div className="space-y-1">
                <ReconBar label={t('projects.colEnquiries')} total={p.enquiries} shared={r.shared} scale={scale} color={palette.enquiries} compact />
                <ReconBar label={t('projects.colLeads')} total={p.leads} shared={r.shared} scale={scale} color={palette.leads} compact />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unmatched === 0 ? (
                  <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">{t('projects.recon.matchShort')}</span>
                ) : chips.map(({ bucket, color }) => (
                  <button
                    key={bucket.key}
                    type="button"
                    title={t(bucketHintKey(bucket.key))}
                    onClick={(e) => { e.stopPropagation(); onOpen(p.label, bucket); }}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-foreground max-w-full hover:bg-primary/10 hover:text-primary active:bg-primary/15 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-semibold tabular-nums">+{bucket.ids.length.toLocaleString()}</span>
                    <span className="truncate">{t(bucketTitleKey(bucket.key))}</span>
                  </button>
                ))}
              </div>
              <ChevronRight className="hidden md:block w-4 h-4 text-muted-foreground justify-self-end" aria-hidden />
            </li>
          );
        })}
      </ul>

      {rows.length > LIMIT && (
        <Button variant="ghost" className="h-10 w-full text-xs font-medium text-primary" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('projects.recon.showLess') : t('projects.recon.showAll').replace('{n}', String(rows.length))}
        </Button>
      )}

      {scopeNote && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{t('projects.recon.scopeNote')}</span>
        </p>
      )}
    </div>
  );
}

const stripes = (color: string) => `repeating-linear-gradient(-45deg, ${color} 0 3px, transparent 3px 6px)`;

function ReconBar({ label, total, shared, scale, color, compact = false }: { label: string; total: number; shared: number; scale: number; color: string; compact?: boolean }) {
  const pct = (n: number) => `${(n / scale) * 100}%`;
  return (
    <div className={`grid items-center gap-2 ${compact ? 'grid-cols-[4.5rem_1fr_2.25rem]' : 'grid-cols-[4.5rem_1fr_2.75rem]'}`}>
      <span className={`${compact ? 'text-[11px]' : 'text-xs'} text-muted-foreground truncate`}>{label}</span>
      <div className={`${compact ? 'h-2' : 'h-3.5'} w-full rounded-full bg-muted overflow-hidden flex`}>
        <div className="h-full transition-[width] duration-500" style={{ width: pct(shared), backgroundColor: color }} />
        <div className="h-full opacity-70 transition-[width] duration-500" style={{ width: pct(total - shared), backgroundImage: stripes(color) }} />
      </div>
      <span className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-foreground tabular-nums text-right`}>{total.toLocaleString()}</span>
    </div>
  );
}

function ReconList({ title, extra, rows, color, onOpen, t }: { title: string; extra: number; rows: Bucket[]; color: string; onOpen: OpenBucket; t: T }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
        {title}
        <span className="ml-auto tabular-nums">{extra > 0 ? `+${extra.toLocaleString()}` : '0'}</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-2">{t('projects.recon.none')}</p>
      ) : (
        <ul className="mt-1.5 space-y-0.5 -mx-1.5">
          {rows.map((bucket) => (
            <li key={bucket.key}>
              <button
                type="button"
                onClick={() => onOpen(bucket)}
                className="w-full flex items-start gap-2.5 text-left rounded-lg px-1.5 py-1.5 hover:bg-background/70 active:bg-background transition-colors"
              >
                <span className="text-sm font-bold text-foreground tabular-nums min-w-[2ch] text-right leading-5">{bucket.ids.length.toLocaleString()}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground leading-5">{t(bucketTitleKey(bucket.key))}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{t(bucketHintKey(bucket.key))}</p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary leading-5">
                  {t('projects.recon.view')}<ChevronRight className="w-3 h-3" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface OpenedBucket extends Bucket {
  /** The project it belongs to, or null for the all-projects total. */
  project: string | null;
}

interface RecordRow {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  status: string;
  createdAt: string;
  haystack: string;
  open: () => void;
  secondary?: { label: string; open: () => void };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The records behind one reconciliation number — the answer to "which 6
 * leads were added directly?". Newest first, searchable, and each row opens
 * the lead (Lead Detail) or the enquiry (Enquiries, filtered to it), with a
 * shortcut to the other side of the pair where there is one. */
function ReconRecordsDialog({ opened, onClose, leadsById, enquiriesById, enquiryOfLead, nameOf, labelOf, stageLabel, enquiryStatusLabel, periodLabel, onOpenLead, onOpenEnquiry, t }: {
  opened: OpenedBucket | null; onClose: () => void;
  leadsById: Map<string, InsightLead>; enquiriesById: Map<string, InsightEnquiry>; enquiryOfLead: Map<string, InsightEnquiry>;
  nameOf: (id: string | null | undefined) => string; labelOf: (l: string) => string;
  stageLabel: (s: string) => string; enquiryStatusLabel: (s: string) => string; periodLabel: string;
  onOpenLead: (id: string) => void; onOpenEnquiry: (enquiryNo: string) => void; t: T;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); }, [opened]);

  const rows = useMemo<RecordRow[]>(() => {
    if (!opened) return [];
    const out: RecordRow[] = [];
    if (opened.kind === 'leads') {
      for (const id of opened.ids) {
        const l = leadsById.get(id);
        if (!l) continue;
        const enq = enquiryOfLead.get(l.id);
        const owner = l.owner_id ? nameOf(l.owner_id) : '';
        out.push({
          id: l.id,
          title: l.name,
          subtitle: [l.phone, owner].filter(Boolean).join(' · '),
          meta: [shortDate(l.created_at), l.preferred_project, l.lead_source].filter(Boolean).join(' · '),
          status: stageLabel(l.status),
          createdAt: l.created_at,
          haystack: [l.name, l.phone, owner, l.preferred_project, enq?.enquiry_no].filter(Boolean).join(' ').toLowerCase(),
          open: () => onOpenLead(l.id),
          secondary: enq ? { label: enq.enquiry_no, open: () => onOpenEnquiry(enq.enquiry_no) } : undefined,
        });
      }
    } else {
      for (const id of opened.ids) {
        const e = enquiriesById.get(id);
        if (!e) continue;
        const assignee = e.assigned_to ? nameOf(e.assigned_to) : '';
        const lead = e.converted_lead_id ? leadsById.get(e.converted_lead_id) : undefined;
        out.push({
          id: e.id,
          title: e.name,
          subtitle: [e.enquiry_no, e.phone, assignee].filter(Boolean).join(' · '),
          meta: [shortDate(e.created_at), e.preferred_project, e.source].filter(Boolean).join(' · '),
          status: enquiryStatusLabel(e.status),
          createdAt: e.created_at,
          haystack: [e.name, e.phone, e.enquiry_no, assignee, e.preferred_project].filter(Boolean).join(' ').toLowerCase(),
          open: () => onOpenEnquiry(e.enquiry_no),
          secondary: lead ? { label: t('projects.recon.openLead'), open: () => onOpenLead(lead.id) } : undefined,
        });
      }
    }
    return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [opened, leadsById, enquiriesById, enquiryOfLead, nameOf, stageLabel, enquiryStatusLabel, onOpenLead, onOpenEnquiry, t]);

  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.haystack.includes(q)) : rows;

  return (
    <Dialog open={!!opened} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 gap-0 overflow-hidden flex flex-col max-h-[85dvh]">
        {opened && (
          <>
            <DialogHeader className="px-5 pt-5 pb-3 text-left space-y-1">
              <DialogTitle className="text-base pr-6 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-primary" aria-hidden />
                {t(bucketTitleKey(opened.key))}
                <span className="text-muted-foreground font-normal tabular-nums">· {rows.length.toLocaleString()}</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                {opened.project ? labelOf(opened.project) : t('projects.recon.allProjects')} · {periodLabel}
              </DialogDescription>
              <p className="text-xs text-muted-foreground leading-relaxed">{t(bucketHintKey(opened.key))}</p>
            </DialogHeader>

            {rows.length > 6 && (
              <div className="px-5 pb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('projects.recon.searchRecords')} className="h-10 pl-8" />
                </div>
              </div>
            )}

            <div className="overflow-y-auto overscroll-contain border-t border-border">
              {visible.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">{t('projects.recon.noRecords')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {visible.map((r) => (
                    <li key={r.id} className="flex items-stretch">
                      <button type="button" onClick={r.open} className="flex-1 min-w-0 text-left px-5 py-3 hover:bg-muted/50 active:bg-muted transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                          <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{r.status}</span>
                        </div>
                        {r.subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{r.subtitle}</p>}
                        <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">{r.meta}</p>
                      </button>
                      {r.secondary && (
                        <button
                          type="button" onClick={r.secondary.open}
                          className="shrink-0 px-3 text-[11px] font-medium text-primary hover:bg-primary/5 active:bg-primary/10 transition-colors border-l border-border inline-flex items-center gap-0.5"
                        >
                          {r.secondary.label}<ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
