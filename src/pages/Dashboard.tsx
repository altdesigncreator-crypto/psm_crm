import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import {
  Chart as ChartJS, ArcElement, Tooltip as ChartTooltip, Legend as ChartLegend,
  CategoryScale, LinearScale, BarElement,
} from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import {
  Users, PhoneCall, TrendingUp, Calendar, Trophy, Activity, Clock, ArrowUpRight,
  ChevronRight, Download, FileSpreadsheet, FileText as FileTextIcon, File as FilePdf,
  Footprints, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LEAD_STAGES, type Lead } from '@/types';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import StatusColorDialog from '@/components/StatusColorDialog';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import CheckInFeed from '@/components/CheckInFeed';
import { exportAsExcel, exportAsPDF, exportAsHTML } from '@/lib/exportUtils';
import { toast } from 'sonner';

ChartJS.register(ArcElement, ChartTooltip, ChartLegend, CategoryScale, LinearScale, BarElement);

const PIE_COLORS = ['hsl(208, 96%, 43%)', 'hsl(173, 58%, 39%)', 'hsl(197, 37%, 24%)', 'hsl(43, 74%, 66%)', 'hsl(280, 60%, 55%)'];

type DateFilter = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'levelA';

const FILTER_LABELS: Record<DateFilter, string> = {
  all: 'All', thisMonth: 'This Month', lastMonth: 'Last Month', thisYear: 'This Year', levelA: 'Grade A Only',
};

function formatNumber(num: number): string { return num.toLocaleString('en-US'); }

function filterLeadsByDate(leads: Lead[], filter: DateFilter): Lead[] {
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

export default function Dashboard() {
  const [rawLeads, setRawLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const { colors: statusColors, saveColors } = useStatusColors();
  const { nameOf } = useProfiles();

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
      if (!active) return;
      if (error) toast.error('Could not load dashboard data.');
      else setRawLeads((data || []) as Lead[]);
      setLoading(false);
    };
    load();
    const channel = supabase
      .channel('dashboard-leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const filteredLeads = useMemo(() => filterLeadsByDate(rawLeads, dateFilter), [rawLeads, dateFilter]);

  const totalLeads = filteredLeads.length;
  const followUpCount = filteredLeads.filter((l) => ['contacted', 'qualified', 'negotiation'].includes(l.status)).length;
  const soldLeads = filteredLeads.filter((l) => l.status === 'sold');
  const soldCount = soldLeads.length;
  const levelACount = filteredLeads.filter((l) => l.lead_grade === 'A').length;

  const totalRevenue = useMemo(() => soldLeads.reduce((sum, l) => sum + (l.sale_amount || 0), 0), [soldLeads]);

  const statusCounts = LEAD_STAGES.map((s) => filteredLeads.filter((l) => l.status === s.value).length);

  const topProjects = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLeads.forEach((l) => {
      const p = l.preferred_project || 'Unspecified';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filteredLeads]);

  const pieData = {
    labels: topProjects.map((p) => p[0]),
    datasets: [{ data: topProjects.map((p) => p[1]), backgroundColor: PIE_COLORS, borderWidth: 2, borderColor: '#ffffff' }],
  };

  const barData = {
    labels: LEAD_STAGES.map((s) => s.label),
    datasets: [{
      label: 'Leads', data: statusCounts,
      backgroundColor: LEAD_STAGES.map((s) => statusColors[s.value] || '#0463CA'),
      borderRadius: 6, borderSkipped: false,
    }],
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const pieOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { padding: isMobile ? 8 : 12, font: { size: isMobile ? 10 : 11, weight: 'bold' as const }, usePointStyle: true, boxWidth: isMobile ? 6 : 8 } },
      tooltip: { backgroundColor: 'rgba(10,37,64,0.92)', padding: isMobile ? 14 : 12, cornerRadius: 10, displayColors: true, titleFont: { size: isMobile ? 13 : 14, weight: 'bold' as const }, bodyFont: { size: isMobile ? 12 : 13 }, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 },
    },
    interaction: { mode: 'nearest' as const, intersect: true },
  };

  const barOptions = {
    indexAxis: 'y' as const, responsive: true, maintainAspectRatio: false,
    layout: { padding: { left: isMobile ? 4 : 8, right: isMobile ? 4 : 8, top: 4, bottom: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: 'rgba(0,0,0,0.88)', padding: isMobile ? 14 : 12, cornerRadius: 10, displayColors: true, titleFont: { size: isMobile ? 13 : 14, weight: 'bold' as const }, bodyFont: { size: isMobile ? 12 : 13 }, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 },
    },
    interaction: { mode: 'index' as const, intersect: false },
    scales: {
      x: { beginAtZero: true, ticks: { font: { size: isMobile ? 10 : 12, weight: 500 }, stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' } },
      y: { ticks: { font: { size: isMobile ? 11 : 13, weight: 500 } }, grid: { display: false } },
    },
  };

  const agentPerformance = useMemo(() => {
    const agents: Record<string, number> = {};
    for (const l of soldLeads) {
      const agent = nameOf(l.owner_id);
      agents[agent] = (agents[agent] || 0) + 1;
    }
    const sorted = Object.entries(agents).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = sorted[0]?.[1] || 1;
    return sorted.map(([name, count]) => ({ name, count, pct: Math.round((count / max) * 100) }));
  }, [soldLeads, nameOf]);

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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Executive overview of sales performance</p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          {(Object.keys(FILTER_LABELS) as DateFilter[]).map((key) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                dateFilter === key ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={filteredLeads.length === 0} className="h-9 gradient-primary hover:gradient-primary-hover text-white text-sm font-medium gap-2 px-3">
                <Download className="w-4 h-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-lg border-border p-1">
              <DropdownMenuItem onClick={() => exportAsExcel(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FileSpreadsheet className="w-5 h-5 shrink-0" /> <span>Export as Excel</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsPDF(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FilePdf className="w-5 h-5 shrink-0" /> <span>Export as PDF</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsHTML(exportableLeads)} className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors">
                <FileTextIcon className="w-5 h-5 shrink-0" /> <span>Export as HTML</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="flex md:grid md:grid-cols-2 lg:grid-cols-5 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Total Leads</p><p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{totalLeads}</p></div>
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Users className="w-4 h-4 text-primary" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Follow Up</p><p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{followUpCount}</p></div>
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><PhoneCall className="w-4 h-4 text-amber-500" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Grade A</p><p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{levelACount}</p></div>
              <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4 text-destructive" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Sold</p><p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{soldCount}</p></div>
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-4 h-4 text-emerald-500" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[180px] md:min-w-0 snap-start flex-1 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full pointer-events-none" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Revenue</p>
                <p className="text-lg md:text-2xl font-bold text-foreground mt-0.5">{formatNumber(totalRevenue)}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4 text-primary" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="flex md:grid md:grid-cols-2 gap-4 md:gap-6 overflow-x-auto md:overflow-visible pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[92vw] md:min-w-0 snap-start flex-shrink-0 md:flex-shrink">
          <CardContent className="p-5 md:p-6">
            <h3 className="text-base font-semibold mb-4">Leads by Project</h3>
            <div className="min-h-[220px] h-56 md:h-72"><Pie data={pieData} options={pieOptions} /></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[92vw] md:min-w-0 snap-start flex-shrink-0 md:flex-shrink">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Leads by Status</h3>
              <StatusColorDialog colors={statusColors} onSave={saveColors} />
            </div>
            <div className="min-h-[220px] h-56 md:h-72"><Bar data={barData} options={barOptions} /></div>
          </CardContent>
        </Card>
      </div>

      {/* Check-In Feed */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Footprints className="w-4 h-4 text-primary" /></div>
            <h3 className="text-base font-semibold">Today's Field Activity</h3>
          </div>
          <CheckInFeed />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Trophy className="w-4 h-4 text-primary" /></div>
              <h3 className="text-base font-semibold">Agent Performance</h3>
            </div>
            {agentPerformance.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Trophy className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No sales recorded yet for this period.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {agentPerformance.map((agent, idx) => (
                  <div key={agent.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{idx + 1}</div>
                        <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-primary">{agent.count} sold</span>
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
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Activity className="w-4 h-4 text-primary" /></div>
              <h3 className="text-base font-semibold">Recent Activity</h3>
            </div>
            {activityFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No activity yet.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {activityFeed.map((lead, idx) => {
                  const timeStr = new Date(lead.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  const isLast = idx === activityFeed.length - 1;
                  return (
                    <div key={lead.id} className={`flex gap-4 py-3 ${!isLast ? 'border-b border-border' : ''}`}>
                      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                        {!isLast && <div className="w-px flex-1 bg-border min-h-[20px]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground leading-snug">
                          {nameOf(lead.owner_id)} added a new lead for <span className="text-primary">{lead.name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                          <Calendar className="w-3 h-3" /> {timeStr}
                          <ChevronRight className="w-3 h-3 mx-0.5" />
                          <LeadLevelBadge grade={lead.lead_grade} />
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border"
                            style={{ backgroundColor: `${statusColors[lead.status] || '#8FA3BF'}20`, color: statusColors[lead.status] || '#8FA3BF', borderColor: `${statusColors[lead.status] || '#8FA3BF'}40` }}
                          >
                            {LEAD_STAGES.find((s) => s.value === lead.status)?.label}
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
