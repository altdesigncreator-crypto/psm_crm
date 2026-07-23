import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useProfiles } from '@/hooks/useProfiles';
import { isExec } from '@/lib/permissions';
import { ArrowLeft, BarChart3, TrendingUp, Users, DollarSign, Target, Activity, FileSpreadsheet, FileText, File as FilePdf } from 'lucide-react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { exportAnalyticsAsExcel, exportAnalyticsAsPDF, exportAnalyticsAsHTML } from '@/lib/analyticsExport';
import { LEAD_STAGES, type Lead } from '@/types';
import { toast } from 'sonner';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { nameOf } = useProfiles();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  usePageHeader('Analytics', 'Company-wide lead and revenue analytics');

  useEffect(() => {
    if (!isExec(role)) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase.from('leads').select('*');
      setLeads((data || []) as Lead[]);
      setLoading(false);
    })();
  }, [role]);

  if (!isExec(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">This page is restricted to Boss and Super Admin.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-4 h-4 mr-2" />Back to Dashboard</Button>
      </div>
    );
  }

  const totalLeads = leads.length;
  const soldCount = leads.filter((l) => l.status === 'sold').length;
  const conversionRate = totalLeads > 0 ? Math.round((soldCount / totalLeads) * 100) : 0;
  const avgDealSize = useMemo(() => {
    const deals = leads.filter((l) => l.status === 'sold' && l.sale_amount);
    if (deals.length === 0) return 0;
    return Math.round(deals.reduce((acc, l) => acc + (l.sale_amount || 0), 0) / deals.length);
  }, [leads]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => { const label = LEAD_STAGES.find((s) => s.value === l.status)?.label || l.status; counts[label] = (counts[label] || 0) + 1; });
    return counts;
  }, [leads]);
  const statusLabels = Object.keys(statusCounts);
  const palette = ['rgba(59,130,246,0.8)', 'rgba(34,197,94,0.8)', 'rgba(234,179,8,0.8)', 'rgba(168,85,247,0.8)', 'rgba(249,115,22,0.8)', 'rgba(239,68,68,0.8)', 'rgba(14,165,233,0.8)', 'rgba(236,72,153,0.8)', 'rgba(100,116,139,0.8)'];
  const doughnutData = { labels: statusLabels, datasets: [{ data: statusLabels.map((s) => statusCounts[s]), backgroundColor: palette, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' }] };

  const agentPerf = useMemo(() => {
    const map: Record<string, { total: number; closed: number }> = {};
    leads.forEach((l) => {
      const a = l.owner_id ? nameOf(l.owner_id) : 'Unassigned';
      if (!map[a]) map[a] = { total: 0, closed: 0 };
      map[a].total += 1;
      if (l.status === 'sold') map[a].closed += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].closed - a[1].closed).slice(0, 8);
  }, [leads, nameOf]);

  const agentBarData = {
    labels: agentPerf.map(([name]) => name),
    datasets: [
      { label: 'Total Leads', data: agentPerf.map(([, v]) => v.total), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6 },
      { label: 'Sold', data: agentPerf.map(([, v]) => v.closed), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
    ],
  };

  const monthlyTrend = useMemo(() => {
    const map: Record<string, { new: number; closed: number }> = {};
    leads.forEach((l) => {
      const date = new Date(l.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!map[key]) map[key] = { new: 0, closed: 0 };
      map[key].new += 1;
      if (l.status === 'sold') {
        const cDate = new Date(l.updated_at);
        const cKey = `${cDate.getFullYear()}-${String(cDate.getMonth() + 1).padStart(2, '0')}`;
        if (!map[cKey]) map[cKey] = { new: 0, closed: 0 };
        map[cKey].closed += 1;
      }
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [leads]);

  const lineData = {
    labels: monthlyTrend.map(([m]) => m),
    datasets: [
      { label: 'New Leads', data: monthlyTrend.map(([, v]) => v.new), borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
      { label: 'Sold', data: monthlyTrend.map(([, v]) => v.closed), borderColor: 'rgba(34,197,94,1)', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
    ],
  };

  const sourceRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    leads.filter((l) => l.status === 'sold' && l.sale_amount).forEach((l) => {
      const src = l.lead_source || 'Unknown';
      map[src] = (map[src] || 0) + (l.sale_amount || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [leads]);

  const revenueBarData = { labels: sourceRevenue.map(([s]) => s), datasets: [{ label: 'Revenue', data: sourceRevenue.map(([, v]) => v), backgroundColor: 'rgba(234,179,8,0.7)', borderRadius: 6 }] };

  const analyticsData = useMemo(() => ({
    totalLeads, closedCount: soldCount, conversionRate, avgDealSize,
    statusLabels, statusCounts: statusLabels.map((s) => statusCounts[s]), agentPerf, monthlyTrend, sourceRevenue,
  }), [totalLeads, soldCount, conversionRate, avgDealSize, statusLabels, statusCounts, agentPerf, monthlyTrend, sourceRevenue]);

  const handleExport = (format: 'excel' | 'pdf' | 'html') => {
    try {
      if (format === 'excel') exportAnalyticsAsExcel(analyticsData);
      else if (format === 'pdf') exportAnalyticsAsPDF(analyticsData);
      else exportAnalyticsAsHTML(analyticsData);
      toast.success('Export complete.');
    } catch {
      toast.error('Export failed.');
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 } } } }, scales: { x: { ticks: { font: { size: 10 } }, grid: { display: false } }, y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } } } };
  const doughnutOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' as const, labels: { font: { size: 11 }, boxWidth: 12 } } }, cutout: '60%' };

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between md:justify-end gap-3">
        <div className="md:hidden">
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug flex items-center gap-2"><BarChart3 className="w-6 h-6 text-primary" /> Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Company-wide lead and revenue analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]" onClick={() => handleExport('excel')} disabled={totalLeads === 0}><FileSpreadsheet className="w-4 h-4 text-success" /><span className="hidden sm:inline">Excel</span></Button>
          <Button variant="outline" className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]" onClick={() => handleExport('pdf')} disabled={totalLeads === 0}><FilePdf className="w-4 h-4 text-destructive" /><span className="hidden sm:inline">PDF</span></Button>
          <Button variant="outline" className="h-12 border-border gap-2 shrink-0 active:scale-[0.98]" onClick={() => handleExport('html')} disabled={totalLeads === 0}><FileText className="w-4 h-4 text-info" /><span className="hidden sm:inline">HTML</span></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Users className="w-4 h-4 text-primary" /></div><p className="text-xs text-muted-foreground">Total Leads</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{totalLeads}</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center"><Target className="w-4 h-4 text-success" /></div><p className="text-xs text-muted-foreground">Conversion Rate</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{conversionRate}%</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-warning" /></div><p className="text-xs text-muted-foreground">Avg Deal Size</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{avgDealSize.toLocaleString()}</p></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col"><CardContent className="p-4 flex flex-col flex-1"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-info" /></div><p className="text-xs text-muted-foreground">Sold</p></div><p className="text-2xl font-bold text-foreground tabular-nums">{soldCount}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Leads by Status</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64"><Doughnut data={doughnutData} options={doughnutOptions} /></div></CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Agent Performance</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64"><Bar data={agentBarData} options={chartOptions} /></div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Monthly Sales Trend</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64"><Line data={lineData} options={chartOptions} /></div></CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Revenue by Lead Source</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 flex-1 min-h-0"><div className="h-56 md:h-64"><Bar data={revenueBarData} options={chartOptions} /></div></CardContent>
        </Card>
      </div>
    </div>
  );
}
