import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { getRoleLabel, getDepartmentLabel, isExec } from '@/lib/permissions';
import { useTeams } from '@/hooks/useTeams';
import { useProfiles } from '@/hooks/useProfiles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import NameLink from '@/components/NameLink';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import StatusBadge from '@/components/StatusBadge';
import { useStatusColors } from '@/hooks/useStatusColors';
import {
  ArrowLeft, Users, Footprints, TrendingUp, CheckCircle2, ListChecks, ShieldAlert,
  User, Phone, Mail, Building2, Calendar, Clock, MapPin, UserCog, Globe,
  Activity, ChevronLeft, ChevronRight, Eye,
} from 'lucide-react';
import { LEAD_STAGES, FOLLOWUP_STATUSES, type Lead, type CheckIn, type FollowUp, type Profile as ProfileRecord } from '@/types';

function initialsOf(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function stageLabel(status: string) {
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
}

function followUpStatusLabel(status: string) {
  return FOLLOWUP_STATUSES.find((s) => s.value === status)?.label || status;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local-calendar-day of an ISO timestamp — matches todayStr()/shiftDay()
 * above so "was this on the selected day" compares like-for-like instead of
 * drifting against the timestamp's UTC date. */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

type FollowUpWithLead = FollowUp & { leads?: { name: string; phone: string } | null };

export default function Profile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { colors: statusColors } = useStatusColors();
  const { teams, teamsOf, teamsManagedBy, membersOf } = useTeams();
  const { nameOf } = useProfiles();

  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpWithLead[]>([]);
  const [loading, setLoading] = useState(true);

  usePageHeader('Profile', profile ? `${profile.name} · ${getRoleLabel(profile.role)}` : undefined);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let active = true;
    (async () => {
      const [profileRes, leadsRes, checkinsRes, followUpsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        supabase.from('leads').select('*').eq('owner_id', id).order('created_at', { ascending: false }),
        supabase.from('check_ins').select('*').eq('employee_id', id).order('check_in_time', { ascending: false }),
        supabase.from('follow_ups').select('*, leads(name, phone)').eq('created_by', id).order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      setProfile((profileRes.data as ProfileRecord) || null);
      setLeads((leadsRes.data || []) as Lead[]);
      setCheckins((checkinsRes.data || []) as CheckIn[]);
      setFollowUps((followUpsRes.data || []) as FollowUpWithLead[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);

  const stats = {
    totalLeads: leads.length,
    gradeA: leads.filter((l) => l.lead_grade === 'A').length,
    sold: leads.filter((l) => l.status === 'sold').length,
    totalCheckins: checkins.length,
    totalFollowUps: followUps.length,
  };

  // Daily Activity — what this person did on a given day: leads added,
  // follow-ups logged, and their check-in. Derived from the already-loaded
  // full history above (no extra query needed), filtered to the selected day.
  const [day, setDay] = useState(todayStr());
  const isToday = day === todayStr();
  const dayLeads = useMemo(() => leads.filter((l) => localDateStr(l.created_at) === day), [leads, day]);
  const dayFollowUps = useMemo(() => followUps.filter((f) => localDateStr(f.created_at) === day), [followUps, day]);
  const dayCheckin = useMemo(() => checkins.find((c) => c.check_in_date === day) || null, [checkins, day]);

  // Sales Person → the teams they're on (and each team's manager). Manager →
  // the teams they run. Admin/Boss/Super Admin aren't part of the team model
  // (see the recent department→team restructure), so show their scope instead.
  const mySalesTeams = useMemo(() => {
    if (!profile || profile.role !== 'sale') return [];
    const ids = teamsOf(profile.id);
    return teams.filter((t) => ids.includes(t.id));
  }, [profile, teams, teamsOf]);

  const myManagedTeams = useMemo(() => {
    if (!profile || profile.role !== 'manager') return [];
    return teamsManagedBy(profile.id);
  }, [profile, teamsManagedBy]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <ShieldAlert className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">This profile isn't available to you.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4 mr-2" />Go back</Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1 md:hidden">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{profile.name} · {getRoleLabel(profile.role)}</p>
        </div>
      </div>

      {/* Identity card */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-5 flex items-start gap-4">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.name} className="w-14 h-14 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-primary/10 text-primary text-base font-semibold flex items-center justify-center shrink-0">
              {initialsOf(profile.name)}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-lg font-semibold text-foreground truncate">{profile.name}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">{getRoleLabel(profile.role)}</span>
                {profile.department_code && (
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">{getDepartmentLabel(profile.department_code)}</span>
                )}
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${profile.status === 'active' ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20' : 'bg-destructive/5 text-destructive border-destructive/20'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${profile.status === 'active' ? 'bg-emerald-500' : 'bg-destructive'}`} /> {profile.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{profile.email}</span>
              {profile.phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{profile.phone}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Teams & reporting */}
      {profile.role === 'sale' && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Users className="w-4 h-4 text-primary" /></div>Teams & Manager</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {mySalesTeams.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not yet assigned to a team.</p>
            ) : (
              <div className="space-y-2.5">
                {mySalesTeams.map((team) => (
                  <div key={team.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{team.name}</p>
                      <p className="text-xs text-muted-foreground">{getDepartmentLabel(team.department_code)}</p>
                    </div>
                    {team.manager_id ? (
                      <NameLink id={team.manager_id} name={nameOf(team.manager_id)} size="sm" />
                    ) : (
                      <span className="text-xs text-muted-foreground shrink-0">No manager assigned</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {profile.role === 'manager' && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><UserCog className="w-4 h-4 text-primary" /></div>Teams Managed</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {myManagedTeams.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not yet running any team.</p>
            ) : (
              <div className="space-y-2.5">
                {myManagedTeams.map((team) => (
                  <div key={team.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{team.name}</p>
                      <p className="text-xs text-muted-foreground">{getDepartmentLabel(team.department_code)}</p>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground shrink-0">{membersOf(team.id).length} member{membersOf(team.id).length === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(profile.role === 'admin' || isExec(profile.role)) && (
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Globe className="w-4 h-4 text-primary" /></div>
            <p className="text-sm text-muted-foreground">
              {isExec(profile.role)
                ? 'Global access — not scoped to a single department or team.'
                : `Department-wide access across ${profile.department_code ? getDepartmentLabel(profile.department_code) : 'their department'}.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Daily Activity — leads added, follow-ups made, and check-in status
          for a chosen day, mirroring Team Activity's per-day view but
          scoped to this one person. */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Activity className="w-4 h-4 text-primary" /></div>Daily Activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-10 w-10 min-h-0 shrink-0" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Input type="date" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-10 w-[150px] text-sm" />
            <Button variant="outline" size="icon" className="h-10 w-10 min-h-0 shrink-0" aria-label="Next day" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            {!isToday && (
              <Button variant="ghost" className="h-10 px-3 text-xs font-medium text-primary" onClick={() => setDay(todayStr())}>Today</Button>
            )}
            {dayCheckin ? (
              <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full shrink-0 ${dayCheckin.is_late ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                <Footprints className="w-3 h-3" /> {dayCheckin.is_late ? 'Late' : 'Checked in'} · {timeOf(dayCheckin.check_in_time)}
              </span>
            ) : (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-destructive/10 text-destructive shrink-0">
                <Footprints className="w-3 h-3" /> No check-in
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0 md:divide-x divide-border/50">
            <div className="md:pr-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-primary" /> Leads Added ({dayLeads.length})
              </p>
              {dayLeads.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1.5">No leads added.</p>
              ) : (
                <div className="space-y-1.5">
                  {dayLeads.map((l) => (
                    <button key={l.id} type="button" onClick={() => navigate(`/lead/${l.id}`)} className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left hover:bg-muted/40 active:bg-muted/60 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{l.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{l.phone || '—'}</p>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{timeOf(l.created_at)}</span>
                      <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="md:pl-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5 text-info" /> Follow-ups ({dayFollowUps.length})
              </p>
              {dayFollowUps.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1.5">No follow-ups made.</p>
              ) : (
                <div className="space-y-1.5">
                  {dayFollowUps.map((f) => (
                    <button key={f.id} type="button" onClick={() => navigate(`/lead/${f.lead_id}`)} className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left hover:bg-muted/40 active:bg-muted/60 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{f.leads?.name || 'Lead'}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">{followUpStatusLabel(f.status)}</span>
                          {f.notes && <span className="text-xs text-muted-foreground truncate">{f.notes}</span>}
                        </div>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{timeOf(f.created_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {dayCheckin?.notes && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/50">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-success" />
              <span className="truncate">Check-in: {dayCheckin.notes}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overview stats */}
      <div className="flex md:grid md:grid-cols-5 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-primary" /></div><div><p className="text-xl font-bold text-foreground tabular-nums">{stats.totalLeads}</p><p className="text-xs text-muted-foreground">Total Leads</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><TrendingUp className="w-5 h-5 text-destructive" /></div><div><p className="text-xl font-bold text-foreground tabular-nums">{stats.gradeA}</p><p className="text-xs text-muted-foreground">Grade A</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5 text-emerald-500" /></div><div><p className="text-xl font-bold text-foreground tabular-nums">{stats.sold}</p><p className="text-xs text-muted-foreground">Sold</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><Footprints className="w-5 h-5 text-success" /></div><div><p className="text-xl font-bold text-foreground tabular-nums">{stats.totalCheckins}</p><p className="text-xs text-muted-foreground">Check-ins</p></div></CardContent></Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1"><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center shrink-0"><ListChecks className="w-5 h-5 text-info" /></div><div><p className="text-xl font-bold text-foreground tabular-nums">{stats.totalFollowUps}</p><p className="text-xs text-muted-foreground">Follow-ups</p></div></CardContent></Card>
      </div>

      {/* Leads */}
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
                        <span className="flex items-center gap-1 tabular-nums"><Calendar className="w-3.5 h-3.5" />{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleDateString() : '—'}</span>
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

      {/* Follow-ups */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center"><ListChecks className="w-4 h-4 text-info" /></div>Follow-ups ({stats.totalFollowUps})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {followUps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground"><ListChecks className="w-8 h-8 mb-2 opacity-30" /><p className="text-sm font-medium">No follow-ups logged yet</p></div>
          ) : (
            <ScrollArea className="h-[340px] md:h-80">
              <div className="divide-y divide-border">
                {followUps.map((f) => (
                  <div key={f.id} className="flex items-start gap-3 p-4 min-h-[64px] hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 w-10 h-10 rounded-full bg-info/10 flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4 text-info" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground truncate">{f.leads?.name || 'Unknown lead'}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border capitalize">{f.status.replace(/_/g, ' ')}</span>
                      </div>
                      {f.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{f.notes}</p>}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        {f.leads?.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{f.leads.phone}</span>}
                        <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3.5 h-3.5" />{new Date(f.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {f.lead_id && (
                      <button type="button" onClick={() => navigate(`/lead/${f.lead_id}`)} className="w-9 h-9 rounded-full bg-info/10 text-info flex items-center justify-center active:bg-info/20 active:scale-95 transition-all shrink-0 mt-0.5" aria-label="View lead">
                        <ArrowLeft className="w-4 h-4 rotate-180" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Check-ins */}
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
                        <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3.5 h-3.5" />{new Date(c.check_in_time).toLocaleDateString('en-GB')}</span>
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
