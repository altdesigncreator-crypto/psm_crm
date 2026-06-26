import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/contexts/TranslationContext';
import { BarChart3, TrendingUp, Users, DollarSign, Target, Activity, Download, FileSpreadsheet, FileText, File as FilePdf } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  exportAnalyticsAsExcel,
  exportAnalyticsAsPDF,
  exportAnalyticsAsHTML,
} from '@/lib/analyticsExport';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface LeadRecord {
  id: string;
  name: string;
  status: string;
  assignedAgent: string;
  budgetMin?: number;
  budgetMax?: number;
  budgetUnlimited?: boolean;
  leadSource: string;
  createdAt?: Timestamp;
  closedAt?: Timestamp;
}

export default function AdminAnalytics() {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'leads'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: (raw.name as string) || '',
          status: (raw.status as string) || '',
          assignedAgent: (raw.assignedAgent as string) || '',
          budgetMin: raw.budgetMin != null ? Number(raw.budgetMin) : undefined,
          budgetMax: raw.budgetMax != null ? Number(raw.budgetMax) : undefined,
          budgetUnlimited: !!raw.budgetUnlimited,
          leadSource: (raw.leadSource as string) || '',
          createdAt: raw.createdAt as Timestamp | undefined,
          closedAt: raw.closedAt as Timestamp | undefined,
        };
      });
      setLeads(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── KPIs ──
  const totalLeads = leads.length;
  const closedCount = leads.filter((l) => l.status === 'Closed').length;
  const conversionRate = totalLeads > 0 ? Math.round((closedCount / totalLeads) * 100) : 0;
  const avgDealSize = useMemo(() => {
    const deals = leads.filter((l) => l.status === 'Closed' && l.budgetMax && !l.budgetUnlimited);
    if (deals.length === 0) return 0;
    const sum = deals.reduce((acc, l) => acc + (l.budgetMax || 0), 0);
    return Math.round(sum / deals.length);
  }, [leads]);

  // ── Leads by Status (Doughnut) ──
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => {
      counts[l.status] = (counts[l.status] || 0) + 1;
    });
    return counts;
  }, [leads]);

  const statusLabels = Object.keys(statusCounts);
  const statusColors = [
    'rgba(59,130,246,0.8)',   // blue
    'rgba(34,197,94,0.8)',    // green
    'rgba(234,179,8,0.8)',    // yellow
    'rgba(168,85,247,0.8)',   // purple
    'rgba(249,115,22,0.8)',   // orange
    'rgba(239,68,68,0.8)',    // red
  ];

  const doughnutData = {
    labels: statusLabels,
    datasets: [
      {
        data: statusLabels.map((s) => statusCounts[s]),
        backgroundColor: statusColors,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.8)',
      },
    ],
  };

  // ── Agent Performance (Bar) ──
  const agentPerf = useMemo(() => {
    const map: Record<string, { total: number; closed: number }> = {};
    leads.forEach((l) => {
      const a = l.assignedAgent || 'Unassigned';
      if (!map[a]) map[a] = { total: 0, closed: 0 };
      map[a].total += 1;
      if (l.status === 'Closed') map[a].closed += 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1].closed - a[1].closed)
      .slice(0, 8);
  }, [leads]);

  const agentBarData = {
    labels: agentPerf.map(([name]) => name),
    datasets: [
      {
        label: 'Total Leads',
        data: agentPerf.map(([, v]) => v.total),
        backgroundColor: 'rgba(59,130,246,0.7)',
        borderRadius: 6,
      },
      {
        label: 'Closed',
        data: agentPerf.map(([, v]) => v.closed),
        backgroundColor: 'rgba(34,197,94,0.7)',
        borderRadius: 6,
      },
    ],
  };

  // ── Monthly Trend (Line) ──
  const monthlyTrend = useMemo(() => {
    const map: Record<string, { new: number; closed: number }> = {};
    leads.forEach((l) => {
      const date = l.createdAt?.toDate ? l.createdAt.toDate() : new Date();
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!map[key]) map[key] = { new: 0, closed: 0 };
      map[key].new += 1;
      if (l.status === 'Closed') {
        const cDate = l.closedAt?.toDate ? l.closedAt.toDate() : date;
        const cKey = `${cDate.getFullYear()}-${String(cDate.getMonth() + 1).padStart(2, '0')}`;
        if (!map[cKey]) map[cKey] = { new: 0, closed: 0 };
        map[cKey].closed += 1;
      }
    });
    const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
    return sorted;
  }, [leads]);

  const lineData = {
    labels: monthlyTrend.map(([m]) => m),
    datasets: [
      {
        label: 'New Leads',
        data: monthlyTrend.map(([, v]) => v.new),
        borderColor: 'rgba(59,130,246,1)',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
      },
      {
        label: 'Closed',
        data: monthlyTrend.map(([, v]) => v.closed),
        borderColor: 'rgba(34,197,94,1)',
        backgroundColor: 'rgba(34,197,94,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
      },
    ],
  };

  // ── Revenue by Source (Bar) ──
  const sourceRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    leads
      .filter((l) => l.status === 'Closed' && l.budgetMax && !l.budgetUnlimited)
      .forEach((l) => {
        const src = l.leadSource || 'Unknown';
        map[src] = (map[src] || 0) + (l.budgetMax || 0);
      });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [leads]);

  const revenueBarData = {
    labels: sourceRevenue.map(([s]) => s),
    datasets: [
      {
        label: 'Revenue',
        data: sourceRevenue.map(([, v]) => v),
        backgroundColor: 'rgba(234,179,8,0.7)',
        borderRadius: 6,
      },
    ],
  };

  // Build analytics data object for export
  const analyticsData = useMemo(() => ({
    totalLeads,
    closedCount,
    conversionRate,
    avgDealSize,
    statusLabels: Object.keys(statusCounts),
    statusCounts: Object.keys(statusCounts).map((s) => statusCounts[s]),
    agentPerf,
    monthlyTrend,
    sourceRevenue,
  }), [totalLeads, closedCount, conversionRate, avgDealSize, statusCounts, agentPerf, monthlyTrend, sourceRevenue]);

  const handleExport = (format: 'excel' | 'pdf' | 'html') => {
    try {
      if (format === 'excel') {
        exportAnalyticsAsExcel(analyticsData);
        toast.success('Excel ထုတ်ယူခြင်း ပြီးပါပြီ');
      } else if (format === 'pdf') {
        exportAnalyticsAsPDF(analyticsData);
        toast.success('PDF ထုတ်ယူခြင်း ပြီးပါပြီ');
      } else {
        exportAnalyticsAsHTML(analyticsData);
        toast.success('HTML ထုတ်ယူခြင်း ပြီးပါပြီ');
      }
    } catch {
      toast.error('ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: { size: 11 } } },
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' as const, labels: { font: { size: 11 }, boxWidth: 12 } },
    },
    cutout: '60%',
  };

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            {t('analytics.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time lead & revenue analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]"
            onClick={() => handleExport('excel')}
            disabled={totalLeads === 0}
          >
            <FileSpreadsheet className="w-4 h-4 text-success" />
            <span className="hidden sm:inline">Excel</span>
          </Button>
          <Button
            variant="outline"
            className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]"
            onClick={() => handleExport('pdf')}
            disabled={totalLeads === 0}
          >
            <FilePdf className="w-4 h-4 text-destructive" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
          <Button
            variant="outline"
            className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]"
            onClick={() => handleExport('html')}
            disabled={totalLeads === 0}
          >
            <FileText className="w-4 h-4 text-info" />
            <span className="hidden sm:inline">HTML</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground">{t('common.total')} Leads</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{totalLeads}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-success" />
              </div>
              <p className="text-xs text-muted-foreground">{t('analytics.conversion')}</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{conversionRate}%</p>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-warning" />
              </div>
              <p className="text-xs text-muted-foreground">{t('analytics.avgDealSize')}</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              ${avgDealSize.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-info" />
              </div>
              <p className="text-xs text-muted-foreground">{t('analytics.closedDeals')}</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{closedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              {t('analytics.leadsByStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0">
            <div className="h-56 md:h-64">
              <Doughnut data={doughnutData} options={doughnutOptions} />
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              {t('analytics.agentPerformance')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0">
            <div className="h-56 md:h-64">
              <Bar data={agentBarData} options={chartOptions} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              {t('analytics.monthlyTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0">
            <div className="h-56 md:h-64">
              <Line data={lineData} options={chartOptions} />
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              {t('analytics.revenue')} ({t('analytics.leadsBySource')})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0">
            <div className="h-56 md:h-64">
              <Bar data={revenueBarData} options={chartOptions} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
