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
  Info, Layers, Minus, RefreshCw, Search, Sparkles, Target, Users, Wifi, ExternalLink, Trophy,
} from 'lucide-react';
import { supabase } from '@/db/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PeriodFilterBar from '@/components/PeriodFilterBar';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePeriodFilter, type Period } from '@/hooks/usePeriodFilter';
import { canAccessRoute } from '@/lib/permissions';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { enumLabel } from '@/lib/translations';
import { LEAD_STAGES } from '@/types';
import {
  computeProjectInsights, pctDelta, ratio, sourceCount, topEntries, topSource,
  ENQUIRY_COLUMNS, LEAD_COLUMNS, NO_SOURCE, UNSPECIFIED,
  type DateRange, type InsightEnquiry, type InsightLead, type ProjectStats,
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

  const labelOf = useCallback((label: string) => (label === UNSPECIFIED ? t('projects.unspecified') : label), [t]);
  const sourceLabel = useCallback((s: string) => (s === NO_SOURCE ? t('projects.noSource') : s), [t]);

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
        stageLabel={(s) => enumLabel('stage', s, LEAD_STAGES.find((x) => x.value === s)?.label ?? s, lang)}
        onViewLeads={(label) => navigate(`/leads?${new URLSearchParams({ project: label, period, month: String(selectedMonth), year: String(selectedYear) })}`)}
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
function ProjectDetailSheet({ project, open, onOpenChange, palette, hasPrev, periodLabel, labelOf, sourceLabel, stageLabel, onViewLeads, t }: {
  project: ProjectStats | null; open: boolean; onOpenChange: (o: boolean) => void; palette: Palette; hasPrev: boolean; periodLabel: string;
  labelOf: (l: string) => string; sourceLabel: (s: string) => string; stageLabel: (s: string) => string; onViewLeads: (label: string) => void; t: T;
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
                {sources.map(([src, n]) => (
                  <BarRow key={src} label={sourceLabel(src)} value={n} max={sourceMax} color={tab === 'leads' ? palette.leads : palette.enquiries} />
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

          {!isUnspecified && project.leads > 0 && (
            <Button className="w-full h-11 gap-2" onClick={() => onViewLeads(project.label)}>
              <ExternalLink className="w-4 h-4" /> {t('projects.viewLeads')}
            </Button>
          )}
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

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs mb-1">
        <span className="text-foreground truncate">{label}</span>
        <span className="text-muted-foreground tabular-nums shrink-0">{value}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, (value / max) * 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
