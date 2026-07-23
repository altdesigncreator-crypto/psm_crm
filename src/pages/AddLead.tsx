import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, User, FileText, TrendingUp, CheckCircle2, Navigation, LocateFixed, Users, X, AlertTriangle, Eye, Phone as PhoneIcon, Loader2, Sparkles } from 'lucide-react';
import {
  INTEREST_TYPES, PROPERTY_TYPES, PURPOSES, LEAD_SOURCES, LEAD_GRADES,
} from '@/types';
import { BudgetStepperInput } from '@/components/ui/budget-stepper-input';
import { haversineDistance, formatDistance } from '@/lib/distance';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProfiles } from '@/hooks/useProfiles';
import { useTeams } from '@/hooks/useTeams';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { isManagerOrAbove, isAdminOrAbove, getDepartmentLabel } from '@/lib/permissions';

export default function AddLead() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { profiles } = useProfiles();
  const { teams, teamsOf, membersOf } = useTeams();
  usePageHeader('Add New Lead', 'Capture comprehensive lead information');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');

  const [interestType, setInterestType] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [preferredProject, setPreferredProject] = useState('');
  const [budgetMin, setBudgetMin] = useState(0);
  const [budgetMax, setBudgetMax] = useState(100000);
  const [budgetUnlimited, setBudgetUnlimited] = useState(false);
  const [purpose, setPurpose] = useState('');

  const [leadSource, setLeadSource] = useState('');
  const [leadGrade, setLeadGrade] = useState('');
  const [ownerId, setOwnerId] = useState(user?.id || '');
  const [teamId, setTeamId] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [remarks, setRemarks] = useState('');

  const [leadLat, setLeadLat] = useState<number | null>(null);
  const [leadLng, setLeadLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [nearestAgents, setNearestAgents] = useState<{ id: string; name: string; distance: number }[]>([]);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [findingAgents, setFindingAgents] = useState(false);

  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateLeads, setDuplicateLeads] = useState<any[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  const [aiScoring, setAiScoring] = useState(false);
  const [aiScoreReason, setAiScoreReason] = useState('');

  const canAssign = isManagerOrAbove(role);

  // Team comes first, then who on that team owns the lead — a manager can
  // run more than one team (in more than one department) and a salesperson
  // can sit on more than one team, so "team" can never be reliably inferred
  // from a flat department roster. Each tier only ever sees teams it's
  // actually entitled to assign into; RLS enforces the same boundary
  // server-side regardless of what this list shows.
  const teamOptions = useMemo(() => {
    const active = teams.filter((t) => t.is_active !== false);
    if (role === 'manager') return active.filter((t) => t.manager_id === user?.id);
    if (isAdminOrAbove(role)) return active; // admin: own department only (RLS-scoped); exec: all
    return user ? active.filter((t) => teamsOf(user.id).includes(t.id)) : []; // sale: teams they're on
  }, [teams, role, user, teamsOf]);

  // Auto-select when there's only one possible team so it's zero extra taps
  // for the common case; only becomes a visible choice when genuinely
  // ambiguous.
  useEffect(() => {
    if (teamOptions.length === 1) setTeamId(teamOptions[0].id);
    else if (!teamOptions.some((t) => t.id === teamId)) setTeamId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamOptions.map((t) => t.id).join(',')]);

  const selectedTeam = teamOptions.find((t) => t.id === teamId) || null;
  const teamMemberIds = teamId ? membersOf(teamId) : [];
  const teamMemberProfiles = profiles.filter((p) => teamMemberIds.includes(p.id) && p.role === 'sale');

  // If the chosen team changes and the previously-picked owner isn't on it
  // (and isn't "myself"), drop the stale pick rather than silently submit a
  // lead whose owner doesn't belong to its own team.
  useEffect(() => {
    if (ownerId && ownerId !== user?.id && !teamMemberIds.includes(ownerId)) setOwnerId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // Nearest-agent search is scoped to people this creator could actually
  // assign into one of the teams above — never a random org-wide match,
  // which would bypass the same team hierarchy the rest of this form
  // enforces.
  const assignableMemberIds = useMemo(
    () => new Set(teamOptions.flatMap((t) => membersOf(t.id))),
    [teamOptions, membersOf]
  );

  const handleCaptureLeadGPS = () => {
    if (!navigator.geolocation) { toast.error('GPS is not supported on this device.'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLeadLat(pos.coords.latitude); setLeadLng(pos.coords.longitude); setGpsLoading(false); toast.success('Lead GPS captured.'); },
      () => { setGpsLoading(false); toast.error('Could not get GPS — check permissions.'); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleFindNearestAgents = async () => {
    if (leadLat == null || leadLng == null) { toast.error('Capture lead GPS first.'); return; }
    setFindingAgents(true);
    setAgentPickerOpen(true);
    try {
      const { data } = await supabase.from('check_ins').select('employee_id, latitude, longitude, check_in_time').order('check_in_time', { ascending: false }).limit(200);
      const latest = new Map<string, { lat: number; lng: number }>();
      (data || []).forEach((c) => {
        if (!latest.has(c.employee_id) && c.latitude && c.longitude) {
          latest.set(c.employee_id, { lat: c.latitude, lng: c.longitude });
        }
      });
      const agents = Array.from(latest.entries())
        .filter(([id]) => assignableMemberIds.has(id))
        .map(([id, coords]) => ({
          id,
          name: profiles.find((p) => p.id === id)?.name || 'Unknown',
          distance: haversineDistance(leadLat, leadLng, coords.lat, coords.lng),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);
      setNearestAgents(agents);
    } catch {
      toast.error('Could not find nearby agents.');
    } finally {
      setFindingAgents(false);
    }
  };

  const selectNearestAgent = (agent: { id: string; name: string }) => {
    setOwnerId(agent.id);
    // Auto-resolve which team this puts the lead under — if the agent sits
    // on more than one team this creator can assign into, leave it for the
    // Team selector above rather than guessing.
    const candidateTeamIds = teamOptions.filter((t) => membersOf(t.id).includes(agent.id)).map((t) => t.id);
    if (candidateTeamIds.length === 1) setTeamId(candidateTeamIds[0]);
    setAgentPickerOpen(false);
    toast.success(`Auto-assigned: ${agent.name}`);
  };

  const buildLeadPayload = () => ({
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim() || null,
    current_location: currentLocation.trim() || null,
    interest_type: interestType || null,
    property_type: propertyType || null,
    preferred_project: preferredProject,
    budget_range: budgetUnlimited ? `${budgetMin.toLocaleString('en-US')}+ (unlimited)` : `${budgetMin.toLocaleString('en-US')} - ${budgetMax.toLocaleString('en-US')}`,
    purpose: purpose || null,
    lead_source: leadSource || null,
    lead_grade: leadGrade || null,
    // A team can belong to a different department than the creator's own —
    // the lead's department always follows the team it's filed under, not
    // whoever happens to be creating it.
    department_code: selectedTeam?.department_code || department || 'house',
    team_id: teamId || null,
    owner_id: ownerId || user?.id,
    created_by: user?.id,
    next_follow_up_at: nextFollowUpDate || null,
    remarks: remarks.trim() || null,
    latitude: leadLat,
    longitude: leadLng,
  });

  const handleAutoScore = async () => {
    setAiScoring(true);
    setAiScoreReason('');
    try {
      const { data, error } = await supabase.functions.invoke('lead-score', {
        body: {
          lead: {
            name: name.trim(), phone: phone.trim(), email: email.trim() || undefined,
            interestType: interestType || undefined, propertyType: propertyType || undefined,
            preferredProject: preferredProject || undefined,
            budgetRange: budgetUnlimited ? 'Unlimited' : `${budgetMin.toLocaleString()} - ${budgetMax.toLocaleString()}`,
            purpose: purpose || undefined,
            leadSource: leadSource || undefined, currentLocation: currentLocation.trim() || undefined, remarks: remarks.trim() || undefined,
          },
        },
      });
      if (error || !data?.score) throw new Error(error?.message || 'AI scoring failed.');
      setLeadGrade(data.score);
      setAiScoreReason(data.reasoning || '');
      toast.success(`AI score: ${data.score} — ${data.reasoning}`);
    } catch (err: any) {
      toast.error(err.message || 'AI scoring failed.');
    } finally {
      setAiScoring(false);
    }
  };

  const checkDuplicate = async () => {
    if (!phone.trim() && !email.trim()) return [];
    const orFilters: string[] = [];
    if (phone.trim()) orFilters.push(`phone.eq.${phone.trim()}`);
    if (email.trim()) orFilters.push(`email.eq.${email.trim()}`);
    const { data } = await supabase.from('leads').select('id, name, phone, email, status, owner_id, created_at').or(orFilters.join(','));
    return data || [];
  };

  const insertLead = async (payload: any) => {
    const { data, error } = await supabase.from('leads').insert(payload).select('id').single();
    if (error) throw error;
    return data.id;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !phone.trim() || !preferredProject.trim() || !leadGrade) {
      setError('Name, phone, project, and lead grade are required.');
      return;
    }
    if (teamOptions.length > 1 && !teamId) {
      setError('Please select which team this lead is for.');
      return;
    }

    setCheckingDuplicate(true);
    const duplicates = await checkDuplicate();
    setCheckingDuplicate(false);

    if (duplicates.length > 0) {
      setDuplicateLeads(duplicates);
      setDuplicateDialogOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const leadId = await insertLead(buildLeadPayload());
      navigate(`/lead/${leadId}`);
    } catch (err: any) {
      setError(err.message || 'Could not save the lead. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const proceedWithSubmit = async () => {
    setDuplicateDialogOpen(false);
    setSubmitting(true);
    try {
      const leadId = await insertLead(buildLeadPayload());
      navigate(`/lead/${leadId}`);
    } catch (err: any) {
      setError(err.message || 'Could not save the lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const SectionHeader = ({ icon: Icon, title }: { icon: any; title: string }) => (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-primary" /></div>
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h3>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto animate-fade-in-up">
      <div className="mb-5 md:hidden">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">Add New Lead</h1>
        <p className="text-sm text-muted-foreground mt-1">Capture comprehensive lead information</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={User} title="Basic Information" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Customer Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Phone <span className="text-destructive">*</span></Label>
                  <Input type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Email</Label>
                  <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Current Location</Label>
                  <Input placeholder="Current location" value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} className="h-12" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={FileText} title="Requirements" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Interest</Label>
                  <Select value={interestType} onValueChange={setInterestType}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="Select interest" /></SelectTrigger>
                    <SelectContent>{INTEREST_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Property Type</Label>
                  <Select value={propertyType} onValueChange={setPropertyType}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="Select property type" /></SelectTrigger>
                    <SelectContent>{PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Preferred Project <span className="text-destructive">*</span></Label>
                  <Input placeholder="Enter project name" value={preferredProject} onChange={(e) => setPreferredProject(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-3 md:col-span-2">
                  <Label className="text-sm font-medium">Estimated Budget</Label>
                  <BudgetStepperInput minValue={budgetMin} maxValue={budgetMax} isUnlimited={budgetUnlimited} step={1000} onMinChange={setBudgetMin} onMaxChange={setBudgetMax} onUnlimitedToggle={setBudgetUnlimited} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">Purpose</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="Select purpose" /></SelectTrigger>
                    <SelectContent>{PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={TrendingUp} title="Sales Tracking" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <div className="h-5 flex items-center"><Label className="text-sm font-medium">Lead Source</Label></div>
                  <Select value={leadSource} onValueChange={setLeadSource}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="Select source" /></SelectTrigger>
                    <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="h-5 flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium shrink-0 whitespace-nowrap">Lead Grade <span className="text-destructive">*</span></Label>
                    <button type="button" onClick={handleAutoScore} disabled={aiScoring} className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-40 transition-colors">
                      {aiScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {aiScoring ? 'Scoring…' : 'AI Score'}
                    </button>
                  </div>
                  <Select value={leadGrade} onValueChange={setLeadGrade}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="Select grade" /></SelectTrigger>
                    <SelectContent>{LEAD_GRADES.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {aiScoreReason && <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">{aiScoreReason}</p>}
                  <p className="text-[11px] text-muted-foreground">This is the starting grade. Once follow-ups are recorded, the grade updates automatically based on each follow-up's outcome.</p>
                </div>
                {/* Team first, then who on that team owns the lead — since a
                    manager can run more than one team and a salesperson can
                    sit on more than one, "team" can never be reliably
                    guessed from a name alone. */}
                {teamOptions.length > 1 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Team <span className="text-destructive">*</span></Label>
                    <Select value={teamId} onValueChange={setTeamId}>
                      <SelectTrigger className="h-12"><SelectValue placeholder="Select team" /></SelectTrigger>
                      <SelectContent>
                        {teamOptions.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}{isAdminOrAbove(role) ? ` · ${getDepartmentLabel(t.department_code)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">Only this team's manager (plus Admin/exec) will be able to see this lead.</p>
                  </div>
                )}
                {teamOptions.length === 1 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Team</Label>
                    <div className="h-12 flex items-center px-4 rounded-xl border border-border bg-muted/30 text-sm text-foreground">
                      {teamOptions[0].name}
                    </div>
                  </div>
                )}
                {canAssign ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Assign to Sales Person</Label>
                    <div className="flex items-center gap-2">
                      <Select value={ownerId} onValueChange={setOwnerId} disabled={!teamId && teamOptions.length > 0}>
                        <SelectTrigger className="h-12 flex-1"><SelectValue placeholder={!teamId && teamOptions.length > 0 ? 'Select a team first' : 'Assign to…'} /></SelectTrigger>
                        <SelectContent>
                          {user && <SelectItem value={user.id}>Myself</SelectItem>}
                          {teamMemberProfiles.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button" onClick={handleFindNearestAgents} disabled={findingAgents || leadLat == null}
                        className="h-12 px-3 rounded-xl border border-primary/30 text-primary bg-primary/5 active:bg-primary/10 active:scale-[0.98] transition-all shrink-0 text-xs font-medium flex items-center gap-1.5 disabled:opacity-40"
                      >
                        <LocateFixed className="w-4 h-4" /> <span className="hidden md:inline">Nearest</span>
                      </button>
                    </div>
                    {teamId && teamMemberProfiles.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">This team has no sales people yet — you can still assign the lead to yourself.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Owner</Label>
                    <Input value="This lead will be assigned to you" disabled className="h-12 text-sm" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Next Follow-up Date</Label>
                  <Input type="date" value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">Remarks</Label>
                  <Textarea placeholder="Additional remarks…" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[100px]" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">Lead GPS Location</Label>
                  <button
                    type="button" onClick={handleCaptureLeadGPS} disabled={gpsLoading}
                    className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        {gpsLoading ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : leadLat != null ? <Navigation className="w-5 h-5 text-success" /> : <MapPin className="w-5 h-5 text-primary" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{leadLat != null ? 'GPS captured' : 'Capture Lead GPS'}</p>
                        <p className="text-xs text-muted-foreground">{leadLat != null ? `${leadLat.toFixed(5)}, ${leadLng?.toFixed(5)}` : 'Needed to find the nearest sales person'}</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* In normal flow (not fixed) — the old floating bar sat at a fixed
              64px offset that collided with the bottom tab bar (which is
              taller on phones with a safe-area inset) and hid the last form
              fields behind it. */}
          <div className="space-y-3">
            {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-3">{error}</div>}
            <Button type="submit" disabled={submitting || checkingDuplicate} className="w-full h-14 md:h-12 gradient-primary hover:gradient-primary-hover text-white font-semibold text-base transition-all duration-300 hover:shadow-card-hover active:scale-[0.98]">
              {checkingDuplicate ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking for duplicates…</>) : submitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>) : (<><CheckCircle2 className="w-4 h-4 mr-2" /> Save Lead</>)}
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Nearest Sales People</DialogTitle></DialogHeader>
          <div className="px-6 pb-6 space-y-3 max-h-[60vh] overflow-y-auto">
            {findingAgents ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
            ) : nearestAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <MapPin className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm font-medium">No agents found</p>
                <p className="text-xs mt-1">Searching agents with recent check-in records.</p>
              </div>
            ) : (
              nearestAgents.map((agent, idx) => (
                <button key={agent.id} type="button" onClick={() => selectNearestAgent(agent)} className="w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99] transition-all text-left">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">{idx + 1}</div>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground truncate">{agent.name}</p><p className="text-xs text-muted-foreground">{formatDistance(agent.distance)} away</p></div>
                  <div className="shrink-0 text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">{agent.distance < 1 ? `${(agent.distance * 1000).toFixed(0)} m` : `${agent.distance.toFixed(1)} km`}</div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle className="flex items-center gap-2 text-warning"><AlertTriangle className="w-5 h-5 text-warning" /> Possible Duplicate Lead</DialogTitle></DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-muted-foreground">A lead with this phone or email may already exist. Please review:</p>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {duplicateLeads.map((dup) => (
                <div key={dup.id} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
                  <div className="w-9 h-9 rounded-full bg-warning/10 flex items-center justify-center shrink-0"><PhoneIcon className="w-4 h-4 text-warning" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{dup.name}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><PhoneIcon className="w-3 h-3" />{dup.phone}</span>
                      {dup.email && <span>{dup.email}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => navigate(`/lead/${dup.id}`)} className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 active:bg-primary/20 rounded-md px-2 py-1 transition-colors">
                    <Eye className="w-3.5 h-3.5" /> <span className="hidden md:inline">View</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1 h-11 border-border" onClick={() => setDuplicateDialogOpen(false)}>
                <X className="w-4 h-4 mr-1.5" /> Cancel
              </Button>
              <Button type="button" className="flex-1 h-11 gradient-primary hover:gradient-primary-hover text-white font-medium active:scale-[0.98]" onClick={proceedWithSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />} Add Anyway
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
