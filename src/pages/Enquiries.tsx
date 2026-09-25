import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useProfiles } from '@/hooks/useProfiles';
import {
  canAssignEnquiry, canActOnEnquiry, canEditEnquiry, canDeleteEnquiry, isExec, getRoleLabel, getDepartmentLabel, type CurrentUser,
} from '@/lib/permissions';
import { ENQUIRY_STATUSES, LEAD_SOURCES, type Enquiry, type EnquiryStatus } from '@/types';
import { enumLabel } from '@/lib/translations';
import { notifyUser } from '@/lib/notifyUser';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Inbox, Plus, Loader2, Phone as PhoneIcon, Search, CheckCircle2, ArrowRight, ExternalLink, Wallet, MessageSquare, Share2,
  Pencil, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLES: Record<EnquiryStatus, { bg: string; text: string }> = {
  pending: { bg: 'bg-warning/10', text: 'text-warning' },
  accepted: { bg: 'bg-info/10', text: 'text-info' },
  completed: { bg: 'bg-success/10', text: 'text-success' },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Exactly the three fields the business asked for — Enquiry ID, Assigned
 * To, Created Date — nothing else (no phone/budget/message: this goes into
 * a shared team group chat, not a 1:1). */
function buildViberShareText(enq: { enquiry_no: string; created_at: string }, assigneeName: string, t: (key: string) => string): string {
  return [
    `${t('enquiries.viberEnquiryId')}: ${enq.enquiry_no}`,
    `${t('enquiries.viberAssignedTo')}: ${assigneeName}`,
    `${t('enquiries.viberCreated')}: ${formatDate(enq.created_at)}`,
  ].join('\n');
}

/** Viber's `forward` deep link opens the native app's own share/forward
 * picker so the person chooses which group to post into — there's no
 * public API for posting into an arbitrary existing group chat without
 * standing up and adding a Viber bot to it, so this is the reliable,
 * zero-setup path. Must be called from a real click handler (not after an
 * `await`) or browsers treat it as an unsolicited popup and block it. */
function openViberShare(text: string) {
  window.open(`viber://forward?text=${encodeURIComponent(text)}`, '_blank');
}

export default function Enquiries() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { t, lang } = useTranslation();
  const { profiles, nameOf } = useProfiles();
  usePageHeader(t('enquiries.title'), t('enquiries.subtitle'));

  const currentUser: CurrentUser | null = user ? { id: user.id, role, department } : null;
  const canAssign = canAssignEnquiry(currentUser);

  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEnquiries = async () => {
    // RLS already scopes this — department-wide for admin, mine only for
    // manager/sale — the explicit assigned_to filter below just narrows the
    // query the same way for the non-admin view instead of relying purely
    // on RLS to trim a wider select.
    let query = supabase.from('enquiries').select('*').order('created_at', { ascending: false });
    if (!canAssign && user) query = query.eq('assigned_to', user.id);
    const { data, error } = await query;
    if (!error && data) setEnquiries(data as Enquiry[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchEnquiries();

    // Postgres_changes rides the same WebSocket the whole session — on a
    // phone, backgrounding the tab/PWA for a while lets the OS throttle or
    // drop that socket, and it doesn't always resubscribe the instant the
    // tab comes back to the front. Refetching on visibility/focus (the same
    // "trust nothing, re-check on foreground" pattern Gmail/Slack use) means
    // stale data self-heals the moment someone actually looks at the page,
    // instead of depending entirely on the socket having survived.
    const refetchOnForeground = () => {
      if (document.visibilityState === 'visible') fetchEnquiries();
    };
    document.addEventListener('visibilitychange', refetchOnForeground);
    window.addEventListener('focus', refetchOnForeground);

    const channel = supabase
      .channel(`enquiries-page-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, () => fetchEnquiries())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Covers the gap between "socket dropped while backgrounded" and
          // "resubscribed" — any change missed in that window is picked up
          // by this one extra fetch instead of silently staying stale.
          fetchEnquiries();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Enquiries realtime subscription lost:', status);
        }
      });

    return () => {
      document.removeEventListener('visibilitychange', refetchOnForeground);
      window.removeEventListener('focus', refetchOnForeground);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canAssign]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EnquiryStatus>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  // Only the assignees who actually have an enquiry right now — cheaper to
  // scan and more useful than listing every manager/sales person, most of
  // whom would show up empty.
  const assigneeOptions = useMemo(() => {
    const ids = Array.from(new Set(enquiries.map((e) => e.assigned_to)));
    return ids.map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [enquiries, nameOf]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enquiries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (assigneeFilter !== 'all' && e.assigned_to !== assigneeFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.phone.toLowerCase().includes(q) ||
        e.enquiry_no.toLowerCase().includes(q) ||
        nameOf(e.assigned_to).toLowerCase().includes(q)
      );
    });
  }, [enquiries, search, statusFilter, assigneeFilter, nameOf]);

  const assignableProfiles = useMemo(
    () => profiles.filter((p) => (p.role === 'manager' || p.role === 'sale') && p.status === 'active'),
    [profiles]
  );

  // ---- New Enquiry / Edit Enquiry dialog — same form serves both, keyed
  // off editTarget being set or not, so the fields don't need duplicating. ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Enquiry | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [budget, setBudget] = useState('');
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName(''); setPhone(''); setBudget(''); setSource(''); setMessage(''); setAssignTo('');
  };

  const openCreateDialog = () => {
    resetForm();
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEditDialog = (enq: Enquiry) => {
    setEditTarget(enq);
    setName(enq.name);
    setPhone(enq.phone);
    setBudget(enq.budget || '');
    setSource(enq.source || '');
    setMessage(enq.message || '');
    setAssignTo(enq.assigned_to);
    setDialogOpen(true);
  };

  const handleUpdate = async (enq: Enquiry) => {
    const { error } = await supabase.from('enquiries').update({
      name: name.trim(),
      phone: phone.trim(),
      budget: budget.trim() || null,
      source: source || null,
      message: message.trim() || null,
      assigned_to: assignTo,
    }).eq('id', enq.id);
    if (error) { toast.error(error.message || t('enquiries.updateError')); return; }
    toast.success(t('enquiries.updatedToast'));
    resetForm();
    setEditTarget(null);
    setDialogOpen(false);
  };

  const handleCreate = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('enquiries').insert({
      name: name.trim(),
      phone: phone.trim(),
      budget: budget.trim() || null,
      source: source || null,
      message: message.trim() || null,
      assigned_to: assignTo,
      assigned_by: user.id,
    }).select('id, enquiry_no, created_at').single();
    if (error) { toast.error(error.message || t('enquiries.createError')); return; }
    notifyUser({
      recipientId: assignTo,
      type: 'new_enquiry_assigned',
      title: t('enquiries.pushTitle'),
      body: `${name.trim()} (${data.enquiry_no})`,
      relatedEnquiryId: data.id,
      url: '/enquiries',
    });

    const assigneeName = assignableProfiles.find((p) => p.id === assignTo)?.name || '';
    toast.success(t('enquiries.createdToast'), {
      action: {
        label: t('enquiries.shareToViber'),
        onClick: () => openViberShare(buildViberShareText(data, assigneeName, t)),
      },
    });
    resetForm();
    setDialogOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !assignTo || !user) {
      toast.error(t('enquiries.requiredFieldsError'));
      return;
    }
    setSaving(true);
    if (editTarget) await handleUpdate(editTarget);
    else await handleCreate();
    setSaving(false);
  };

  // ---- Delete ----
  const [deleteTarget, setDeleteTarget] = useState<Enquiry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('enquiries').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) { toast.error(error.message || t('enquiries.deleteError')); return; }
    toast.success(t('enquiries.deletedToast'));
    setDeleteTarget(null);
  };

  // ---- Accept ----
  const [accepting, setAccepting] = useState<string | null>(null);
  const handleAccept = async (enq: Enquiry) => {
    setAccepting(enq.id);
    const { error } = await supabase.from('enquiries').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', enq.id);
    setAccepting(null);
    if (error) { toast.error(error.message || t('enquiries.acceptError')); return; }
    toast.success(t('enquiries.acceptedToast'));
    // Ping the Admin who made the assignment — they don't otherwise learn
    // that their enquiry was picked up until they check the page themselves.
    if (enq.assigned_by) {
      notifyUser({
        recipientId: enq.assigned_by,
        type: 'enquiry_accepted',
        title: t('enquiries.acceptedPushTitle'),
        body: `${user?.name || ''} — ${enq.name} (${enq.enquiry_no})`,
        relatedEnquiryId: enq.id,
        url: '/enquiries',
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      <div className="mb-1 md:hidden">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">{t('enquiries.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('enquiries.subtitle')}</p>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 md:p-5 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('enquiries.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | EnquiryStatus)}>
            <SelectTrigger className="h-11 sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('enquiries.allStatuses')}</SelectItem>
              {ENQUIRY_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{enumLabel('enquiryStatus', s.value, s.label, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canAssign && assigneeOptions.length > 0 && (
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-11 sm:w-48"><SelectValue placeholder={t('enquiries.allAssignees')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('enquiries.allAssignees')}</SelectItem>
                {assigneeOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canAssign && (
            <Button onClick={openCreateDialog} className="h-11 gap-1.5 shrink-0">
              <Plus className="w-4 h-4" /> {t('enquiries.newEnquiry')}
            </Button>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border">
          <Inbox className="w-9 h-9 mb-2 opacity-40" />
          <p className="text-sm font-medium">{t('enquiries.noEnquiries')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((enq) => {
            const style = STATUS_STYLES[enq.status];
            const canAct = canActOnEnquiry(currentUser, { assignedTo: enq.assigned_to });
            const canEdit = canEditEnquiry(currentUser, { status: enq.status });
            const canDelete = canDeleteEnquiry(currentUser, { status: enq.status });
            return (
              <Card key={enq.id} className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
                <CardContent className="p-4 md:p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-muted-foreground tracking-wide">{enq.enquiry_no}</p>
                      <p className="text-sm font-semibold text-foreground truncate mt-0.5">{enq.name}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${style.bg} ${style.text}`}>
                        {enumLabel('enquiryStatus', enq.status, enq.status, lang)}
                      </span>
                      <button
                        type="button"
                        onClick={() => openViberShare(buildViberShareText(enq, nameOf(enq.assigned_to), t))}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label={t('enquiries.shareToViber')}
                        title={t('enquiries.shareToViber')}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openEditDialog(enq)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          aria-label={t('common.edit')}
                          title={t('common.edit')}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(enq)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground"><PhoneIcon className="w-3.5 h-3.5 shrink-0" /> {enq.phone}</div>
                    {enq.budget && <div className="flex items-center gap-1.5 text-muted-foreground"><Wallet className="w-3.5 h-3.5 shrink-0" /> {enq.budget}</div>}
                    {enq.message && <div className="flex items-start gap-1.5 text-muted-foreground"><MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span className="line-clamp-2">{enq.message}</span></div>}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 text-xs text-muted-foreground">
                    <span>{canAssign ? `${t('enquiries.assignedToLabel')}: ${nameOf(enq.assigned_to)}` : `${t('enquiries.assignedByLabel')}: ${nameOf(enq.assigned_by)}`}</span>
                    <span>{formatDate(enq.created_at)}</span>
                  </div>

                  {enq.status === 'pending' && canAct && (
                    <Button size="sm" className="w-full h-9 gap-1.5" disabled={accepting === enq.id} onClick={() => handleAccept(enq)}>
                      {accepting === enq.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} {t('enquiries.accept')}
                    </Button>
                  )}
                  {enq.status === 'accepted' && canAct && (
                    <Button size="sm" className="w-full h-9 gap-1.5" onClick={() => navigate(`/add-lead?enquiry=${enq.id}`)}>
                      <ArrowRight className="w-3.5 h-3.5" /> {t('enquiries.convertToLead')}
                    </Button>
                  )}
                  {enq.status === 'completed' && enq.converted_lead_id && (
                    <Button size="sm" variant="outline" className="w-full h-9 gap-1.5" onClick={() => navigate(`/lead/${enq.converted_lead_id}`)}>
                      <ExternalLink className="w-3.5 h-3.5" /> {t('enquiries.viewLead')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { resetForm(); setEditTarget(null); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle>{editTarget ? t('enquiries.editEnquiry') : t('enquiries.newEnquiry')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('enquiries.name')} <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" required />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('common.phone')} <span className="text-destructive">*</span></Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" required />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('enquiries.budget')}</Label>
                <Input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('enquiries.budgetPlaceholder')} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('addLead.leadSource')}</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={t('addLead.selectSource')} /></SelectTrigger>
                  <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-sm font-medium">{t('enquiries.assignTo')} <span className="text-destructive">*</span></Label>
                <Select value={assignTo} onValueChange={setAssignTo}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={t('enquiries.selectAssignee')} /></SelectTrigger>
                  <SelectContent>
                    {assignableProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {getRoleLabel(p.role, lang)}{isExec(role) ? ` · ${getDepartmentLabel(p.department_code)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-sm font-medium">{t('enquiries.message')}</Label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-[90px]" placeholder={t('enquiries.messagePlaceholder')} />
              </div>
            </div>
            <Button type="submit" disabled={saving} className="w-full h-11 gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editTarget ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {editTarget ? t('common.saveChanges') : t('enquiries.createEnquiry')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('enquiries.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('enquiries.deleteBody')}: {deleteTarget?.enquiry_no}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(e) => { e.preventDefault(); handleDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
