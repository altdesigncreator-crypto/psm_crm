import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { useProfiles } from '@/hooks/useProfiles';
import { useStatusColors } from '@/hooks/useStatusColors';
import { isExec } from '@/lib/permissions';
import {
  ArrowLeft, BarChart3, TrendingUp, TrendingDown, Users, DollarSign, Target, Activity,
  FileSpreadsheet, FileText, File as FilePdf, Flame, Sparkles, Building2, Wifi,
} from 'lucide-react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { exportAnalyticsAsExcel, exportAnalyticsAsPDF, exportAnalyticsAsHTML } from '@/lib/analyticsExport';
import { LEAD_STAGES, type Lead } from '@/types';
import { enumLabel } from '@/lib/translations';
import { toast } from 'sonner';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import PeriodFilterBar from '@/components/PeriodFilterBar';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

/** One-step-ahead forecast from the recent month-over-month growth rates,
 * weighted toward the most recent transitions and clamped per-step.
 *
 * Two more "standard" methods were tried first and both broke on real lead
 * data: an ordinary-least-squares line treats a one-off spike (a bulk
 * import, a campaign) as seriously as every other month, and even Holt's
 * exponential-smoothing trend keeps enough momentum from a multi-month
 * run-up that one subsequent down month isn't enough to turn it around —
 * both projected a rebound the month right after a sharp, obvious decline.
 * Clamping each individual growth rate before averaging (not just the
 * final number) is what actually fixes it: one wild transition — say, a
 * near-zero month jumping to a bulk-imported spike — can contribute at
 * most ±75% to the average instead of dragging the whole trend estimate
 * along with it, while recent transitions still count more via the
 * increasing weights. Floors at 0 since a lead/sale count can't go
 * negative. */
function momentumForecast(series: number[]): number {
  const n = series.length;
  if (n === 0) return 0;
  const last = series[n - 1];
  if (n === 1) return Math.max(0, Math.round(last));
  const window = series.slice(-4);
  const rates: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const curr = window[i];
    const rate = prev > 0 ? (curr - prev) / prev : (curr > 0 ? 1 : 0);
    rates.push(Math.max(-0.75, Math.min(0.75, rate)));
  }
  let weightedSum = 0, weightTotal = 0;
  rates.forEach((r, i) => { const w = i + 1; weightedSum += r * w; weightTotal += w; });
  const avgRate = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return Math.max(0, Math.round(last * (1 + avgRate)));
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** Trailing N real calendar months ending this month, zero-filled — so a
 * quiet month shows as 0 on the chart instead of just not existing. */
function trailingMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { nameOf } = useProfiles();
  const { colors: statusColors } = useStatusColors();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const { t, lang } = useTranslation();
  usePageHeader(t('analytics.pageTitle'), t('analytics.subtitle'));
  const { period, setPeriod, isCurrentPeriod, shiftPeriod, periodLabel, matchesPeriod } = usePeriodFilter();

  useEffect(() => {
    if (!isExec(role)) { setLoading(false); return; }
    let active = true;
    const load = async () => {
      try {
        const rows = await fetchAllRows<Lead>('leads');
        if (active) setLeads(rows);
      } catch {
        toast.error(t('analytics.loadError'));
      }
      if (active) setLoading(false);
    };
    load();

    // Real-time: the board updates itself as leads change anywhere in the
    // app, instead of showing a stale snapshot from whenever the page loaded.
    const channel = supabase
      .channel('analytics-leads')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setLeads((prev) => (prev.some((l) => l.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setLeads((prev) => prev.map((l) => (l.id === row.id ? row : l)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setLeads((prev) => prev.filter((l) => l.id !== oldId));
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => { active = false; supabase.removeChannel(channel); };
  }, [role]);

  if (!isExec(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">{t('analytics.restricted')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-4 h-4 mr-2" />{t('kpiBoard.backToDashboard')}</Button>
      </div>
    );
  }

  const periodLeads = useMemo(() => leads.filter((l) => matchesPeriod(l.created_at)), [leads, matchesPeriod]);

  const totalLeads = periodLeads.length;
  const soldCount = periodLeads.filter((l) => l.status === 'sold').length;
  const conversionRate = totalLeads > 0 ? Math.round((soldCount / totalLeads) * 100) : 0;
  const avgDealSize = useMemo(() => {
    const deals = periodLeads.filter((l) => l.status === 'sold' && l.sale_amount);
    if (deals.length === 0) return 0;
    return Math.round(deals.reduce((acc, l) => acc + (l.sale_amount || 0), 0) / deals.length);
  }, [periodLeads]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    periodLeads.forEach((l) => { counts[l.status] = (counts[l.status] || 0) + 1; });
    return counts;
  }, [periodLeads]);
  const statusEntries = LEAD_STAGES.map((s) => [enumLabel('stage', s.value, s.label, lang), statusCounts[s.value] || 0, statusColors[s.value] || '#8FA3BF'] as const).filter(([, c]) => c > 0);
  const statusLabels = statusEntries.map(([label]) => label);
  const doughnutData = {
    labels: statusLabels,
    datasets: [{ data: statusEntries.map(([, c]) => c), backgroundColor: statusEntries.map(([, , c]) => c), borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }],
  };

  const agentPerf = useMemo(() => {
    const map: Record<string, { total: number; closed: number }> = {};
    periodLeads.forEach((l) => {
      const a = l.owner_id ? nameOf(l.owner_id) : t('analytics.unassigned');
      if (!map[a]) map[a] = { total: 0, closed: 0 };
      map[a].total += 1;
      if (l.status === 'sold') map[a].closed += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].closed - a[1].closed).slice(0, 8);
  }, [periodLeads, nameOf, t]);

  const agentBarData = {
    labels: agentPerf.map(([name]) => name),
    datasets: [
      { label: t('analytics.chartTotalLeads'), data: agentPerf.map(([, v]) => v.total), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6 },
      { label: t('analytics.chartSold'), data: agentPerf.map(([, v]) => v.closed), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
    ],
  };

  // Trend & forecast are always computed from the full, unfiltered lead
  // history over the trailing 12 real calendar months — deliberately
  // independent of the Monthly/Yearly/Overall viewer above, the same way a
  // sparkline needs its own timeline regardless of what period someone
  // happens to be looking at.
  const monthlyTrend = useMemo(() => {
    const months = trailingMonths(12);
    const map: Record<string, { new: number; closed: number; revenue: number }> = {};
    months.forEach((m) => { map[m] = { new: 0, closed: 0, revenue: 0 }; });
    leads.forEach((l) => {
      const createdKey = monthKey(new Date(l.created_at));
      if (map[createdKey]) map[createdKey].new += 1;
      if (l.status === 'sold') {
        const closedKey = monthKey(new Date(l.updated_at));
        if (map[closedKey]) {
          map[closedKey].closed += 1;
          map[closedKey].revenue += l.sale_amount || 0;
        }
      }
    });
    return months.map((m) => [m, map[m]] as const);
  }, [leads]);

  const forecast = useMemo(() => {
    const newSeries = monthlyTrend.map(([, v]) => v.new);
    const closedSeries = monthlyTrend.map(([, v]) => v.closed);
    const lastMonth = monthlyTrend[monthlyTrend.length - 1]?.[1];
    const prevMonth = monthlyTrend[monthlyTrend.length - 2]?.[1];
    return {
      nextMonthLeads: momentumForecast(newSeries),
      nextMonthSold: momentumForecast(closedSeries),
      leadsGrowthPct: pctChange(lastMonth?.new || 0, prevMonth?.new || 0),
      soldGrowthPct: pctChange(lastMonth?.closed || 0, prevMonth?.closed || 0),
    };
  }, [monthlyTrend]);

  const trendLabels = monthlyTrend.map(([m]) => monthLabel(m));
  const forecastMonthLabel = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }, []);

  const lineData = {
    labels: [...trendLabels, forecastMonthLabel],
    datasets: [
      {
        label: t('analytics.chartNewLeads'),
        data: [...monthlyTrend.map(([, v]) => v.new), null],
        borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 3,
      },
      {
        label: t('analytics.chartSold'),
        data: [...monthlyTrend.map(([, v]) => v.closed), null],
        borderColor: 'rgba(34,197,94,1)', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.4, pointRadius: 3,
      },
      {
        label: t('analytics.chartProjectedLeads'),
        data: [...monthlyTrend.map(() => null), forecast.nextMonthLeads],
        borderColor: 'rgba(59,130,246,0.9)', backgroundColor: 'rgba(59,130,246,0.9)', borderDash: [5, 4],
        pointRadius: 5, pointStyle: 'rectRot', showLine: false,
      },
      {
        // A dotted bridge from the last real point to the projected one so
        // it doesn't look like a disconnected dot floating past the axis.
        label: t('analytics.chartProjectionTrend'),
        data: monthlyTrend.map((_, i) => (i === monthlyTrend.length - 1 ? monthlyTrend[i][1].new : null)).concat([forecast.nextMonthLeads]),
        borderColor: 'rgba(59,130,246,0.6)', borderDash: [4, 4], borderWidth: 2, pointRadius: 0, fill: false,
      },
    ],
  };

  const sourceRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    periodLeads.filter((l) => l.status === 'sold' && l.sale_amount).forEach((l) => {
      const src = l.lead_source || t('analytics.unknown');
      map[src] = (map[src] || 0) + (l.sale_amount || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [periodLeads, t]);

  const revenueBarData = { labels: sourceRevenue.map(([s]) => s), datasets: [{ label: t('analytics.chartRevenue'), data: sourceRevenue.map(([, v]) => v), backgroundColor: 'rgba(234,179,8,0.7)', borderRadius: 6 }] };

  // Most Interested — which projects are actually pulling demand, the
  // number one thing an exec wants from "analytics" in a real-estate CRM.
  const projectPerf = useMemo(() => {
    const map: Record<string, { total: number; closed: number }> = {};
    periodLeads.forEach((l) => {
      const key = l.preferred_project?.trim() || t('analytics.unspecified');
      if (!map[key]) map[key] = { total: 0, closed: 0 };
      map[key].total += 1;
      if (l.status === 'sold') map[key].closed += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  }, [periodLeads, t]);
  const topProjectMax = projectPerf[0]?.[1].total || 1;

  const interestBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    periodLeads.forEach((l) => {
      const key = l.interest_type?.trim() || t('analytics.unspecified');
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [periodLeads, t]);
  const interestTotal = interestBreakdown.reduce((sum, [, c]) => sum + c, 0) || 1;
  const interestPalette = ['#0463CA', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#0EA5E9'];

  // Plain-language read-out of the numbers above — every figure it quotes
  // is one already computed on this page, just narrated.
  const insight = useMemo(() => {
    const parts: string[] = [];
    if (lang === 'mm') {
      if (forecast.leadsGrowthPct !== 0) {
        parts.push(`${forecast.leadsGrowthPct > 0 ? t('analytics.insightLeadsUp') : t('analytics.insightLeadsDown')} ${Math.abs(forecast.leadsGrowthPct)}${forecast.leadsGrowthPct > 0 ? t('analytics.insightVsLastMonthSuffix') : t('analytics.insightVsLastMonthSuffixDown')}`);
      } else {
        parts.push(t('analytics.insightFlat'));
      }
      if (projectPerf.length > 0 && projectPerf[0][0] !== t('analytics.unspecified')) {
        parts.push(`${projectPerf[0][0]} ${t('analytics.insightTopProjectPrefix')} ${projectPerf[0][1].total} ${t('analytics.insightTopProjectSuffix')}`);
      }
      parts.push(`${t('analytics.insightProjectedSuffix')}${forecast.nextMonthLeads} ${t('analytics.insightNewLeadsNextMonth')}`);
    } else {
      if (forecast.leadsGrowthPct !== 0) {
        parts.push(`Leads are ${forecast.leadsGrowthPct > 0 ? 'up' : 'down'} ${Math.abs(forecast.leadsGrowthPct)}% vs last month`);
      } else {
        parts.push('Lead volume is flat vs last month');
      }
      if (projectPerf.length > 0 && projectPerf[0][0] !== t('analytics.unspecified')) {
        parts.push(`${projectPerf[0][0]} is the most sought-after project with ${projectPerf[0][1].total} interested lead${projectPerf[0][1].total === 1 ? '' : 's'}`);
      }
      parts.push(`projected ~${forecast.nextMonthLeads} new leads next month`);
    }
    return `${parts.join(' · ')}.`;
  }, [forecast, projectPerf, lang, t]);

  const analyticsData = useMemo(() => ({
    totalLeads, closedCount: soldCount, conversionRate, avgDealSize,
    statusLabels, statusCounts: statusEntries.map(([, c]) => c), agentPerf,
    monthlyTrend: monthlyTrend.map(([m, v]) => [m, { new: v.new, closed: v.closed }] as [string, { new: number; closed: number }]),
    sourceRevenue, projectPerf, forecast: { nextMonthLeads: forecast.nextMonthLeads, nextMonthSold: forecast.nextMonthSold, leadsGrowthPct: forecast.leadsGrowthPct },
  }), [totalLeads, soldCount, conversionRate, avgDealSize, statusLabels, statusEntries, agentPerf, monthlyTrend, sourceRevenue, projectPerf, forecast]);

  const handleExport = (format: 'excel' | 'pdf' | 'html') => {
    try {
      if (format === 'excel') exportAnalyticsAsExcel(analyticsData);
      else if (format === 'pdf') exportAnalyticsAsPDF(analyticsData);
      else exportAnalyticsAsHTML(analyticsData);
      toast.success(t('analytics.exportCompleteToast'));
    } catch {
      toast.error(t('analytics.exportFailedToast'));
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 } } } }, scales: { x: { ticks: { font: { size: 10 } }, grid: { display: false } }, y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } } } };
  const doughnutOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' as const, labels: { font: { size: 11 }, boxWidth: 12 } } }, cutout: '68%' };
  const lineOptions = {
    ...chartOptions,
    plugins: {
      legend: { labels: { font: { size: 11 }, filter: (item: { text: string }) => item.text !== t('analytics.chartProjectionTrend') } },
      tooltip: { filter: (item: { dataset: { label?: string } }) => item.dataset.label !== t('analytics.chartProjectionTrend') },
    },
  };

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between md:justify-end gap-3">
        <div className="md:hidden flex items-center justify-between gap-2">
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug flex items-center gap-2"><BarChart3 className="w-6 h-6 text-primary" /> {t('analytics.pageTitle')}</h1>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full ${live ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            <Wifi className="w-3 h-3" /> {live ? t('analytics.live') : t('analytics.connecting')}
          </span>
        </div>
        <div className="hidden md:flex items-center gap-1.5 mr-auto">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full ${live ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} /> {live ? t('analytics.live') : t('analytics.connecting')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]" onClick={() => handleExport('excel')} disabled={totalLeads === 0}><FileSpreadsheet className="w-4 h-4 text-success" /><span className="hidden sm:inline">Excel</span></Button>
          <Button variant="outline" className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]" onClick={() => handleExport('pdf')} disabled={totalLeads === 0}><FilePdf className="w-4 h-4 text-destructive" /><span className="hidden sm:inline">PDF</span></Button>
          <Button variant="outline" className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]" onClick={() => handleExport('html')} disabled={totalLeads === 0}><FileText className="w-4 h-4 text-info" /><span className="hidden sm:inline">HTML</span></Button>
        </div>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-3">
          <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
        </CardContent>
      </Card>

      {/* Insight banner — a plain-language read-out of the numbers below. */}
      <Card className="shadow-card rounded-xl border-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-primary" /></div>
          <p className="text-sm text-foreground leading-relaxed pt-1.5">{insight}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Users className="w-4 h-4 text-primary" /></div><p className="text-xs text-muted-foreground">{t('dashboard.totalLeads')}</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{totalLeads}</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center"><Target className="w-4 h-4 text-success" /></div><p className="text-xs text-muted-foreground">{t('analytics.conversion')}</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{conversionRate}%</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-warning" /></div><p className="text-xs text-muted-foreground">{t('analytics.avgDealSize')}</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{avgDealSize.toLocaleString()}</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-info" /></div><p className="text-xs text-muted-foreground">{t('stage.sold')}</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{soldCount}</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full pointer-events-none" />
          <CardContent className="p-4 flex flex-col flex-1 relative">
            <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Sparkles className="w-4 h-4 text-primary" /></div><p className="text-xs text-muted-foreground">{t('analytics.nextMonthProjected')}</p></div>
            <p className="text-2xl font-bold text-foreground tabular-nums">~{forecast.nextMonthLeads}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="flex items-center gap-2 mb-2"><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${forecast.leadsGrowthPct >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>{forecast.leadsGrowthPct >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-destructive" />}</div><p className="text-xs text-muted-foreground">{t('analytics.momGrowth')}</p></div>
            <p className={`text-2xl font-bold tabular-nums ${forecast.leadsGrowthPct >= 0 ? 'text-success' : 'text-destructive'}`}>{forecast.leadsGrowthPct >= 0 ? '+' : ''}{forecast.leadsGrowthPct}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend & Forecast */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> {t('analytics.trendForecast12mo')}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="h-64 md:h-72"><Line data={lineData} options={lineOptions} /></div>
          <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 shrink-0" /> {t('analytics.forecastFootnote')}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> {t('analytics.leadsByStatus')}</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64">{statusLabels.length > 0 ? <Doughnut data={doughnutData} options={doughnutOptions} /> : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('analytics.noLeadsPeriod')}</div>}</div></CardContent>
        </Card>

        {/* Most Interested — the "which project is hot" question. */}
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-primary" /> {t('analytics.mostInterestedProjects')}</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0">
            {projectPerf.length === 0 ? (
              <div className="h-56 md:h-64 flex items-center justify-center text-sm text-muted-foreground">{t('analytics.noLeadsPeriod')}</div>
            ) : (
              <div className="space-y-3 max-h-56 md:max-h-64 overflow-y-auto pr-1">
                {projectPerf.map(([name, v], i) => {
                  const rate = v.total > 0 ? Math.round((v.closed / v.total) * 100) : 0;
                  return (
                    <div key={name} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-foreground truncate min-w-0">
                          <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                          <span className="truncate">{name}</span>
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">{v.total} {t('analytics.leadsWord')} · {rate}{t('analytics.soldPctSuffix')}</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70" style={{ width: `${Math.max(4, (v.total / topProjectMax) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> {t('analytics.agentPerformance')}</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64">{agentPerf.length > 0 ? <Bar data={agentBarData} options={chartOptions} /> : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('analytics.noLeadsPeriod')}</div>}</div></CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> {t('analytics.revenueByLeadSource')}</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64">{sourceRevenue.length > 0 ? <Bar data={revenueBarData} options={chartOptions} /> : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('analytics.noSoldRevenueYet')}</div>}</div></CardContent>
        </Card>
      </div>

      {/* Interest-type split — quick buy/rent/sell read at a glance. */}
      {interestBreakdown.length > 0 && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> {t('analytics.interestTypeSplit')}</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted">
              {interestBreakdown.map(([label, count], i) => (
                <div key={label} style={{ width: `${(count / interestTotal) * 100}%`, backgroundColor: interestPalette[i % interestPalette.length] }} title={`${label}: ${count}`} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
              {interestBreakdown.map(([label, count], i) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: interestPalette[i % interestPalette.length] }} />
                  {label} <span className="font-semibold text-foreground tabular-nums">{count}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analysis Records — the detail behind every chart above, for anyone
          who wants exact numbers rather than a bar's height. */}
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {t('analytics.analysisRecords')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="px-4 pt-2 pb-1"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('analytics.byAgent')}</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('analytics.agentCol')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('analytics.leadsCol')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('analytics.soldCol')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('analytics.conversionCol')}</th>
                </tr>
              </thead>
              <tbody>
                {agentPerf.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">{t('analytics.noLeadsPeriod')}</td></tr>
                ) : agentPerf.map(([name, v]) => (
                  <tr key={name} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{v.total}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{v.closed}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{v.total > 0 ? Math.round((v.closed / v.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 pt-4 pb-1 border-t border-border/60"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('analytics.byProject')}</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('analytics.projectCol')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('analytics.interestedCol')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('analytics.soldCol')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('analytics.conversionCol')}</th>
                </tr>
              </thead>
              <tbody>
                {projectPerf.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">{t('analytics.noLeadsPeriod')}</td></tr>
                ) : projectPerf.map(([name, v]) => (
                  <tr key={name} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{v.total}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{v.closed}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{v.total > 0 ? Math.round((v.closed / v.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
