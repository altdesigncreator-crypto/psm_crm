import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { isManagerOrAbove, isAdminOrAbove } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Users, Footprints, TrendingUp, Target, User, Phone, Building2, Calendar, Clock, CheckCircle2, MapPin } from 'lucide-react';
import type { Lead, CheckIn, Profile } from '@/types';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import StatusBadge from '@/components/StatusBadge';
import { useStatusColors } from '@/hooks/useStatusColors';
import { LEAD_STAGES } from '@/types';

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role, department } = useAuth();
  const { colors: statusColors } = useStatusColors();

  const [agent, setAgent] = useState<Profile | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !isManagerOrAbove(role)) { setLoading(false); return; }
    (async () => {
      const [agentRes, leadsRes, checkinsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('leads').select('*').eq('owner_id', id).order('created_at', { ascending: false }),
        supabase.from('check_ins').select('*').eq('employee_id', id).order('check_in_time', { ascending: false }),
      ]);
      setAgent((agentRes.data as Profile) || null);
      setLeads((leadsRes.data || []) as Lead[]);
      setCheckins((checkinsRes.data || []) as CheckIn[]);
      setLoading(false);
    })();
  }, [id, role]);

  if (!isManagerOrAbove(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">This page is restricted to Manager tier and above.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-4 h-4 mr-2" />Back to Dashboard</Button>
      </div>
    );
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  if (!agent || (!isAdminOrAbove(role) && agent.department_code !== department)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">You don't have access to this agent's data.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/kpi-board')}><ArrowLeft className="w-4 h-4 mr-2" />Back to KPI Board</Button>
      </div>
    );
  }

  const stats = {
    totalLeads: leads.length,
    totalCheckins: checkins.length,
    gradeA: leads.filter((l) => l.lead_grade === 'A').length,
    sold: leads.filter((l) => l.status === 'sold').length,
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/kpi-board')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1"><h1 className="text-xl md:text-2xl font-bold text-foreground">Agent Profile</h1><p className="text-sm text-muted-foreground mt-0.5 truncate">{agent.name} · {agent.email}</p></div>
      </div>

      <div className="flex md:grid md:grid-cols-4 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-primary" /></div><div><p className="text-xl font-bold text-foreground">{stats.totalLeads}</p><p className="text-xs text-muted-foreground">Total Leads</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><TrendingUp className="w-5 h-5 text-destructive" /></div><div><p className="text-xl font-bold text-foreground">{stats.gradeA}</p><p className="text-xs text-muted-foreground">Grade A</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><Footprints className="w-5 h-5 text-success" /></div><div><p className="text-xl font-bold text-foreground">{stats.totalCheckins}</p><p className="text-xs text-muted-foreground">Check-ins</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5 text-primary" /></div><div><p className="text-xl font-bold text-foreground">{stats.sold}</p><p className="text-xs text-muted-foreground">Sold</p></div></CardContent></Card>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Users className="w-4 h-4 text-primary" /></div>Leads ({stats.totalLeads})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground"><Users className="w-8 h-8 mb-2 opacity-30" /><p className="text-sm font-medium">No leads yet</p></div>
          ) : (
            <ScrollArea className="h-[340px] md:h-80">
              <div className="divide-y divide-border">
                {leads.map((lead) => (
                  <div key={lead.id} className="flex items-start gap-3 p-4 min-h-[64px] transition-colors active:bg-muted/50 hover:bg-muted/30">
                    <div className="mt-0.5 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-primary" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{lead.name}</p>
                        <LeadLevelBadge grade={lead.lead_grade} />
                        <StatusBadge status={LEAD_STAGES.find((s) => s.value === lead.status)?.label || lead.status} color={statusColors[lead.status] || '#8FA3BF'} />
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{lead.phone}</span>
                        <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{lead.preferred_project || '—'}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleDateString() : '—'}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => navigate(`/lead/${lead.id}`)} className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all shrink-0 mt-0.5" aria-label="View lead">
                      <ArrowLeft className="w-4 h-4 rotate-180" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center"><Footprints className="w-4 h-4 text-success" /></div>Check-ins ({stats.totalCheckins})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {checkins.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground"><Footprints className="w-8 h-8 mb-2 opacity-30" /><p className="text-sm font-medium">No check-ins yet</p></div>
          ) : (
            <ScrollArea className="h-[340px] md:h-80">
              <div className="divide-y divide-border">
                {checkins.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 p-4 min-h-[64px] hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0"><Footprints className="w-4 h-4 text-success" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{c.notes || 'Field check-in'}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        {c.latitude && c.longitude && (<span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}</span>)}
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{new Date(c.check_in_time).toLocaleDateString('en-GB')}</span>
                      </div>
                    </div>
                    {c.photo_url && (<img src={c.photo_url} alt="Check-in" className="w-16 h-16 md:w-20 md:h-20 rounded-xl object-cover shrink-0 border border-border" />)}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
