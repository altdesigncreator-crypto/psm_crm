import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useProfiles } from '@/hooks/useProfiles';
import { useTeams } from '@/hooks/useTeams';
import { usePeriodFilter, type Period } from '@/hooks/usePeriodFilter';
import PeriodFilterBar from '@/components/PeriodFilterBar';
import {
  canAssignEnquiry, canActOnEnquiry, canEditEnquiry, canDeleteEnquiry, isExec, getRoleLabel, getDepartmentLabel, type CurrentUser,
} from '@/lib/permissions';
import { ENQUIRY_STATUSES, CONDO_SOURCES, HOUSE_LAND_SOURCES, type Enquiry, type EnquiryStatus } from '@/types';
import { enumLabel } from '@/lib/translations';
import { notifyUser } from '@/lib/notifyUser';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Inbox, Plus, Loader2, Phone as PhoneIcon, Search, CheckCircle2, ArrowRight, ExternalLink, Wallet, MessageSquare, Share2,
  Pencil, Trash2, SlidersHorizontal, Filter, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
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

interface SourceGroup { key: string; label: string; sources: string[] }

// Some sources (e.g. "Boss Viber") exist under both categories, so options
// are keyed "<group>::<source>" to keep Select values unique; filtering
// always compares on the source part alone.
const SOURCE_KEY_SEP = '::';
const sourceFilterKey = (group: string, source: string) => `${group}${SOURCE_KEY_SEP}${source}`;
const sourceFromKey = (key: string) => key.slice(key.indexOf(SOURCE_KEY_SEP) + SOURCE_KEY_SEP.length);

interface EnquiriesListUiState {
  search: string;
  statusFilter: 'all' | EnquiryStatus;
  sourceFilter: string;
  teamFilter: string;
  assigneeFilter: string;
  period: Period;
  selectedMonth: number;
  selectedYear: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

// Module-level so filters survive navigating to Convert-to-Lead / View Lead and back.
let cachedListState: EnquiriesListUiState | null = null;

interface EnquiryFilterFieldsProps {
  statusFilter: 'all' | EnquiryStatus;
  setStatusFilter: (v: 'all' | EnquiryStatus) => void;
  showStatus: boolean;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  sourceGroups: SourceGroup[];
  showStaffFilters: boolean;
  teamFilter: string;
  onTeamChange: (v: string) => void;
  teamOptions: { id: string; name: string }[];
  assigneeFilter: string;
  setAssigneeFilter: (v: string) => void;
  assigneeOptions: { id: string; name: string }[];
}

function EnquiryFilterFields({
  statusFilter, setStatusFilter, showStatus, sourceFilter, setSourceFilter, sourceGroups,
  showStaffFilters, teamFilter, onTeamChange, teamOptions, assigneeFilter, setAssigneeFilter, assigneeOptions,
}: EnquiryFilterFieldsProps) {
  const { t, lang } = useTranslation();
  return (
    <>
      {showStatus && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('leads.filter.status')}</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | EnquiryStatus)}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectStatus')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('enquiries.allStatuses')}</SelectItem>
              {ENQUIRY_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{enumLabel('enquiryStatus', s.value, s.label, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('addLead.leadSource')}</label>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('addLead.selectSource')} /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">{t('enquiries.allSources')}</SelectItem>
            {sourceGroups.map((g) => (
              <React.Fragment key={g.key}>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">{g.label}</SelectLabel>
                  {g.sources.map((s) => (
                    <SelectItem key={s} value={sourceFilterKey(g.key, s)}>{s}</SelectItem>
                  ))}
                </SelectGroup>
              </React.Fragment>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showStaffFilters && teamOptions.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('leads.filter.team')}</label>
          <Select value={teamFilter} onValueChange={onTeamChange}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectTeam')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('leads.filter.allTeams')}</SelectItem>
              {teamOptions.map((tm) => (<SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
      {showStaffFilters && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('leads.filter.salesPerson')}</label>
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectSalesPerson')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('leads.filter.allSalesPeople')}</SelectItem>
              {assigneeOptions.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
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

  // Initial load, realtime events and window focus can all fire overlapping
  // fetches; only the latest one may write state.
  const fetchSeqRef = useRef(0);

  const fetchEnquiries = async () => {
    const seq = ++fetchSeqRef.current;
    try {
      // RLS already scopes this (department-wide for admin, mine only for
      // manager/sale); the assigned_to filter mirrors that for the non-admin view.
      const rows = await fetchAllRows<Enquiry>('enquiries');
      if (seq !== fetchSeqRef.current) return;
      setEnquiries(!canAssign && user ? rows.filter((e) => e.assigned_to === user.id) : rows);
    } catch (err) {
      if (seq === fetchSeqRef.current) console.error('Failed to load enquiries:', err);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
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

  const { teams, membersOf } = useTeams();
  const restoredState = cachedListState;
  const [search, setSearch] = useState(() => restoredState?.search ?? '');
  const [statusFilter, setStatusFilter] = useState<'all' | EnquiryStatus>(() => restoredState?.statusFilter ?? 'all');
  const [sourceFilter, setSourceFilter] = useState(() => restoredState?.sourceFilter ?? 'all');
  const [teamFilter, setTeamFilter] = useState(() => restoredState?.teamFilter ?? 'all');
  const [assigneeFilter, setAssigneeFilter] = useState(() => restoredState?.assigneeFilter ?? 'all');
  // Defaults to Overall rather than Monthly: this is a work queue, and a
  // month-scoped default would hide still-pending enquiries from last month.
  const {
    period, setPeriod, selectedMonth, selectedYear, isCurrentPeriod, shiftPeriod, periodLabel, matchesPeriod,
  } = usePeriodFilter(restoredState ?? { period: 'overall' });

  const [page, setPage] = useState(() => restoredState?.page ?? 1);
  const [pageSize, setPageSize] = useState(() => restoredState?.pageSize ?? 20);

  useEffect(() => {
    cachedListState = { search, statusFilter, sourceFilter, teamFilter, assigneeFilter, period, selectedMonth, selectedYear, page, pageSize };
  }, [search, statusFilter, sourceFilter, teamFilter, assigneeFilter, period, selectedMonth, selectedYear, page, pageSize]);

  // Skips the first run so a page restored from cachedListState isn't reset on mount.
  const isFirstFilterRunRef = useRef(true);
  useEffect(() => {
    if (isFirstFilterRunRef.current) { isFirstFilterRunRef.current = false; return; }
    setPage(1);
  }, [search, statusFilter, sourceFilter, teamFilter, assigneeFilter, period, selectedMonth, selectedYear, pageSize]);

  // Staff-level filters only make sense for people who see more than their own queue.
  const showStaffFilters = canAssign;

  const teamOptions = useMemo(() => teams.filter((tm) => tm.is_active), [teams]);

  // Enquiries carry no team_id, so a team matches by who they're assigned to:
  // the team's manager plus its members.
  const teamAssigneeIds = useMemo(() => {
    if (teamFilter === 'all') return null;
    const managerId = teams.find((tm) => tm.id === teamFilter)?.manager_id;
    return new Set([...membersOf(teamFilter), ...(managerId ? [managerId] : [])]);
  }, [teamFilter, teams, membersOf]);

  // Only the assignees who actually have an enquiry right now — cheaper to
  // scan and more useful than listing every manager/sales person, most of
  // whom would show up empty. Narrowed to the selected team, if any.
  const assigneeOptions = useMemo(() => {
    const ids = Array.from(new Set(enquiries.map((e) => e.assigned_to)))
      .filter((id) => !teamAssigneeIds || teamAssigneeIds.has(id));
    return ids.map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [enquiries, nameOf, teamAssigneeIds]);

  const handleTeamChange = (teamId: string) => {
    setTeamFilter(teamId);
    if (teamId === 'all' || assigneeFilter === 'all') return;
    const managerId = teams.find((tm) => tm.id === teamId)?.manager_id;
    if (assigneeFilter !== managerId && !membersOf(teamId).includes(assigneeFilter)) setAssigneeFilter('all');
  };

  const sourceGroups = useMemo<SourceGroup[]>(() => {
    const known = new Set<string>([...CONDO_SOURCES, ...HOUSE_LAND_SOURCES]);
    const legacy = Array.from(new Set(enquiries.map((e) => e.source).filter((s): s is string => !!s && !known.has(s)))).sort();
    return [
      { key: 'condo', label: t('enquiries.categoryCondo'), sources: CONDO_SOURCES },
      { key: 'house_land', label: t('enquiries.categoryHouseLand'), sources: HOUSE_LAND_SOURCES },
      ...(legacy.length > 0 ? [{ key: 'other', label: t('enquiries.otherSources'), sources: legacy }] : []),
    ];
  }, [enquiries, t]);

  const selectedSource = sourceFilter === 'all' ? null : sourceFromKey(sourceFilter);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enquiries.filter((e) => {
      if (!matchesPeriod(e.created_at)) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (selectedSource && e.source !== selectedSource) return false;
      if (teamAssigneeIds && !teamAssigneeIds.has(e.assigned_to)) return false;
      if (assigneeFilter !== 'all' && e.assigned_to !== assigneeFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.phone.toLowerCase().includes(q) ||
        e.enquiry_no.toLowerCase().includes(q) ||
        nameOf(e.assigned_to).toLowerCase().includes(q)
      );
    });
  }, [enquiries, search, statusFilter, selectedSource, teamAssigneeIds, assigneeFilter, matchesPeriod, nameOf]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Derived rather than stored, so realtime deletes shrinking the list can
  // never strand the user on an empty page past the end.
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedEnquiries = useMemo(() => filtered.slice(pageStart, pageStart + pageSize), [filtered, pageStart, pageSize]);

  const listTopRef = useRef<HTMLDivElement>(null);
  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const activeChips = [
    { key: 'status', active: statusFilter !== 'all', label: statusFilter !== 'all' ? enumLabel('enquiryStatus', statusFilter, statusFilter, lang) : '', clear: () => setStatusFilter('all') },
    { key: 'source', active: !!selectedSource, label: selectedSource ?? '', clear: () => setSourceFilter('all') },
    { key: 'team', active: teamFilter !== 'all', label: teamOptions.find((tm) => tm.id === teamFilter)?.name ?? '', clear: () => setTeamFilter('all') },
    { key: 'assignee', active: assigneeFilter !== 'all', label: nameOf(assigneeFilter), clear: () => setAssigneeFilter('all') },
  ].filter((c) => c.active);
  // Status has its own always-visible control on desktop, so it isn't counted on the desktop Filters badge.
  const panelFilterCount = activeChips.filter((c) => c.key !== 'status').length;
  const hasActiveFilters = activeChips.length > 0 || !!search.trim() || period !== 'overall';

  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('all'); setSourceFilter('all'); setTeamFilter('all'); setAssigneeFilter('all'); setPeriod('overall');
  };

  const filterFieldProps = {
    statusFilter, setStatusFilter, sourceFilter, setSourceFilter, sourceGroups,
    showStaffFilters, teamFilter, onTeamChange: handleTeamChange, teamOptions,
    assigneeFilter, setAssigneeFilter, assigneeOptions,
  };

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
  const [sourceCategory, setSourceCategory] = useState<'condo' | 'house_land'>('condo');
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [saving, setSaving] = useState(false);

  const sourceOptions = sourceCategory === 'house_land' ? HOUSE_LAND_SOURCES : CONDO_SOURCES;

  const resetForm = () => {
    setName(''); setPhone(''); setBudget(''); setSourceCategory('condo'); setSource(''); setMessage(''); setAssignTo('');
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
    setSourceCategory(HOUSE_LAND_SOURCES.includes(enq.source || '') ? 'house_land' : 'condo');
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

      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardContent className="p-4 md:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border/60">
            <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
            {canAssign && (
              <Button onClick={openCreateDialog} className="h-11 gap-1.5 shrink-0">
                <Plus className="w-4 h-4" /> {t('enquiries.newEnquiry')}
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('enquiries.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 pl-9 rounded-lg bg-muted/40 border-transparent focus-visible:bg-card focus-visible:border-input transition-colors"
              />
            </div>

            <div className="hidden md:flex items-center gap-2 shrink-0">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | EnquiryStatus)}>
                <SelectTrigger className="w-[160px] h-11 rounded-lg bg-muted/40 border-transparent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('enquiries.allStatuses')}</SelectItem>
                  {ENQUIRY_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{enumLabel('enquiryStatus', s.value, s.label, lang)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3.5 h-11 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    {t('leads.filters')}
                    {panelFilterCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{panelFilterCount}</span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                  <EnquiryFilterFields {...filterFieldProps} showStatus={false} />
                </PopoverContent>
              </Popover>
            </div>

            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label={t('leads.filters')}
                  className="md:hidden flex items-center gap-1.5 px-3.5 h-11 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('leads.filters')}</span>
                  {activeChips.length > 0 && (
                    <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{activeChips.length}</span>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-6 pb-8 max-h-[85dvh] overflow-y-auto">
                <SheetHeader className="pb-4">
                  <SheetTitle className="flex items-center gap-2 text-base font-semibold">
                    <Filter className="w-4 h-4 text-primary" /> {t('leads.searchFilterSheetTitle')}
                  </SheetTitle>
                </SheetHeader>
                <div className="space-y-5">
                  <EnquiryFilterFields {...filterFieldProps} showStatus />
                  <SheetClose asChild>
                    <button type="button" className="w-full h-12 text-sm font-medium transition-colors rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80">
                      {t('common.done')}
                    </button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {(activeChips.length > 0 || !loading) && (
            <div className="flex flex-wrap items-center gap-2">
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.clear}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:bg-primary/20 transition-colors"
                >
                  {c.label}
                  <X className="w-3 h-3" />
                </button>
              ))}
              {activeChips.length > 1 && (
                <button type="button" onClick={clearAllFilters} className="px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  {t('enquiries.clearFilters')}
                </button>
              )}
              {!loading && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {filtered.length} / {enquiries.length} {t('enquiries.resultsSuffix')}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border">
          <Inbox className="w-9 h-9 mb-2 opacity-40" />
          <p className="text-sm font-medium">{enquiries.length > 0 && hasActiveFilters ? t('enquiries.noMatches') : t('enquiries.noEnquiries')}</p>
          {enquiries.length > 0 && hasActiveFilters && (
            <Button variant="link" size="sm" onClick={clearAllFilters} className="mt-1">{t('enquiries.clearFilters')}</Button>
          )}
        </div>
      ) : (
        <div ref={listTopRef} className="space-y-4 scroll-mt-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pagedEnquiries.map((enq) => {
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
  
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 rounded-xl bg-card shadow-card">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                {t('leads.showing')} <span className="font-medium text-foreground tabular-nums">{pageStart + 1}</span>
                –<span className="font-medium text-foreground tabular-nums">{pageStart + pagedEnquiries.length}</span>
                {' '}{t('leads.of')} <span className="font-medium text-foreground tabular-nums">{filtered.length}</span>
              </span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[100px] text-xs" aria-label={t('leads.perPage')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (<SelectItem key={n} value={String(n)}>{n} {t('leads.perPage')}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {totalPages > 1 && (
              <nav className="flex items-center gap-1" aria-label={t('enquiries.pagination')}>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={currentPage <= 1} onClick={() => goToPage(1)} aria-label={t('leads.firstPage')}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} aria-label={t('leads.previousPage')}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-xs font-medium text-foreground tabular-nums whitespace-nowrap" aria-live="polite">
                  {t('leads.pageOf')} {currentPage} / {totalPages}
                </span>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)} aria-label={t('leads.nextPage')}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={currentPage >= totalPages} onClick={() => goToPage(totalPages)} aria-label={t('leads.lastPage')}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </nav>
            )}
          </div>
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
                <Label className="text-sm font-medium">{t('enquiries.sourceCategory')}</Label>
                <Select
                  value={sourceCategory}
                  onValueChange={(v) => { setSourceCategory(v as 'condo' | 'house_land'); setSource(''); }}
                >
                  <SelectTrigger className="h-11"><SelectValue placeholder={t('enquiries.selectSourceCategory')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="condo">{t('enquiries.categoryCondo')}</SelectItem>
                    <SelectItem value="house_land">{t('enquiries.categoryHouseLand')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('addLead.leadSource')}</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={t('addLead.selectSource')} /></SelectTrigger>
                  <SelectContent>{sourceOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
