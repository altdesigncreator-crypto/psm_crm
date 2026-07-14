import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, User, Phone, Mail, MapPin, Building2, DollarSign, Target, Calendar,
  TrendingUp, MessageSquare, Navigation, Clock, FileText, Loader2,
  Plus, AlertTriangle, ArrowRightLeft, History, Trash2,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FOLLOWUP_TYPES, FOLLOWUP_STATUSES, LEAD_STAGES, WARNING_REASONS, getGradeForFollowUpStatus, type Lead, type FollowUp, type Warning as WarningRecord } from '@/types';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/contexts/AuthContext';
import { canEditLead, canAddFollowUp, canAssignLead, canIssueWarning, canMonitorLead, isManagerOrAbove, isExec } from '@/lib/permissions';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';

interface DetailRowProps { label: string; value?: string | null; icon?: React.ReactNode; }

function DetailRow({ label, value, icon }: DetailRowProps) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 min-h-[48px]">
      {icon && <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

function stageLabel(status: string) {
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [warnings, setWarnings] = useState<WarningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const { colors: statusColors } = useStatusColors();
  const { profiles, nameOf } = useProfiles();

  const [followUpForm, setFollowUpForm] = useState({ type: 'phone', status: 'interested', notes: '' });
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [warningForm, setWarningForm] = useState({ reason: 'followup_overdue', message: '' });
  const [savingWarning, setSavingWarning] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const currentUser = user ? { id: user.id, role, department: user.department } : null;

  const loadAll = useCallback(async () => {
    if (!id) return;
    const [leadRes, followUpsRes, warningsRes] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id).single(),
      supabase.from('follow_ups').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      supabase.from('warnings').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    ]);
    if (leadRes.data) setLead(leadRes.data as Lead);
    setFollowUps((followUpsRes.data || []) as FollowUp[]);
    setWarnings((warningsRes.data || []) as WarningRecord[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const departmentStaff = profiles.filter((p) => p.department_code === lead?.department_code && p.role === 'sale');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground">
        <FileText className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">Lead not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/leads')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Leads
        </Button>
      </div>
    );
  }

  const editable = canEditLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code }) && lead.status !== 'sold';
  const canFollowUp = canAddFollowUp(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code });
  const canWarn = canIssueWarning(currentUser) && canMonitorLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code });
  const canReassign = canAssignLead(currentUser) && canMonitorLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code });
  // Exec-only (boss / super admin), matching the leads_delete RLS policy.
  const canDelete = isExec(role);

  const handleDeleteLead = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.from('leads').delete().eq('id', lead.id);
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        action: 'lead_deleted',
        target_table: 'leads',
        target_id: lead.id,
        performed_by: user?.id,
        old_value: { name: lead.name, phone: lead.phone, owner_id: lead.owner_id },
      });
      toast.success(`Lead "${lead.name}" deleted.`);
      navigate('/leads');
    } catch {
      toast.error('Could not delete the lead.');
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const handleStageChange = async (newStage: string) => {
    if (lead.status === 'sold') { toast.error('This lead is Sold — its stage can no longer be changed.'); return; }
    const { error } = await supabase.from('leads').update({ status: newStage }).eq('id', lead.id);
    if (error) { toast.error(error.message.includes('Sold') ? error.message : 'Could not update stage.'); return; }
    setLead((prev) => (prev ? { ...prev, status: newStage as Lead['status'] } : prev));
    toast.success('Pipeline stage updated.');
  };

  const handleAddFollowUp = async () => {
    if (!followUpForm.notes.trim()) { toast.error('Add a note for this follow-up.'); return; }
    setSavingFollowUp(true);
    const { error } = await supabase.from('follow_ups').insert({
      lead_id: lead.id, created_by: user?.id,
      type: followUpForm.type, status: followUpForm.status, notes: followUpForm.notes,
    });
    setSavingFollowUp(false);
    if (error) { toast.error('Could not add follow-up.'); return; }
    setFollowUpForm({ type: 'phone', status: 'interested', notes: '' });
    toast.success('Follow-up added.');
    loadAll();
  };

  const handleIssueWarning = async () => {
    if (!lead.owner_id) { toast.error('This lead has no owner to warn.'); return; }
    setSavingWarning(true);
    const { error } = await supabase.from('warnings').insert({
      lead_id: lead.id, issued_to: lead.owner_id, issued_by: user?.id,
      reason: warningForm.reason, message: warningForm.message || null,
    });
    setSavingWarning(false);
    if (error) { toast.error('Could not issue warning.'); return; }
    setWarningForm({ reason: 'followup_overdue', message: '' });
    toast.success('Warning issued.');
    loadAll();
  };

  const handleReassign = async () => {
    if (!reassignTo) return;
    const { error } = await supabase.rpc('reassign_lead', { p_lead_id: lead.id, p_new_owner: reassignTo });
    if (error) { toast.error('Could not reassign lead.'); return; }
    toast.success('Lead reassigned.');
    setReassignTo('');
    loadAll();
  };

  const createdDate = new Date(lead.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      {/* Header — on phones the controls cluster (grade / status / delete) is
          wider than the space left next to the back arrow and title, so it
          wraps onto its own full-width second row; from `sm:` up everything
          sits inline as before. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/leads')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Lead Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{lead.name} — {lead.phone}</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
          <LeadLevelBadge grade={lead.lead_grade} />
          {editable ? (
            <Select value={lead.status} onValueChange={handleStageChange}>
              <SelectTrigger className="h-9 flex-1 sm:flex-none sm:w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_STAGES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
              </SelectContent>
            </Select>
          ) : (
            <StatusBadge status={stageLabel(lead.status)} color={statusColors[lead.status] || '#8FA3BF'} className="px-4 py-1.5 text-sm font-semibold" />
          )}
          {canDelete && (
            <Button variant="outline" size="icon" onClick={() => setDeleteOpen(true)} className="h-9 w-9 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive" aria-label="Delete lead">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Delete confirmation (exec only) */}
      <AlertDialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              "{lead.name}" and all of its follow-ups, warnings and history will be
              permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); handleDeleteLead(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mobile quick actions */}
      <div className="md:hidden flex items-center gap-2 -mx-4 px-4 py-3 bg-card border-y border-border sticky top-0 z-30">
        {lead.phone && (
          <a href={`tel:${lead.phone}`} className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl bg-primary text-white font-medium text-sm active:bg-primary/90 active:scale-[0.98] transition-all shadow-sm">
            <Phone className="w-4 h-4" /> Call
          </a>
        )}
        {lead.latitude && lead.longitude && (
          <button type="button" onClick={() => setMapOpen(true)} className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl border border-primary/30 text-primary font-medium text-sm active:bg-primary/5 active:scale-[0.98] transition-all">
            <MapPin className="w-4 h-4" /> Location
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Left column */}
        <div className="lg:col-span-1 space-y-4 md:space-y-6">
          <Card className="shadow-card rounded-xl border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><User className="w-4 h-4 text-primary" /></div>
                Basic Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              <DetailRow label="Customer Name" value={lead.name} icon={<User className="w-4 h-4" />} />
              <DetailRow label="Phone" value={lead.phone} icon={<Phone className="w-4 h-4" />} />
              <DetailRow label="Email" value={lead.email} icon={<Mail className="w-4 h-4" />} />
              <DetailRow label="Current Location" value={lead.current_location} icon={<MapPin className="w-4 h-4" />} />
              <DetailRow label="Created" value={createdDate} icon={<Clock className="w-4 h-4" />} />
              {lead.lead_grade_reason && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">{lead.lead_grade_reason}</p>
              )}
            </CardContent>
          </Card>

          {canReassign && (
            <Card className="shadow-card rounded-xl border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><ArrowRightLeft className="w-4 h-4 text-primary" /></div>
                  Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <DetailRow label="Currently owned by" value={nameOf(lead.owner_id)} icon={<User className="w-4 h-4" />} />
                <div className="flex gap-2">
                  <Select value={reassignTo} onValueChange={setReassignTo}>
                    <SelectTrigger className="h-11 flex-1"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                    <SelectContent>
                      {departmentStaff.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Button disabled={!reassignTo} onClick={handleReassign} className="h-11">Reassign</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {lead.latitude && lead.longitude && (
            <Card className="shadow-card rounded-xl border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Navigation className="w-4 h-4 text-primary" /></div>
                  Recorded Location
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <DetailRow label="Latitude" value={lead.latitude.toFixed(6)} icon={<MapPin className="w-4 h-4" />} />
                <DetailRow label="Longitude" value={lead.longitude.toFixed(6)} icon={<MapPin className="w-4 h-4" />} />
                <Button variant="outline" className="w-full h-12 gap-2 text-primary border-primary/30 hover:bg-primary/5" onClick={() => setMapOpen(true)}>
                  <MapPin className="w-4 h-4" /> View on map
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <Card className="shadow-card rounded-xl border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Target className="w-4 h-4 text-primary" /></div>
                Requirements
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                <DetailRow label="Interest" value={lead.interest_type} icon={<TrendingUp className="w-4 h-4" />} />
                <DetailRow label="Property Type" value={lead.property_type} icon={<Building2 className="w-4 h-4" />} />
                <DetailRow label="Preferred Project" value={lead.preferred_project} icon={<Building2 className="w-4 h-4" />} />
                <DetailRow label="Budget" value={lead.budget_range} icon={<DollarSign className="w-4 h-4" />} />
                <DetailRow label="Purpose" value={lead.purpose} icon={<Target className="w-4 h-4" />} />
                <DetailRow label="Source" value={lead.lead_source} icon={<TrendingUp className="w-4 h-4" />} />
              </div>
              {lead.remarks && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-start gap-3 py-1">
                    <MessageSquare className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Remarks</p>
                      <p className="text-sm font-medium text-foreground mt-1 break-words leading-relaxed">{lead.remarks}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Follow-ups */}
          <Card className="shadow-card rounded-xl border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><History className="w-4 h-4 text-primary" /></div>
                Follow-ups ({followUps.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {canFollowUp && (
                <div className="rounded-xl border border-border p-3 space-y-3 bg-muted/20">
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={followUpForm.type} onValueChange={(v) => setFollowUpForm((f) => ({ ...f, type: v }))}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>{FOLLOWUP_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}</SelectContent>
                    </Select>
                    <Select value={followUpForm.status} onValueChange={(v) => setFollowUpForm((f) => ({ ...f, status: v }))}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>{FOLLOWUP_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    placeholder="What happened in this follow-up?"
                    value={followUpForm.notes}
                    onChange={(e) => setFollowUpForm((f) => ({ ...f, notes: e.target.value }))}
                    className="min-h-[70px]"
                  />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>This outcome will set the lead's grade to</span>
                    <LeadLevelBadge grade={getGradeForFollowUpStatus(followUpForm.status as any)} />
                  </div>
                  <Button onClick={handleAddFollowUp} disabled={savingFollowUp} className="w-full sm:w-auto gap-2">
                    {savingFollowUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Follow-up
                  </Button>
                </div>
              )}
              {followUps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No follow-ups recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {followUps.map((f) => (
                    <div key={f.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{FOLLOWUP_TYPES.find((t) => t.value === f.type)?.label}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{FOLLOWUP_STATUSES.find((s) => s.value === f.status)?.label}</span>
                        </div>
                        {f.notes && <p className="text-sm text-muted-foreground mt-1">{f.notes}</p>}
                        <p className="text-xs text-muted-foreground mt-1">{new Date(f.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Warnings */}
          {(canWarn || warnings.length > 0) && (
            <Card className="shadow-card rounded-xl border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-destructive" /></div>
                  Warnings ({warnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {canWarn && (
                  <div className="rounded-xl border border-border p-3 space-y-3 bg-muted/20">
                    <Select value={warningForm.reason} onValueChange={(v) => setWarningForm((f) => ({ ...f, reason: v }))}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>{WARNING_REASONS.map((r) => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}</SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Message to the salesperson (optional)"
                      value={warningForm.message}
                      onChange={(e) => setWarningForm((f) => ({ ...f, message: e.target.value }))}
                      className="min-h-[60px]"
                    />
                    <Button variant="destructive" onClick={handleIssueWarning} disabled={savingWarning} className="w-full sm:w-auto gap-2">
                      {savingWarning ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} Issue Warning
                    </Button>
                  </div>
                )}
                {warnings.map((w) => (
                  <div key={w.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-destructive">{WARNING_REASONS.find((r) => r.value === w.reason)?.label}</span>
                      {w.message && <p className="text-sm text-muted-foreground mt-1">{w.message}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{new Date(w.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Map Modal */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-base font-semibold">Lead Location</DialogTitle>
          </DialogHeader>
          {lead.latitude && lead.longitude && (
            <div className="px-6 pb-6">
              <p className="text-sm text-muted-foreground mb-3">{lead.name} — Lat: {lead.latitude.toFixed(5)}, Lng: {lead.longitude.toFixed(5)}</p>
              <div className="w-full aspect-video rounded-lg overflow-hidden border border-border">
                <iframe
                  title="Lead Location" width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${lead.latitude},${lead.longitude}&z=15&output=embed`}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
