import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useProfiles';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { isExec, getDepartmentLabel, type Department } from '@/lib/permissions';
import { exportKPIAsExcel, exportKPIAsPDF } from '@/lib/exportUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import NameLink from '@/components/NameLink';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trophy, Users, Footprints, TrendingUp, Target, ArrowUpRight, BarChart3, Eye,
  Building2, FileSpreadsheet, FileText,
} from 'lucide-react';
import type { Lead, CheckIn } from '@/types';

interface AgentStats {
  id: string;
  name: string;
  totalLeads: number;
  totalCheckins: number;
  soldCount: number;
  totalRevenue: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
}

interface DeptStats {
  department: Department;
  totalLeads: number;
  gradeACount: number;
  checkinCount: number;
  agentCount: number;
}

// Departments are dynamic (see useDepartments) so we can't map a fixed
// icon/color per code — cycle a small palette by position instead.
const DEPT_PALETTE = [
  { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600 dark:text-amber-400' },
  { bg: 'bg-sky-50 dark:bg-sky-900/20', text: 'text-sky-600 dark:text-sky-400' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-600 dark:text-emerald-400' },
  { bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-600 dark:text-rose-400' },
];

export default function KPIBoard() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { nameOf } = useProfiles();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState<string>('all');
  usePageHeader('KPI Board', 'Sales performance leaderboard');

  useEffect(() => {
    if (!isExec(role)) return;
    (async () => {
      const [leadsRes, checkinsRes] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('check_ins').select('*'),
      ]);
      setLeads((leadsRes.data || []) as Lead[]);
      setCheckins((checkinsRes.data || []) as CheckIn[]);
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

  const departmentStats = useMemo<DeptStats[]>(() => {
    const map: Record<string, DeptStats> = {};
    const agentsInDept: Record<string, Set<string>> = {};
    const ensure = (d: string) => {
      if (!map[d]) { map[d] = { department: d, totalLeads: 0, gradeACount: 0, checkinCount: 0, agentCount: 0 }; agentsInDept[d] = new Set(); }
      return map[d];
    };

    leads.forEach((l) => {
      const stat = ensure(l.department_code);
      stat.totalLeads += 1;
      if (l.lead_grade === 'A') stat.gradeACount += 1;
      if (l.owner_id) agentsInDept[l.department_code].add(l.owner_id);
    });
    checkins.forEach((c) => {
      ensure(c.department_code).checkinCount += 1;
      agentsInDept[c.department_code].add(c.employee_id);
    });
    Object.keys(map).forEach((d) => { map[d].agentCount = agentsInDept[d].size; });

    return Object.values(map).sort((a, b) => a.department.localeCompare(b.department));
  }, [leads, checkins]);

  const agentStats = useMemo<AgentStats[]>(() => {
    const map: Record<string, AgentStats> = {};
    const ensure = (id: string) => {
      if (!map[id]) map[id] = { id, name: nameOf(id), totalLeads: 0, totalCheckins: 0, soldCount: 0, totalRevenue: 0, gradeA: 0, gradeB: 0, gradeC: 0 };
      return map[id];
    };

    leads.forEach((l) => {
      if (!l.owner_id) return;
      if (deptFilter !== 'all' && l.department_code !== deptFilter) return;
      const s = ensure(l.owner_id);
      s.totalLeads += 1;
      if (l.lead_grade === 'A') s.gradeA += 1;
      if (l.lead_grade === 'B') s.gradeB += 1;
      if (l.lead_grade === 'C') s.gradeC += 1;
      if (l.status === 'sold') { s.soldCount += 1; s.totalRevenue += l.sale_amount || 0; }
    });
    checkins.forEach((c) => {
      if (deptFilter !== 'all' && c.department_code !== deptFilter) return;
      ensure(c.employee_id).totalCheckins += 1;
    });

    return Object.values(map).sort((a, b) => (b.gradeA - a.gradeA) || (b.totalLeads - a.totalLeads) || (b.totalCheckins - a.totalCheckins));
  }, [leads, checkins, deptFilter, nameOf]);

  const topAgent = agentStats[0];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0 flex-1 md:hidden"><h1 className="text-xl md:text-2xl font-bold text-foreground">KPI Board</h1><p className="text-sm text-muted-foreground mt-0.5">Sales performance leaderboard</p></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {topAgent && (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
              <Trophy className="w-4 h-4 text-warning" /><span className="text-xs font-medium text-warning">Top performer — <NameLink id={topAgent.id} name={topAgent.name} showAvatar={false} className="text-warning" /> (Grade A: {topAgent.gradeA})</span>
            </div>
          )}
          <Button variant="outline" size="sm" className="h-12 gap-2 text-sm font-medium active:bg-muted/30" onClick={() => exportKPIAsExcel(agentStats, departmentStats.map((d) => ({ displayName: getDepartmentLabel(d.department), totalLeads: d.totalLeads, soldCount: 0, checkinCount: d.checkinCount, agentCount: d.agentCount })))} disabled={agentStats.length === 0}>
            <FileSpreadsheet className="w-5 h-5" /> Excel
          </Button>
          <Button variant="outline" size="sm" className="h-12 gap-2 text-sm font-medium active:bg-muted/30" onClick={() => exportKPIAsPDF(agentStats, departmentStats.map((d) => ({ displayName: getDepartmentLabel(d.department), totalLeads: d.totalLeads, soldCount: 0, checkinCount: d.checkinCount, agentCount: d.agentCount })))} disabled={agentStats.length === 0}>
            <FileText className="w-5 h-5" /> PDF
          </Button>
        </div>
      </div>

      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold text-foreground tabular-nums">{leads.length}</p><p className="text-xs text-muted-foreground">Total Leads</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><Target className="w-5 h-5 text-destructive" /></div>
            <div><p className="text-2xl font-bold text-foreground tabular-nums">{leads.filter((l) => l.lead_grade === 'A').length}</p><p className="text-xs text-muted-foreground">Grade A Leads</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><Footprints className="w-5 h-5 text-success" /></div>
            <div><p className="text-2xl font-bold text-foreground tabular-nums">{checkins.length}</p><p className="text-xs text-muted-foreground">Total Check-ins</p></div>
          </CardContent>
        </Card>
      </div>

      {departmentStats.length > 0 && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-primary" /></div>Department Performance</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="flex md:grid md:grid-cols-3 gap-3 p-4 md:p-5 overflow-x-auto md:overflow-visible snap-x snap-mandatory">
              {departmentStats.map((dept, idx) => {
                const palette = DEPT_PALETTE[idx % DEPT_PALETTE.length];
                return (
                <button key={dept.department} type="button" onClick={() => setDeptFilter(deptFilter === dept.department ? 'all' : dept.department)} className={`text-left rounded-xl border p-4 min-w-[180px] md:min-w-0 snap-start flex-1 transition-all duration-200 hover:shadow-md active:scale-[0.99] ${deptFilter === dept.department ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted/40'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${palette.bg} ${palette.text}`}><Building2 className="w-4 h-4" /></div>
                    <p className="text-sm font-semibold text-foreground">{getDepartmentLabel(dept.department)}</p>
                    {deptFilter === dept.department && <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary text-white">Filtered</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-lg font-bold text-foreground tabular-nums">{dept.totalLeads}</p><p className="text-[10px] text-muted-foreground">Leads</p></div>
                    <div><p className="text-lg font-bold text-foreground tabular-nums">{dept.gradeACount}</p><p className="text-[10px] text-muted-foreground">Grade A</p></div>
                    <div><p className="text-lg font-bold text-foreground tabular-nums">{dept.checkinCount}</p><p className="text-[10px] text-muted-foreground">Check-ins</p></div>
                    <div><p className="text-lg font-bold text-foreground tabular-nums">{dept.agentCount}</p><p className="text-[10px] text-muted-foreground">Staff</p></div>
                  </div>
                </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-primary" /></div>
            Individual Performance
            {deptFilter !== 'all' && <span className="ml-2 text-xs font-normal text-muted-foreground">· {getDepartmentLabel(deptFilter)} only</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {agentStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground"><Trophy className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm font-medium">No records yet</p></div>
          ) : (
            <div className="divide-y divide-border">
              {agentStats.map((agent, idx) => (
                <div key={agent.id} className="flex flex-col md:flex-row md:items-center gap-3 p-4 md:p-5 min-h-[80px] transition-colors active:bg-muted/50 hover:bg-muted/30 group">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-warning text-white' : idx === 1 ? 'bg-muted text-foreground' : idx === 2 ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>{idx + 1}</div>
                    <div className="min-w-0 flex-1"><NameLink id={agent.id} name={agent.name} showAvatar={false} className="text-sm font-semibold" /><p className="text-xs text-muted-foreground tabular-nums">{agent.totalLeads} leads · {agent.soldCount} sold</p></div>
                    <button type="button" onClick={() => navigate(`/profile/${agent.id}`)} className="md:hidden w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all shrink-0" aria-label="View profile"><Eye className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-3 gap-2 md:gap-3">
                      <div className="bg-primary/5 rounded-lg p-2.5 text-center"><div className="flex items-center justify-center gap-1 mb-0.5"><Users className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium text-primary">Leads</span></div><p className="text-lg font-bold text-foreground tabular-nums">{agent.totalLeads}</p></div>
                      <div className="bg-success/5 rounded-lg p-2.5 text-center"><div className="flex items-center justify-center gap-1 mb-0.5"><Footprints className="w-3.5 h-3.5 text-success" /><span className="text-xs font-medium text-success">Check-ins</span></div><p className="text-lg font-bold text-foreground tabular-nums">{agent.totalCheckins}</p></div>
                      <div className="bg-destructive/5 rounded-lg p-2.5 text-center"><div className="flex items-center justify-center gap-1 mb-0.5"><TrendingUp className="w-3.5 h-3.5 text-destructive" /><span className="text-xs font-medium text-destructive">Grade A</span></div><p className="text-lg font-bold text-foreground tabular-nums">{agent.gradeA}</p></div>
                    </div>
                  </div>
                  <div className="shrink-0 w-full md:w-40">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1"><span>Grade Breakdown</span><span className="flex items-center gap-0.5"><ArrowUpRight className="w-3.5 h-3.5 text-success" />{agent.gradeA > 0 ? 'Active' : '—'}</span></div>
                    <div className="h-2.5 w-full rounded-full overflow-hidden flex">
                      {agent.totalLeads > 0 ? (
                        <>
                          <div className="h-full bg-destructive" style={{ width: `${(agent.gradeA / agent.totalLeads) * 100}%` }} />
                          <div className="h-full bg-warning" style={{ width: `${(agent.gradeB / agent.totalLeads) * 100}%` }} />
                          <div className="h-full bg-muted-foreground/30" style={{ width: `${(agent.gradeC / agent.totalLeads) * 100}%` }} />
                        </>
                      ) : <div className="h-full w-full bg-muted" />}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" />A:{agent.gradeA}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" />B:{agent.gradeB}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/30" />C:{agent.gradeC}</span>
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
