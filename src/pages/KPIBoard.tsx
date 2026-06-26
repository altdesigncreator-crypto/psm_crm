import React, { useEffect, useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { isManagement, getDepartment, isAdmin, filterVisibleLeads } from '@/lib/roleUtils';
import { useOfflineCollection } from '@/hooks/useOfflineCollection';
import { exportKPIAsExcel, exportKPIAsPDF } from '@/lib/exportUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Trophy,
  Users,
  Footprints,
  TrendingUp,
  Target,
  ArrowUpRight,
  BarChart3,
  Eye,
  Home,
  Building2,
  Briefcase,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { type Lead } from '@/types';

interface AgentStats {
  email: string;
  totalLeads: number;
  totalCheckins: number;
  levelACount: number;
  levelBCount: number;
  levelCCount: number;
}

interface DeptStats {
  department: string;
  displayName: string;
  icon: React.ReactNode;
  totalLeads: number;
  levelACount: number;
  checkinCount: number;
  agentCount: number;
}

const DEPT_COLORS: Record<string, string> = {
  house: 'bg-amber-500',
  condo: 'bg-sky-500',
  project: 'bg-emerald-500',
};

const DEPT_BG: Record<string, string> = {
  house: 'bg-amber-50 dark:bg-amber-900/20',
  condo: 'bg-sky-50 dark:bg-sky-900/20',
  project: 'bg-emerald-50 dark:bg-emerald-900/20',
};

const DEPT_TEXT: Record<string, string> = {
  house: 'text-amber-600 dark:text-amber-400',
  condo: 'text-sky-600 dark:text-sky-400',
  project: 'text-emerald-600 dark:text-emerald-400',
};

function getAgentEmail(lead: Lead): string {
  return (lead as any).agentName || lead.assignedAgent || 'မခန့်ထားပါ';
}

export default function KPIBoard() {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const userDept = getDepartment(role);
  const isAdminUser = isAdmin(role);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [checkins, setCheckins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState<string>('all');

  // Management-only access guard
  if (!isManagement(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">ဤစာမျက်နှာကို Boss အကောင့်ဖြင့်သာ ဝင်ရောက်နိုင်ပါသည်</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Dashboard သို့ ပြန်သွားရန်
        </Button>
      </div>
    );
  }

  // Role-filtered leads with IndexedDB offline fallback
  const [visibleLeads, leadsLoading] = useOfflineCollection<Lead>(
    'leads',
    role,
    userDept,
    user?.email,
    (raw) => filterVisibleLeads(raw, role, user?.email)
  );

  // Check-ins with role-based visibility and offline fallback
  const [visibleCheckins, checkinsLoading] = useOfflineCollection<any>(
    'checkins',
    role,
    userDept,
    user?.email,
    (raw) => {
      if (isAdminUser) return raw;
      return raw.filter((c: any) => {
        if (!c.ownerId) return true; // legacy checkins
        if (c.ownerId === user?.uid) return true;
        if (c.department) return c.department === userDept;
        return false;
      });
    }
  );

  useEffect(() => {
    setLeads(visibleLeads);
    setCheckins(visibleCheckins);
    setLoading(leadsLoading || checkinsLoading);
  }, [visibleLeads, visibleCheckins, leadsLoading, checkinsLoading]);

  // ── Department-level stats ───────────────────────────────────────────
  const departmentStats = useMemo<DeptStats[]>(() => {
    const deptMap: Record<string, DeptStats> = {};
    const deptNames: Record<string, string> = {
      house: 'အိမ်ရာ',
      condo: 'ကွန်ဒို',
      project: 'ပရောဂျက်',
    };
    const deptIcons: Record<string, React.ReactNode> = {
      house: <Home className="w-4 h-4" />,
      condo: <Building2 className="w-4 h-4" />,
      project: <Briefcase className="w-4 h-4" />,
    };

    // Initialize all 3 departments with zeros
    ['house', 'condo', 'project'].forEach((dept) => {
      deptMap[dept] = {
        department: dept,
        displayName: deptNames[dept] || dept,
        icon: deptIcons[dept] || null,
        totalLeads: 0,
        levelACount: 0,
        checkinCount: 0,
        agentCount: 0,
      };
    });

    // Aggregate leads by department
    const agentsInDept: Record<string, Set<string>> = {};
    ['house', 'condo', 'project'].forEach((d) => (agentsInDept[d] = new Set()));

    leads.forEach((lead) => {
      const dept = (lead.department || 'house').toLowerCase();
      if (!deptMap[dept]) return;
      deptMap[dept].totalLeads += 1;
      if (lead.leadLevel === 'Level A (Hot/Ready)') deptMap[dept].levelACount += 1;
      const agent = getAgentEmail(lead);
      if (agent) agentsInDept[dept].add(agent);
    });

    // Aggregate check-ins by department
    checkins.forEach((c) => {
      const dept = (c.department || 'house').toLowerCase();
      if (!deptMap[dept]) return;
      deptMap[dept].checkinCount += 1;
      const agent = c.agentName || c.userId;
      if (agent) agentsInDept[dept].add(agent);
    });

    // Set agent counts
    ['house', 'condo', 'project'].forEach((dept) => {
      deptMap[dept].agentCount = agentsInDept[dept].size;
    });

    return ['house', 'condo', 'project'].map((d) => deptMap[d]).filter((d) => d.totalLeads > 0 || d.checkinCount > 0);
  }, [leads, checkins]);

  // ── Agent stats (filtered by department if selected) ──────────────────
  const agentStats = useMemo<AgentStats[]>(() => {
    const statsMap: Record<string, AgentStats> = {};

    // Aggregate from leads
    leads.forEach((lead) => {
      const email = getAgentEmail(lead);
      if (!statsMap[email]) {
        statsMap[email] = {
          email,
          totalLeads: 0,
          totalCheckins: 0,
          levelACount: 0,
          levelBCount: 0,
          levelCCount: 0,
        };
      }
      statsMap[email].totalLeads += 1;
      if (lead.leadLevel === 'Level A (Hot/Ready)') statsMap[email].levelACount += 1;
      if (lead.leadLevel === 'Level B (Warm/Considering)') statsMap[email].levelBCount += 1;
      if (lead.leadLevel === 'Level C (Cold/Inquiring)') statsMap[email].levelCCount += 1;
    });

    // Aggregate from check-ins
    checkins.forEach((c) => {
      const email = c.agentName || c.userId || 'မခန့်ထားပါ';
      if (!statsMap[email]) {
        statsMap[email] = {
          email,
          totalLeads: 0,
          totalCheckins: 0,
          levelACount: 0,
          levelBCount: 0,
          levelCCount: 0,
        };
      }
      statsMap[email].totalCheckins += 1;
    });

    const agents = Object.values(statsMap);
    // Sort by: Level A count desc, then total leads desc, then check-ins desc
    agents.sort((a, b) => {
      if (b.levelACount !== a.levelACount) return b.levelACount - a.levelACount;
      if (b.totalLeads !== a.totalLeads) return b.totalLeads - a.totalLeads;
      return b.totalCheckins - a.totalCheckins;
    });

    // Filter by department if selected
    if (deptFilter !== 'all') {
      // Build agent→department mapping from leads + checkins
      const agentDeptMap: Record<string, string> = {};
      leads.forEach((l) => {
        const email = getAgentEmail(l);
        if (l.department) agentDeptMap[email] = l.department.toLowerCase();
      });
      checkins.forEach((c) => {
        const email = c.agentName || c.userId || '';
        if (c.department) agentDeptMap[email] = c.department.toLowerCase();
      });
      return agents.filter((a) => agentDeptMap[a.email] === deptFilter);
    }

    return agents;
  }, [leads, checkins, deptFilter]);

  const topAgent = agentStats[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">KPI Board</h1>
            <p className="text-sm text-muted-foreground mt-0.5">ဝန်ထမ်းများ၏ အရောင်းစွမ်းဆောင်ရည် စာရင်း</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {topAgent && (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
              <Trophy className="w-4 h-4 text-warning" />
              <span className="text-xs font-medium text-warning">
                အကောင်းဆုံး — {topAgent.email} (Level A: {topAgent.levelACount})
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-12 gap-2 text-sm font-medium active:bg-muted/30"
            onClick={() => exportKPIAsExcel(agentStats, departmentStats)}
            disabled={agentStats.length === 0}
          >
            <FileSpreadsheet className="w-5 h-5" />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-12 gap-2 text-sm font-medium active:bg-muted/30"
            onClick={() => exportKPIAsPDF(agentStats, departmentStats)}
            disabled={agentStats.length === 0}
          >
            <FileText className="w-5 h-5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Summary Cards — horizontal scroll on mobile */}
      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{leads.length}</p>
              <p className="text-xs text-muted-foreground">စုစုပေါင်း Leads</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {leads.filter((l) => l.leadLevel === 'Level A (Hot/Ready)').length}
              </p>
              <p className="text-xs text-muted-foreground">Level A Leads</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Footprints className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{checkins.length}</p>
              <p className="text-xs text-muted-foreground">စုစုပေါင်း Check-ins</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Department Performance Cards */}
      {departmentStats.length > 0 && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              ဌာနအားလုံး စွမ်းဆောင်ရည်
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex md:grid md:grid-cols-3 gap-3 p-4 md:p-5 overflow-x-auto md:overflow-visible snap-x snap-mandatory">
              {departmentStats.map((dept) => (
                <button
                  key={dept.department}
                  type="button"
                  onClick={() => setDeptFilter(deptFilter === dept.department ? 'all' : dept.department)}
                  className={`text-left rounded-xl border p-4 min-w-[180px] md:min-w-0 snap-start flex-1 transition-all duration-200 hover:shadow-md active:scale-[0.99] ${
                    deptFilter === dept.department
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${DEPT_BG[dept.department]} ${DEPT_TEXT[dept.department]}`}>
                      {dept.icon}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{dept.displayName}</p>
                    {deptFilter === dept.department && (
                      <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary text-white">
                        Filtered
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-lg font-bold text-foreground">{dept.totalLeads}</p>
                      <p className="text-[10px] text-muted-foreground">Leads</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{dept.levelACount}</p>
                      <p className="text-[10px] text-muted-foreground">Level A</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{dept.checkinCount}</p>
                      <p className="text-[10px] text-muted-foreground">Check-ins</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{dept.agentCount}</p>
                      <p className="text-[10px] text-muted-foreground">ဝန်ထမ်းများ</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Performance Cards */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-primary" />
            </div>
            ဝန်ထမ်းတစ်ဦးချင်း စွမ်းဆောင်ရည်
            {deptFilter !== 'all' && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                · {departmentStats.find((d) => d.department === deptFilter)?.displayName || deptFilter} department only
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {agentStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Trophy className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">မှတ်တမ်းမရှိသေးပါ</p>
              <p className="text-xs mt-1">Lead နှင့် Check-in များထည့်သွင်းရပါမည်</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agentStats.map((agent, idx) => (
                <div
                  key={agent.email}
                  className="flex flex-col md:flex-row md:items-center gap-3 p-4 md:p-5 min-h-[80px] transition-colors active:bg-muted/50 hover:bg-muted/30 group"
                >
                  {/* Rank + Info */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0
                          ? 'bg-warning text-white'
                          : idx === 1
                            ? 'bg-muted text-foreground'
                            : idx === 2
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{agent.email}</p>
                      <p className="text-xs text-muted-foreground">{agent.totalLeads} leads added</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/agent/${encodeURIComponent(agent.email)}`)}
                      className="md:hidden w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all shrink-0"
                      aria-label="Agent ကြည့်ရန်"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Stats — full width on mobile */}
                  <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-3 gap-2 md:gap-3">
                      {/* Total Leads */}
                      <div className="bg-primary/5 rounded-lg p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 mb-0.5">
                          <Users className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-medium text-primary">Leads</span>
                        </div>
                        <p className="text-lg font-bold text-foreground">{agent.totalLeads}</p>
                      </div>
                      {/* Check-ins */}
                      <div className="bg-success/5 rounded-lg p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 mb-0.5">
                          <Footprints className="w-3.5 h-3.5 text-success" />
                          <span className="text-xs font-medium text-success">Check-ins</span>
                        </div>
                        <p className="text-lg font-bold text-foreground">{agent.totalCheckins}</p>
                      </div>
                      {/* Level A */}
                      <div className="bg-destructive/5 rounded-lg p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 mb-0.5">
                          <TrendingUp className="w-3.5 h-3.5 text-destructive" />
                          <span className="text-xs font-medium text-destructive">Level A</span>
                        </div>
                        <p className="text-lg font-bold text-foreground">{agent.levelACount}</p>
                      </div>
                    </div>
                  </div>

                  {/* Level Breakdown Bar */}
                  <div className="shrink-0 w-full md:w-40">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Level Breakdown</span>
                      <span className="flex items-center gap-0.5">
                        <ArrowUpRight className="w-3.5 h-3.5 text-success" />
                        {agent.levelACount > 0 ? 'Active' : '—'}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full overflow-hidden flex">
                      {agent.totalLeads > 0 && (
                        <>
                          <div className="h-full bg-destructive" style={{ width: `${(agent.levelACount / agent.totalLeads) * 100}%` }} />
                          <div className="h-full bg-warning" style={{ width: `${(agent.levelBCount / agent.totalLeads) * 100}%` }} />
                          <div className="h-full bg-muted-foreground/30" style={{ width: `${(agent.levelCCount / agent.totalLeads) * 100}%` }} />
                        </>
                      )}
                      {agent.totalLeads === 0 && <div className="h-full w-full bg-muted" />}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-destructive" />
                        A:{agent.levelACount}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-warning" />
                        B:{agent.levelBCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                        C:{agent.levelCCount}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
