import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, User, FileText, TrendingUp, CheckCircle2, Circle, X, AlertTriangle, Eye, Phone as PhoneIcon, Loader2, Sparkles, Camera, CalendarClock, ListChecks } from 'lucide-react';
import {
  INTEREST_TYPES, PROPERTY_TYPES, PURPOSES, LEAD_SOURCES, LEAD_GRADES,
} from '@/types';
import { BudgetStepperInput } from '@/components/ui/budget-stepper-input';
import ProjectNameInput from '@/components/ProjectNameInput';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProfiles } from '@/hooks/useProfiles';
import { useTeams } from '@/hooks/useTeams';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { isManagerOrAbove, isAdminOrAbove, getDepartmentLabel } from '@/lib/permissions';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';

function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

export default function AddLead() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { t } = useTranslation();
  const { profiles } = useProfiles();
  const { teams, teamsOf, membersOf } = useTeams();
  usePageHeader(t('addLead.title'), t('addLead.subtitle'));
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

  const [visitPhotoFile, setVisitPhotoFile] = useState<File | null>(null);
  const [visitPhotoPreview, setVisitPhotoPreview] = useState<string | null>(null);
  const visitPhotoInputRef = useRef<HTMLInputElement>(null);
  const [appointmentPhotoFile, setAppointmentPhotoFile] = useState<File | null>(null);
  const [appointmentPhotoPreview, setAppointmentPhotoPreview] = useState<string | null>(null);
  const appointmentPhotoInputRef = useRef<HTMLInputElement>(null);

  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateLeads, setDuplicateLeads] = useState<any[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  const [aiScoring, setAiScoring] = useState(false);
  const [aiScoreReason, setAiScoreReason] = useState('');

  const canAssign = isManagerOrAbove(role);

  const teamOptions = useMemo(() => {
    const active = teams.filter((t) => t.is_active !== false);
    if (role === 'manager') return active.filter((t) => t.manager_id === user?.id);
    if (isAdminOrAbove(role)) return active; // admin: own department only (RLS-scoped); exec: all
    return user ? active.filter((t) => teamsOf(user.id).includes(t.id)) : []; // sale: teams they're on
  }, [teams, role, user, teamsOf]);

  useEffect(() => {
    if (teamOptions.length === 1) setTeamId(teamOptions[0].id);
    else if (!teamOptions.some((t) => t.id === teamId)) setTeamId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamOptions.map((t) => t.id).join(',')]);

  const selectedTeam = teamOptions.find((t) => t.id === teamId) || null;
  const teamMemberIds = teamId ? membersOf(teamId) : [];
  const teamMemberProfiles = profiles.filter((p) => teamMemberIds.includes(p.id) && p.role === 'sale');

  useEffect(() => {
    if (ownerId && ownerId !== user?.id && !teamMemberIds.includes(ownerId)) setOwnerId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const budgetRangeDisplay = budgetUnlimited ? `${budgetMin.toLocaleString('en-US')}+ (unlimited)` : `${budgetMin.toLocaleString('en-US')} - ${budgetMax.toLocaleString('en-US')}`;

  const ownerName = ownerId === user?.id ? (user?.name || 'You') : teamMemberProfiles.find((p) => p.id === ownerId)?.name;

  const readyChecks = useMemo(() => {
    const checks = [
      { labelKey: 'addLead.checkCustomerName', done: !!name.trim() },
      { labelKey: 'addLead.checkPhoneNumber', done: !!phone.trim() },
      { labelKey: 'addLead.checkPreferredProject', done: !!preferredProject.trim() },
      { labelKey: 'addLead.checkLeadGrade', done: !!leadGrade },
    ];
    if (teamOptions.length > 1) checks.push({ labelKey: 'addLead.checkTeam', done: !!teamId });
    return checks;
  }, [name, phone, preferredProject, leadGrade, teamOptions.length, teamId]);
  const readyCount = readyChecks.filter((c) => c.done).length;
  const allReady = readyCount === readyChecks.length;

  const buildLeadPayload = () => ({
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim() || null,
    current_location: currentLocation.trim() || null,
    interest_type: interestType || null,
    property_type: propertyType || null,
    preferred_project: preferredProject,
    budget_range: budgetRangeDisplay,
    purpose: purpose || null,
    lead_source: leadSource || null,
    lead_grade: leadGrade || null,
    department_code: selectedTeam?.department_code || department || 'house',
    team_id: teamId || null,
    owner_id: ownerId || user?.id,
    created_by: user?.id,
    next_follow_up_at: nextFollowUpDate || null,
    remarks: remarks.trim() || null,
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
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, t('addLead.aiScoringFailed')));
      if (!data?.score) throw new Error(t('addLead.aiScoringFailed'));
      setLeadGrade(data.score);
      setAiScoreReason(data.reasoning || '');
      toast.success(`${t('addLead.aiScoreToastPrefix')}: ${data.score} — ${data.reasoning}`);
    } catch (err: any) {
      toast.error(err.message || t('addLead.aiScoringFailed'));
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

  const selectPhoto = (
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (f: File | null) => void,
    setPreview: (u: string | null) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('addLead.imageFileRequired')); return; }
    setFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const uploadLeadPhoto = async (leadId: string, file: File, kind: 'visit' | 'appointment') => {
    const path = `${leadId}/${kind}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('lead-photos').upload(path, file);
    if (error) throw error;
    return supabase.storage.from('lead-photos').getPublicUrl(path).data.publicUrl;
  };

  const insertLead = async (payload: any) => {
    const { data, error } = await supabase.from('leads').insert(payload).select('id').single();
    if (error) throw error;
    const leadId = data.id;

    if (visitPhotoFile || appointmentPhotoFile) {
      try {
        const updates: Record<string, string> = {};
        if (visitPhotoFile) updates.visit_photo_url = await uploadLeadPhoto(leadId, visitPhotoFile, 'visit');
        if (appointmentPhotoFile) updates.appointment_photo_url = await uploadLeadPhoto(leadId, appointmentPhotoFile, 'appointment');
        await supabase.from('leads').update(updates).eq('id', leadId);
      } catch {
        toast.error(t('addLead.photoUploadFailed'));
      }
    }

    return leadId;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !phone.trim() || !preferredProject.trim() || !leadGrade) {
      setError(t('addLead.requiredFieldsError'));
      return;
    }
    if (teamOptions.length > 1 && !teamId) {
      setError(t('addLead.selectTeamError'));
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
      // Replace, not push — otherwise back returns to the just-submitted,
      // now-stale empty form instead of wherever the user came from.
      navigate(`/lead/${leadId}`, { replace: true });
    } catch (err: any) {
      setError(err.message || t('addLead.saveErrorRetry'));
    } finally {
      setSubmitting(false);
    }
  };

  const proceedWithSubmit = async () => {
    setDuplicateDialogOpen(false);
    setSubmitting(true);
    try {
      const leadId = await insertLead(buildLeadPayload());
      // Replace, not push — otherwise back returns to the just-submitted,
      // now-stale empty form instead of wherever the user came from.
      navigate(`/lead/${leadId}`, { replace: true });
    } catch (err: any) {
      setError(err.message || t('addLead.saveError'));
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
    // Not animate-fade-in-up here — that animation's `forwards` fill mode
    // leaves a permanent (identity) `transform` on this element even after
    // it finishes, and any transform on an ancestor creates a new
    // containing block that silently breaks `position: sticky` on the
    // sidebar below. Confirmed via a real browser trace: the sidebar moved
    // exactly with the scroll instead of sticking, with a computed
    // transform of matrix(1,0,0,1,0,0) on this div being the culprit.
    <div>
      <div className="mb-5 md:hidden">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">{t('addLead.title')}</h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* No items-start here on purpose — with it, the sidebar's grid
            cell shrinks to its own content height instead of the row's
            full height, leaving the sticky child zero room to travel
            within its containing block, so it silently never sticks.
            Default (stretch) gives the cell the full row height while the
            visible cards inside keep their natural compact size. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={User} title={t('addLead.basicInfo')} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('addLead.customerName')} <span className="text-destructive">*</span></Label>
                  <Input placeholder={t('addLead.customerName')} value={name} onChange={(e) => setName(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('common.phone')} <span className="text-destructive">*</span></Label>
                  <Input type="tel" placeholder={t('common.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('common.email')}</Label>
                  <Input type="email" placeholder={t('common.email')} value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('addLead.currentLocation')}</Label>
                  <Input placeholder={t('addLead.currentLocation')} value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} className="h-12" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={FileText} title={t('addLead.requirements')} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('addLead.interest')}</Label>
                  <Select value={interestType} onValueChange={setInterestType}>
                    <SelectTrigger className="h-12"><SelectValue placeholder={t('addLead.selectInterest')} /></SelectTrigger>
                    <SelectContent>{INTEREST_TYPES.map((it) => <SelectItem key={it} value={it}>{it}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('addLead.propertyType')}</Label>
                  <Select value={propertyType} onValueChange={setPropertyType}>
                    <SelectTrigger className="h-12"><SelectValue placeholder={t('addLead.selectPropertyType')} /></SelectTrigger>
                    <SelectContent>{PROPERTY_TYPES.map((pt) => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('addLead.preferredProject')} <span className="text-destructive">*</span></Label>
                  <ProjectNameInput placeholder={t('addLead.enterProjectName')} value={preferredProject} onChange={setPreferredProject} required className="h-12" />
                </div>
                <div className="space-y-3 md:col-span-2">
                  <Label className="text-sm font-medium">{t('addLead.estimatedBudget')}</Label>
                  <BudgetStepperInput minValue={budgetMin} maxValue={budgetMax} isUnlimited={budgetUnlimited} step={1000} onMinChange={setBudgetMin} onMaxChange={setBudgetMax} onUnlimitedToggle={setBudgetUnlimited} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">{t('addLead.purpose')}</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger className="h-12"><SelectValue placeholder={t('addLead.selectPurpose')} /></SelectTrigger>
                    <SelectContent>{PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={TrendingUp} title={t('addLead.salesTracking')} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <div className="h-5 flex items-center"><Label className="text-sm font-medium">{t('addLead.leadSource')}</Label></div>
                  <Select value={leadSource} onValueChange={setLeadSource}>
                    <SelectTrigger className="h-12"><SelectValue placeholder={t('addLead.selectSource')} /></SelectTrigger>
                    <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="h-5 flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium shrink-0 whitespace-nowrap">{t('addLead.leadGrade')} <span className="text-destructive">*</span></Label>
                    <button type="button" onClick={handleAutoScore} disabled={aiScoring} className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-40 transition-colors">
                      {aiScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {aiScoring ? t('addLead.scoring') : t('addLead.aiScore')}
                    </button>
                  </div>
                  <Select value={leadGrade} onValueChange={setLeadGrade}>
                    <SelectTrigger className="h-12"><SelectValue placeholder={t('addLead.selectGrade')} /></SelectTrigger>
                    <SelectContent>{LEAD_GRADES.map((g) => <SelectItem key={g.value} value={g.value}>{t(`grade.${g.value}.label`)}</SelectItem>)}</SelectContent>
                  </Select>
                  {aiScoreReason && <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">{aiScoreReason}</p>}
                  <p className="text-[11px] text-muted-foreground">{t('addLead.gradeHint')}</p>
                </div>
                {/* Team first, then who on that team owns the lead — since a
                    manager can run more than one team and a salesperson can
                    sit on more than one, "team" can never be reliably
                    guessed from a name alone. */}
                {teamOptions.length > 1 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('addLead.team')} <span className="text-destructive">*</span></Label>
                    <Select value={teamId} onValueChange={setTeamId}>
                      <SelectTrigger className="h-12"><SelectValue placeholder={t('addLead.selectTeam')} /></SelectTrigger>
                      <SelectContent>
                        {teamOptions.map((tm) => (
                          <SelectItem key={tm.id} value={tm.id}>
                            {tm.name}{isAdminOrAbove(role) ? ` · ${getDepartmentLabel(tm.department_code)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">{t('addLead.teamPermissionHint')}</p>
                  </div>
                )}
                {teamOptions.length === 1 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('addLead.team')}</Label>
                    <div className="h-12 flex items-center px-4 rounded-xl border border-border bg-muted/30 text-sm text-foreground">
                      {teamOptions[0].name}
                    </div>
                  </div>
                )}
                {canAssign ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('addLead.assignToSales')}</Label>
                    <Select value={ownerId} onValueChange={setOwnerId} disabled={!teamId && teamOptions.length > 0}>
                      <SelectTrigger className="h-12"><SelectValue placeholder={!teamId && teamOptions.length > 0 ? t('addLead.selectTeamFirst') : t('addLead.assignTo')} /></SelectTrigger>
                      <SelectContent>
                        {user && <SelectItem value={user.id}>{t('addLead.myself')}</SelectItem>}
                        {teamMemberProfiles.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    {teamId && teamMemberProfiles.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">{t('addLead.noSalesInTeam')}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('addLead.owner')}</Label>
                    <Input value={t('addLead.autoAssignedToYou')} disabled className="h-12 text-sm" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t('addLead.nextFollowUpDate')}</Label>
                  <Input type="date" value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className="h-12" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={MapPin} title={t('addLead.siteDetails')} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">{t('addLead.remarks')}</Label>
                  <Textarea placeholder={t('addLead.remarksPlaceholder')} value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[100px]" />
                </div>
                {/* Both optional — either can be skipped here and added later
                    from the lead's own page once it exists. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:col-span-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('addLead.siteVisitPhoto')}</Label>
                    <input ref={visitPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => selectPhoto(e, setVisitPhotoFile, setVisitPhotoPreview)} />
                    {visitPhotoPreview ? (
                      <div className="relative rounded-xl overflow-hidden border border-border h-40">
                        <img src={visitPhotoPreview} alt="Site visit" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => { setVisitPhotoFile(null); setVisitPhotoPreview(null); if (visitPhotoInputRef.current) visitPhotoInputRef.current.value = ''; }}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform"
                          aria-label={t('addLead.removeSiteVisitPhoto')}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button" onClick={() => visitPhotoInputRef.current?.click()}
                        className="w-full h-40 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card active:bg-muted/50 transition-colors text-center px-4"
                      >
                        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Camera className="w-5 h-5 text-primary" /></div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{t('addLead.uploadSiteVisitPhoto')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('addLead.optionalCanAddLater')}</p>
                        </div>
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('addLead.appointmentPhoto')}</Label>
                    <input ref={appointmentPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => selectPhoto(e, setAppointmentPhotoFile, setAppointmentPhotoPreview)} />
                    {appointmentPhotoPreview ? (
                      <div className="relative rounded-xl overflow-hidden border border-border h-40">
                        <img src={appointmentPhotoPreview} alt="Appointment" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => { setAppointmentPhotoFile(null); setAppointmentPhotoPreview(null); if (appointmentPhotoInputRef.current) appointmentPhotoInputRef.current.value = ''; }}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform"
                          aria-label={t('addLead.removeAppointmentPhoto')}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button" onClick={() => appointmentPhotoInputRef.current?.click()}
                        className="w-full h-40 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card active:bg-muted/50 transition-colors text-center px-4"
                      >
                        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><CalendarClock className="w-5 h-5 text-primary" /></div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{t('addLead.uploadAppointmentPhoto')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('addLead.optionalCanAddLater')}</p>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* In normal flow (not fixed) — the old floating bar sat at a fixed
              64px offset that collided with the bottom tab bar (which is
              taller on phones with a safe-area inset) and hid the last form
              fields behind it. Desktop gets the sticky sidebar's submit
              button instead (below), so this is mobile/tablet only. */}
          <div className="lg:hidden space-y-3">
            {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-3">{error}</div>}
            <Button type="submit" disabled={submitting || checkingDuplicate || !allReady} className="w-full h-14 md:h-12 gradient-primary hover:gradient-primary-hover text-white font-semibold text-base transition-all duration-300 hover:shadow-card-hover active:scale-[0.98]">
              {checkingDuplicate ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('addLead.checkingDuplicates')}</>) : submitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('addLead.saving')}</>) : (<><CheckCircle2 className="w-4 h-4 mr-2" /> {t('addLead.saveLead')}</>)}
            </Button>
          </div>
        </div>

        {/* Sidebar — sticky live summary + a running checklist of the
            required fields, so there's no guessing why Save is disabled and
            no need to scroll back to the top to confirm what's been
            entered. Desktop/wide screens only; mobile keeps the plain
            in-flow submit button above since there's no room for a rail. */}
        <div className="hidden lg:block">
          {/* top-0, not some positive offset — this sidebar is the first
              thing in main's scrollable content, flush with its padding
              edge (zero natural gap above it), so any positive `top` value
              clamps it down by exactly that amount even at rest, pushing
              it out of alignment with the left column. */}
          <div className="sticky top-0 space-y-4">
            <Card className="shadow-card rounded-xl border-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center shrink-0">
                    {name.trim() ? initialsOf(name) : <User className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{name.trim() || t('addLead.newLeadFallback')}</p>
                    <p className="text-xs text-muted-foreground truncate">{phone.trim() || t('addLead.noPhoneYet')}</p>
                  </div>
                </div>
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{t('addLead.project')}</span>
                    <span className="font-medium text-foreground truncate max-w-[60%] text-right">{preferredProject.trim() || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{t('addLead.budget')}</span>
                    <span className="font-medium text-foreground tabular-nums">{budgetRangeDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{t('addLead.grade')}</span>
                    <span className="font-medium text-foreground">{leadGrade ? t(`grade.${leadGrade}.label`) : '—'}</span>
                  </div>
                  {selectedTeam && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('addLead.team')}</span>
                      <span className="font-medium text-foreground truncate max-w-[60%] text-right">{selectedTeam.name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{t('addLead.assignedTo')}</span>
                    <span className="font-medium text-foreground truncate max-w-[60%] text-right">{ownerName || '—'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card rounded-xl border-0">
              <CardContent className="p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4 text-primary" /></div>
                  <h3 className="text-sm font-semibold text-foreground">{t('addLead.beforeYouSave')}</h3>
                </div>
                <div className="space-y-2">
                  {readyChecks.map((c) => (
                    <div key={c.labelKey} className={`flex items-center gap-2 text-sm ${c.done ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {c.done ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <Circle className="w-4 h-4 shrink-0" />}
                      {t(c.labelKey)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-3">{error}</div>}
              <Button type="submit" disabled={submitting || checkingDuplicate || !allReady} className="w-full h-12 gradient-primary hover:gradient-primary-hover text-white font-semibold text-base transition-all duration-300 hover:shadow-card-hover active:scale-[0.98]">
                {checkingDuplicate ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('addLead.checkingDuplicates')}</>) : submitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('addLead.saving')}</>) : (<><CheckCircle2 className="w-4 h-4 mr-2" /> {t('addLead.saveLead')}</>)}
              </Button>
              {!allReady && <p className="text-xs text-muted-foreground text-center">{readyChecks.length - readyCount} {t('addLead.moreThingsNeeded')}</p>}
            </div>
          </div>
        </div>
        </div>
      </form>

      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle className="flex items-center gap-2 text-warning"><AlertTriangle className="w-5 h-5 text-warning" /> {t('addLead.duplicateTitle')}</DialogTitle></DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-muted-foreground">{t('addLead.duplicateBody')}</p>
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
                    <Eye className="w-3.5 h-3.5" /> <span className="hidden md:inline">{t('addLead.view')}</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1 h-11 border-border" onClick={() => setDuplicateDialogOpen(false)}>
                <X className="w-4 h-4 mr-1.5" /> {t('common.cancel')}
              </Button>
              <Button type="button" className="flex-1 h-11 gradient-primary hover:gradient-primary-hover text-white font-medium active:scale-[0.98]" onClick={proceedWithSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />} {t('addLead.addAnyway')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
