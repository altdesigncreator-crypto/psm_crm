import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent } from '@/components/ui/card';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip as ChartTooltip,
  Legend as ChartLegend,
  CategoryScale,
  LinearScale,
  BarElement,
} from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import {
  Users,
  PhoneCall,
  CheckCircle2,
  TrendingUp,
  Calendar,
  Trophy,
  Activity,
  Clock,
  ArrowUpRight,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText as FileTextIcon,
  File as FilePdf,
  Footprints,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { STATUSES, type Lead } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { filterVisibleLeads } from '@/lib/roleUtils';
import { useStatusColors } from '@/hooks/useStatusColors';
import StatusColorDialog from '@/components/StatusColorDialog';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import CheckInFeed from '@/components/CheckInFeed';
import { exportAsExcel, exportAsPDF, exportAsHTML } from '@/lib/exportUtils';
import { toast } from 'sonner';

ChartJS.register(ArcElement, ChartTooltip, ChartLegend, CategoryScale, LinearScale, BarElement);

const PIE_COLORS = [
  'hsl(208, 96%, 43%)',
  'hsl(173, 58%, 39%)',
  'hsl(197, 37%, 24%)',
  'hsl(43, 74%, 66%)',
];

type DateFilter = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'levelA';

const FILTER_LABELS: Record<DateFilter, string> = {
  all: 'အားလုံး',
  thisMonth: 'ယခုလ',
  lastMonth: 'ယခင်လ',
  thisYear: 'ယခုနှစ်',
  levelA: 'Level A Only',
};

function getDateFromLead(l: Lead): Date | null {
  if (!l.createdAt) return null;
  if (l.createdAt instanceof Timestamp) return l.createdAt.toDate();
  if (typeof l.createdAt === 'object' && 'seconds' in l.createdAt) {
    return new Timestamp((l.createdAt as any).seconds, (l.createdAt as any).nanoseconds || 0).toDate();
  }
  return new Date(l.createdAt);
}

function parseBudget(budgetRange?: string): number {
  if (!budgetRange) return 0;
  if (budgetRange.includes('၁၀၀၀ အောက်')) return 500;
  if (budgetRange.includes('၁၀၀၀ မှ ၃၀၀၀')) return 2000;
  if (budgetRange.includes('၃၀၀၀ မှ ၅၀၀၀')) return 4000;
  if (budgetRange.includes('၅၀၀၀ မှ ၁၀၀၀၀')) return 7500;
  if (budgetRange.includes('၁၀၀၀၀ အထက်')) return 15000;
  return 0;
}

function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

function filterLeadsByDate(leads: Lead[], filter: DateFilter): Lead[] {
  if (filter === 'levelA') return leads.filter((l) => l.leadLevel === 'Level A (Hot/Ready)');
  if (filter === 'all') return leads;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return leads.filter((l) => {
    const d = getDateFromLead(l);
    if (!d) return false;
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
  const { user, role } = useAuth();
  const [rawLeads, setRawLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const { colors: statusColors, saveColors } = useStatusColors();

  // ✅ REAL-TIME SNAPSHOT SYNC WITH FIREBASE (Replaces potentially blocking offline hooks)
  useEffect(() => {
    const q = query(collection(db, 'leads'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setRawLeads(data);
        setLoading(false);
      },
      (error) => {
        console.error("Dashboard database listener error:", error);
        toast.error("ဒေတာအသစ်များ ရယူရန် အဆင်မပြေဖြစ်နေပါသည်");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // ✅ DEFENSIBLY FILTER LEADS BASED ON ROLE MATRIX ACCESS
  const leads: Lead[] = useMemo(() => {
    if (!rawLeads || rawLeads.length === 0) return [];
    return role ? filterVisibleLeads(rawLeads, role, user?.email) : rawLeads;
  }, [rawLeads, role, user?.email]);

  const filteredLeads = useMemo(() => filterLeadsByDate(leads, dateFilter), [leads, dateFilter]);

  const totalLeads = filteredLeads.length;
  const followUpCount = filteredLeads.filter(
    (l) => l.status === 'Contacted' || l.status === 'Follow Up'
  ).length;
  const wonLeads = filteredLeads.filter((l) => l.status === 'Success' || l.status === 'Won');
  const wonCount = wonLeads.length;
  const levelACount = filteredLeads.filter((l) => l.leadLevel === 'Level A (Hot/Ready)').length;

  const estimatedSales = useMemo(
    () => wonLeads.reduce((sum, l) => sum + parseBudget(l.budgetRange), 0),
    [wonLeads]
  );

  const statusCounts = STATUSES.map((s) => filteredLeads.filter((l) => l.status === s).length);

  const topProjects = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLeads.forEach((l) => {
      const p = l.preferredProject || 'မသိရသေးပါ';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [filteredLeads]);

  const pieData = {
    labels: topProjects.map((p) => p[0]),
    datasets: [
      {
        data: topProjects.map((p) => p[1]),
        backgroundColor: PIE_COLORS,
        borderWidth: 2,
        borderColor: '#ffffff',
      },
    ],
  };

  const STATUS_LABELS_EN = ['New', 'Contacted', 'Site Viewing', 'Negotiation', 'Won', 'Lost'];

  const barData = {
    labels: STATUS_LABELS_EN,
    datasets: [
      {
        label: 'Leads',
        data: statusCounts,
        backgroundColor: STATUSES.map((s) => statusColors[s] || '#0463CA'),
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          padding: isMobile ? 8 : 12,
          font: { size: isMobile ? 10 : 11, weight: 'bold' as const },
          usePointStyle: true,
          boxWidth: isMobile ? 6 : 8,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(10,37,64,0.92)',
        padding: isMobile ? 14 : 12,
        cornerRadius: 10,
        displayColors: true,
        titleFont: { size: isMobile ? 13 : 14, weight: 'bold' as const },
        bodyFont: { size: isMobile ? 12 : 13 },
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
      },
    },
    interaction: {
      mode: 'nearest' as const,
      intersect: true,
    },
  };

  const barOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: { left: isMobile ? 4 : 8, right: isMobile ? 4 : 8, top: 4, bottom: 4 },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0,0,0,0.88)',
        padding: isMobile ? 14 : 12,
        cornerRadius: 10,
        displayColors: true,
        titleFont: { size: isMobile ? 13 : 14, weight: 'bold' as const },
        bodyFont: { size: isMobile ? 12 : 13 },
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { font: { size: isMobile ? 10 : 12, family: "'Inter', 'Noto Sans Myanmar', sans-serif", weight: 500 }, stepSize: 1 },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
      y: {
        ticks: {
          font: { size: isMobile ? 11 : 13, family: "'Inter', 'Noto Sans Myanmar', sans-serif", weight: 500 },
        },
        grid: { display: false },
      },
    },
  };

  const agentPerformance = useMemo(() => {
    const agents: Record<string, number> = {};
    for (const l of wonLeads) {
      const agent = l.assignedAgent || 'မခန့်ထားပါ';
      agents[agent] = (agents[agent] || 0) + 1;
    }
    const sorted = Object.entries(agents)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const max = sorted[0]?.[1] || 1;
    return sorted.map(([name, count]) => ({ name, count, pct: Math.round((count / max) * 100) }));
  }, [wonLeads]);

  const activityFeed = useMemo(() => {
    return [...filteredLeads]
      .sort((a, b) => {
        const da = getDateFromLead(a)?.getTime() || 0;
        const db = getDateFromLead(b)?.getTime() || 0;
        return db - da;
      })
      .slice(0, 5);
  }, [filteredLeads]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header Row */}
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
                dateFilter === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={filteredLeads.length === 0}
                className="h-9 gradient-primary hover:gradient-primary-hover text-white text-sm font-medium gap-2 px-3"
              >
                <Download className="w-4 h-4" />
                ထုတ်ယူရန်
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 rounded-xl shadow-lg border-border p-1"
            >
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsExcel(filteredLeads);
                      resolve();
                    }),
                    { loading: 'Excel ဖိုင် ပြင်ဆင်နေသည်...', success: 'Excel ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors"
              >
                <FileSpreadsheet className="w-5 h-5 shrink-0" />
                <span>Excel ဖိုင်ဖြင့် ထုတ်ရန်</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsPDF(filteredLeads);
                      resolve();
                    }),
                    { loading: 'PDF ဖိုင် ပြင်ဆင်နေသည်...', success: 'PDF ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors"
              >
                <FilePdf className="w-5 h-5 shrink-0" />
                <span>PDF ဖိုင်ဖြင့် ထုတ်ရန်</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsHTML(filteredLeads);
                      resolve();
                    }),
                    { loading: 'HTML ဖိုင် ပြင်ဆင်နေသည်...', success: 'HTML ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-3 rounded-lg px-3 py-3.5 text-sm cursor-pointer transition-colors"
              >
                <FileTextIcon className="w-5 h-5 shrink-0" />
                <span>HTML ဖိုင်ဖြင့် ထုတ်ရန်</span>
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
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">စုစုပေါင်း Leads</p>
                <p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{totalLeads}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Follow Up</p>
                <p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{followUpCount}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <PhoneCall className="w-4 h-4 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Level A</p>
                <p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{levelACount}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[160px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">ရောင်းချပြီး</p>
                <p className="text-xl md:text-2xl font-bold text-foreground mt-0.5">{wonCount}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-300 rounded-xl border-0 min-w-[180px] md:min-w-0 snap-start flex-1 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full pointer-events-none" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">ခန့်မှန်းရောင်းရငွေ</p>
                <p className="text-lg md:text-2xl font-bold text-foreground mt-0.5">
                  {formatNumber(estimatedSales)}
                  <span className="text-xs font-medium text-muted-foreground ml-1">သိန်း</span>
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="flex md:grid md:grid-cols-2 gap-4 md:gap-6 overflow-x-auto md:overflow-visible pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[92vw] md:min-w-0 snap-start flex-shrink-0 md:flex-shrink">
          <CardContent className="p-5 md:p-6">
            <h3 className="text-base font-semibold mb-4">Project အလိုက် Lead များ</h3>
            <div className="min-h-[220px] h-56 md:h-72">
              <Pie data={pieData} options={pieOptions} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card rounded-xl border-0 min-w-[92vw] md:min-w-0 snap-start flex-shrink-0 md:flex-shrink">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Leads by Status</h3>
              <StatusColorDialog colors={statusColors} onSave={saveColors} />
            </div>
            <div className="min-h-[220px] h-56 md:h-72">
              <Bar data={barData} options={barOptions} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Check-In Feed */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Footprints className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-base font-semibold">ယနေ့ မြေပြင်လှုပ်ရှားမှုများ</h3>
          </div>
          <CheckInFeed />
        </CardContent>
      </Card>

      {/* Bottom Row: Leaderboard + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Agent Leaderboard */}
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Trophy className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-base font-semibold">ဝန်ထမ်းများ၏ စွမ်းဆောင်ရည်</h3>
            </div>
            {agentPerformance.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Trophy className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">ဒီအချိန်မှာ ရောင်းချမှတ်တမ်းမရှိသေးပါ</p>
              </div>
            ) : (
              <div className="space-y-5">
                {agentPerformance.map((agent, idx) => (
                  <div key={agent.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </div>
                        <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-primary">{agent.count} အောင်မြင်</span>
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                      </div>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${agent.pct}%`,
                          background: 'linear-gradient(90deg, #0463CA 0%, #0487E2 100%)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-base font-semibold">နောက်ဆုံး လုပ်ဆောင်ချက်များ</h3>
            </div>
            {activityFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">မှတ်တမ်းမရှိသေးပါ</p>
              </div>
            ) : (
              <div className="space-y-0">
                {activityFeed.map((lead, idx) => {
                  const date = getDateFromLead(lead);
                  const timeStr = date
                    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '';
                  const isLast = idx === activityFeed.length - 1;
                  return (
                    <div key={lead.id} className={`flex gap-4 py-3 ${!isLast ? 'border-b border-border' : ''}`}>
                      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                        {!isLast && <div className="w-px flex-1 bg-border min-h-[20px]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground leading-snug">
                          {lead.assignedAgent || 'အမည်မသိ'} ၊ <span className="text-primary">{lead.name}</span> အတွက် Lead အသစ်ထည့်ခဲ့သည်
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                          <Calendar className="w-3 h-3" />
                          {timeStr}
                          <ChevronRight className="w-3 h-3 mx-0.5" />
                          <LeadLevelBadge level={lead.leadLevel} />
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border"
                            style={{
                              backgroundColor: `${statusColors[lead.status] || '#8FA3BF'}20`,
                              color: statusColors[lead.status] || '#8FA3BF',
                              borderColor: `${statusColors[lead.status] || '#8FA3BF'}40`,
                            }}
                          >
                            {lead.status}
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