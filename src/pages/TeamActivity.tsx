import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import { isDepartmentScoped, getDepartmentLabel, getRoleLabel, ROLE_TIERS } from '@/lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity, Calendar, ChevronLeft, ChevronRight, UserPlus, ListChecks, Footprints,
  User as UserIcon, Phone, Eye, MapPin, Filter,
} from 'lucide-react';
import { FOLLOWUP_STATUSES, type CheckIn } from '@/types';
import type { Profile } from '@/types';
import { toast } from 'sonner';

const STATUS_STYLE: Record<string, string> = {
  interested: 'bg-success/10 text-success border-success/20',
  not_interested: 'bg-destructive/10 text-destructive border-destructive/20',
  busy: 'bg-warning/10 text-warning border-warning/20',
  no_answer: 'bg-muted text-muted-foreground border-border',
  call_later: 'bg-info/10 text-info border-info/20',
  site_visit: 'bg-primary/10 text-primary border-primary/20',
  booking: 'bg-success/10 text-success border-success/20',
  lost: 'bg-destructive/10 text-destructive border-destructive/20',
};

function followUpStatusLabel(status: string) {
  return FOLLOWUP_STATUSES.find((s) => s.value === status)?.label || status;
}

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface DayLead {
  id: string;
  name: string;
  phone: string | null;
  created_at: string;
  created_by: string | null;
  owner_id: string | null;
}

interface DayFollowUp {
  id: string;
  lead_id: string;
  created_by: string | null;
  type: string;
  status: string;
  notes: string | null;
  created_at: string;
  leads: { name: string } | null;
}

interface UserActivity {
  profile: Profile;
  leads: DayLead[];
  followUps: DayFollowUp[];
  checkin: CheckIn | null;
}

export default function TeamActivity() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { t } = useTranslation();
  const { profiles } = useProfiles();
  const { departments } = useDepartments();
  usePageHeader(t('activity.title'), t('activity.subtitle'));

  const [day, setDay] = useState<string>(todayStr());
  const [userFilter, setUserFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [dayLeads, setDayLeads] = useState<DayLead[]>([]);
  const [dayFollowUps, setDayFollowUps] = useState<DayFollowUp[]>([]);
  const [dayCheckins, setDayCheckins] = useState<CheckIn[]>([]);

  const isToday = day === todayStr();

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      // Local-midnight window for the chosen day (timestamptz columns).
      const start = new Date(`${day}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const [leadsRes, fuRes, ciRes] = await Promise.all([
        supabase.from('leads')
          .select('id, name, phone, created_at, created_by, owner_id')
          .gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
          .order('created_at', { ascending: true }),
        supabase.from('follow_ups')
          .select('id, lead_id, created_by, type, status, notes, created_at, leads(name)')
          .gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
          .order('created_at', { ascending: true }),
        supabase.from('check_ins').select('*').eq('check_in_date', day),
      ]);
      if (!active) return;
      if (leadsRes.error || fuRes.error || ciRes.error) toast.error('Could not load the day\'s activity.');
      setDayLeads((leadsRes.data || []) as DayLead[]);
      setDayFollowUps((fuRes.data || []) as unknown as DayFollowUp[]);
      setDayCheckins((ciRes.data || []) as CheckIn[]);
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, [day]);

  // One activity bucket per staff member visible to this viewer (RLS scopes
  // profiles: exec sees all, admin/manager their department, sale themself).
  const activities = useMemo<UserActivity[]>(() => {
    const byUser = new Map<string, UserActivity>();
    for (const p of profiles) {
      if (p.status !== 'active') continue;
      if (deptFilter !== 'all' && p.department_code !== deptFilter) continue;
      byUser.set(p.id, { profile: p, leads: [], followUps: [], checkin: null });
    }
    for (const l of dayLeads) {
      const actor = l.created_by || l.owner_id;
      if (actor && byUser.has(actor)) byUser.get(actor)!.leads.push(l);
    }
    for (const f of dayFollowUps) {
      if (f.created_by && byUser.has(f.created_by)) byUser.get(f.created_by)!.followUps.push(f);
    }
    for (const c of dayCheckins) {
      if (byUser.has(c.employee_id)) byUser.get(c.employee_id)!.checkin = c;
    }

    // Role hierarchy order (boss → super admin → admin → manager → sale),
    // then by name inside each tier.
    const tierIndex = (r: string) => { const i = ROLE_TIERS.indexOf(r as (typeof ROLE_TIERS)[number]); return i === -1 ? 99 : i; };
    return Array.from(byUser.values()).sort((a, b) => {
      const d = tierIndex(a.profile.role) - tierIndex(b.profile.role);
      return d !== 0 ? d : a.profile.name.localeCompare(b.profile.name);
    });
  }, [profiles, deptFilter, dayLeads, dayFollowUps, dayCheckins]);

  const visible = useMemo(() => {
    if (userFilter !== 'all') return activities.filter((a) => a.profile.id === userFilter);
    // "All staff": only show people who actually did something that day.
    return activities.filter((a) => a.leads.length > 0 || a.followUps.length > 0 || a.checkin);
  }, [activities, userFilter]);

  const summary = useMemo(() => ({
    leads: visible.reduce((n, a) => n + a.leads.length, 0),
    followUps: visible.reduce((n, a) => n + a.followUps.length, 0),
    checkins: visible.filter((a) => a.checkin).length,
    activeStaff: visible.length,
  }), [visible]);

  const dayLabel = new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="md:hidden">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> {t('activity.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('activity.subtitle')}</p>
      </div>

      {/* Day + user controls */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" className="h-11 w-11 min-h-0 shrink-0" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Input type="date" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-11 w-[150px] text-sm" />
              </div>
              <Button variant="outline" size="icon" className="h-11 w-11 min-h-0 shrink-0" aria-label="Next day" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              {!isToday && (
                <Button variant="ghost" className="h-11 px-3 text-xs font-medium text-primary" onClick={() => setDay(todayStr())}>
                  Today
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 md:ml-auto flex-wrap">
              {!isDepartmentScoped(role) && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="h-11 w-[160px] text-sm"><Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="h-11 w-[190px] text-sm"><UserIcon className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Staff member" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff</SelectItem>
                  {activities.map((a) => (
                    <SelectItem key={a.profile.id} value={a.profile.id}>{a.profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">{dayLabel}</p>
        </CardContent>
      </Card>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: UserPlus, label: 'Leads Added', value: summary.leads, tint: 'bg-primary/10 text-primary' },
          { icon: ListChecks, label: 'Follow-ups', value: summary.followUps, tint: 'bg-info/10 text-info' },
          { icon: Footprints, label: 'Check-ins', value: summary.checkins, tint: 'bg-success/10 text-success' },
          { icon: UserIcon, label: userFilter === 'all' ? 'Active Staff' : 'Staff Shown', value: summary.activeStaff, tint: 'bg-warning/10 text-warning' },
        ].map((tile) => (
          <Card key={tile.label} className="shadow-card rounded-xl border-0">
            <CardContent className="p-3.5 flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tile.tint}`}><tile.icon className="w-4 h-4" /></div>
              <div>
                <p className="text-lg font-bold text-foreground leading-tight tabular-nums">{tile.value}</p>
                <p className="text-[11px] text-muted-foreground">{tile.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-user activity */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Activity className="w-9 h-9 mb-3 opacity-40" />
            <p className="text-sm font-medium">No activity recorded on this day</p>
            <p className="text-xs mt-1">Try another day or a different staff member</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((a) => {
            const total = a.leads.length + a.followUps.length + (a.checkin ? 1 : 0);
            return (
              <Card key={a.profile.id} className="shadow-card rounded-xl border-0 overflow-hidden">
                <CardContent className="p-0">
                  {/* User header */}
                  <div className="flex items-center gap-3 px-4 md:px-5 py-3.5 border-b border-border/50 bg-muted/20">
                    <Link to={`/profile/${a.profile.id}`} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80 transition-opacity">
                      {a.profile.avatar_url ? (
                        <img src={a.profile.avatar_url} alt={a.profile.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                          {initialsOf(a.profile.name)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate hover:underline underline-offset-2">{a.profile.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary">{getRoleLabel(a.profile.role)}</span>
                          {a.profile.department_code && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{getDepartmentLabel(a.profile.department_code)}</span>
                          )}
                        </div>
                      </div>
                    </Link>
                    <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                      <span className="hidden sm:inline tabular-nums">{total} activit{total === 1 ? 'y' : 'ies'}</span>
                      {a.checkin ? (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${a.checkin.is_late ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                          <Footprints className="w-3 h-3" /> {a.checkin.is_late ? 'Late' : 'Checked in'} · {timeOf(a.checkin.check_in_time)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-destructive/10 text-destructive">
                          <Footprints className="w-3 h-3" /> No check-in
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
                    {/* Leads added */}
                    <div className="p-4 md:p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                        <UserPlus className="w-3.5 h-3.5 text-primary" /> Leads Added ({a.leads.length})
                      </p>
                      {a.leads.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-1.5">No leads added.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {a.leads.map((l) => (
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

                    {/* Follow-ups made */}
                    <div className="p-4 md:p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                        <ListChecks className="w-3.5 h-3.5 text-info" /> Follow-ups ({a.followUps.length})
                      </p>
                      {a.followUps.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-1.5">No follow-ups made.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {a.followUps.map((f) => (
                            <button key={f.id} type="button" onClick={() => navigate(`/lead/${f.lead_id}`)} className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left hover:bg-muted/40 active:bg-muted/60 transition-colors">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{f.leads?.name || 'Lead'}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${STATUS_STYLE[f.status] || 'bg-muted text-muted-foreground border-border'}`}>{followUpStatusLabel(f.status)}</span>
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

                  {/* Check-in note (when present) */}
                  {a.checkin?.notes && (
                    <div className="px-4 md:px-5 py-3 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-success" />
                      <span className="truncate">Check-in: {a.checkin.notes}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
