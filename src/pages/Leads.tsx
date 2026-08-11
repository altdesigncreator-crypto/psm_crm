import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose,
} from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MapPin, FileText, Search, Filter, Eye, Phone, Calendar, User as UserIcon, X, SlidersHorizontal, MoreVertical, PhoneCall, Navigation, Upload, Loader2, Download, FileSpreadsheet, FileCode, Trash2, CheckCircle2, XCircle, ListPlus, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CheckSquare, Square } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { LEAD_STAGES, type Lead, type Profile } from '@/types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useDebounce } from '@/hooks/use-debounce';
import { isManagerOrAbove, isDepartmentScoped, getDepartmentLabel, canDeleteLead } from '@/lib/permissions';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import { useTeams } from '@/hooks/useTeams';
import StatusBadge from '@/components/StatusBadge';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import NameLink from '@/components/NameLink';

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportAsCSV, exportAsExcel, exportAsPDF, exportAsHTML } from '@/lib/exportUtils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import PeriodFilterBar from '@/components/PeriodFilterBar';

function stageLabel(status: string) {
  if (status === FOLLOWUP_SENTINEL) return 'Follow Up';
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
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

/** Local-midnight-to-local-midnight window for a "YYYY-MM-DD" day, expressed
 * as the UTC instants Postgres needs — same day-boundary convention Team
 * Activity's own day picker already uses. */
function localDayRangeUTC(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

type SortBy = 'newest' | 'oldest' | 'name' | 'followup' | 'grade';

function sortSpec(sortBy: SortBy): { column: string; ascending: boolean; nullsFirst?: boolean } {
  switch (sortBy) {
    case 'oldest': return { column: 'created_at', ascending: true };
    case 'name': return { column: 'name', ascending: true };
    // Nulls last, not first — "no follow-up scheduled" shouldn't outrank
    // "due soon", and no grade shouldn't outrank a graded lead.
    case 'followup': return { column: 'next_follow_up_at', ascending: true, nullsFirst: false };
    case 'grade': return { column: 'lead_grade', ascending: true, nullsFirst: false };
    case 'newest':
    default: return { column: 'created_at', ascending: false };
  }
}

interface LeadFilters {
  statusFilter: string;
  gradeFilter: string;
  projectFilters: string[];
  deptFilter: string;
  teamFilter: string;
  agentFilter: string;
  dateFilter: string;
  periodRange: { gte: string; lt: string } | null;
  search: string;
  teamMemberIds: string[];
  teamManagerId: string | null;
  profiles: Profile[];
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// A synthetic status value (not a real LeadStage) — one selectable option
// standing in for "any of the actively-being-worked stages," so the
// Dashboard's "Follow Up" tile can deep-link here with a single ?status=
// value instead of needing true multi-select on this filter.
const FOLLOWUP_SENTINEL = 'followup';
const FOLLOWUP_STAGE_VALUES = ['contacted', 'qualified', 'negotiation'];

/** Applies every active Leads-list filter directly to a Supabase query —
 * shared by the paginated list fetch, the "select/export everything
 * matching this filter" fetch, and the bulk-delete-by-filter path, so all
 * three always agree on exactly what "matches the current filter" means.
 * Works on both select() and delete() builders since both support
 * eq/in/or/gte/lt. */
function applyLeadFilters<Q extends { eq: any; in: any; or: any; gte: any; lt: any }>(query: Q, f: LeadFilters): Q {
  let q = query;

  if (f.statusFilter === FOLLOWUP_SENTINEL) q = q.in('status', FOLLOWUP_STAGE_VALUES);
  else if (f.statusFilter !== 'all') q = q.eq('status', f.statusFilter);
  if (f.gradeFilter !== 'all') q = q.eq('lead_grade', f.gradeFilter);
  if (f.projectFilters.length > 0) q = q.in('preferred_project', f.projectFilters);
  if (f.deptFilter !== 'all') q = q.eq('department_code', f.deptFilter);

  if (f.teamFilter !== 'all') {
    const memberIds = Array.from(new Set([...f.teamMemberIds, f.teamManagerId].filter(Boolean))) as string[];
    q = memberIds.length > 0
      ? q.or(`team_id.eq.${f.teamFilter},owner_id.in.(${memberIds.join(',')})`)
      : q.eq('team_id', f.teamFilter);
  }

  if (f.agentFilter !== 'all') {
    const ids = f.profiles.filter((p) => p.name === f.agentFilter).map((p) => p.id);
    q = ids.length > 0 ? q.in('owner_id', ids) : q.eq('owner_id', NIL_UUID);
  }

  if (f.dateFilter) {
    const { startISO, endISO } = localDayRangeUTC(f.dateFilter);
    q = q.gte('created_at', startISO).lt('created_at', endISO);
  }
  if (f.periodRange) q = q.gte('created_at', f.periodRange.gte).lt('created_at', f.periodRange.lt);

  const term = f.search.trim();
  if (term) {
    const esc = term.replace(/[%,()\\]/g, (c) => `\\${c}`);
    const ownerIds = f.profiles.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())).map((p) => p.id);
    const clauses = [`name.ilike.%${esc}%`, `phone.ilike.%${esc}%`];
    if (ownerIds.length > 0) clauses.push(`owner_id.in.(${ownerIds.join(',')})`);
    q = q.or(clauses.join(','));
  }

  return q;
}

/** Fetches every lead matching the current filter regardless of page —
 * needed for "Select All" (bulk delete) and Export, which both mean "every
 * matching lead," not just the visible page. PostgREST caps any single
 * request at 1000 rows, so this pages through in chunks internally; capped
 * at 20,000 total as a sane ceiling for a single bulk action. */
async function fetchAllMatchingLeads(f: LeadFilters, maxRows = 20_000): Promise<Lead[]> {
  const chunkSize = 1000;
  const all: Lead[] = [];
  let from = 0;
  while (all.length < maxRows) {
    let query = supabase.from('leads').select('*') as any;
    query = applyLeadFilters(query, f);
    const { data, error } = await query.order('created_at', { ascending: false }).range(from, from + chunkSize - 1);
    if (error) throw error;
    const rows = (data || []) as Lead[];
    all.push(...rows);
    if (rows.length < chunkSize) break;
    from += chunkSize;
  }
  return all.slice(0, maxRows);
}

function BulkDeleteUndoToast({ count }: { count: number }) {
  const [secondsLeft, setSecondsLeft] = useState(10);
  useEffect(() => {
    const interval = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
  }, []);
  const urgent = secondsLeft <= 5;

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 shrink-0 rounded-full text-sm font-bold tabular-nums transition-colors duration-300',
          urgent ? 'bg-destructive/15 text-destructive animate-pulse' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        )}
      >
        {secondsLeft}
      </div>
      <div className="min-w-0">
        <p className="font-medium leading-tight">{count} lead{count === 1 ? '' : 's'} deleted</p>
        <p className="text-xs leading-tight text-muted-foreground">Undo before this disappears</p>
      </div>
    </div>
  );
}

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

const TH_STYLE = 'px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap';

type ImportField = 'name' | 'phone' | 'email' | 'preferred_project' | 'budget_range';
const IMPORT_COLUMNS: { key: ImportField; label: string; aliases: string[] }[] = [
  { key: 'name', label: 'Name', aliases: ['name', 'customer', 'client'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'tel'] },
  { key: 'email', label: 'Email', aliases: ['email', 'mail'] },
  { key: 'preferred_project', label: 'Preferred Project', aliases: ['project', 'preferred'] },
  { key: 'budget_range', label: 'Budget', aliases: ['budget', 'price'] },
];

/** Exact header match wins over a loose substring match, so an exact
 * "Name" column is never shadowed by, say, an unrelated "Customer Name
 * Notes" column earlier in the sheet. */
function findImportColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h === alias);
    if (idx >= 0) return idx;
  }
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.includes(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

interface ImportPreview {
  columnMap: { key: ImportField; label: string; header: string | null }[];
  rows: Record<string, unknown>[];
  skippedCount: number;
}

export default function Leads() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  usePageHeader(t('leads.title'), t('leads.subtitle'));
  const { user, role, department, myTeamIds } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();
  const { teams, membersOf } = useTeams();
  const [pagedLeads, setPagedLeads] = useState<Lead[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionSheetLead, setActionSheetLead] = useState<Lead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const currentUser = user ? { id: user.id, role, department, managedTeamIds: myTeamIds } : null;
  const canDeleteRow = (lead: Lead) => canDeleteLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code, teamId: lead.team_id });
  const showDeptFilter = !isDepartmentScoped(role);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const leadsCardRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');
  const [gradeFilter, setGradeFilter] = useState(() => searchParams.get('grade') || 'all');
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [deptFilter, setDeptFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'followup' | 'grade'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { period, setPeriod, selectedMonth, selectedYear, isCurrentPeriod, shiftPeriod, periodLabel, periodRange } = usePeriodFilter();

  const isSuperAdmin = role === 'super_admin';
  // Individually-checked rows keep the full Lead object (not just its id) —
  // selection can span multiple pages, and once you've paged away a row's
  // data is no longer sitting in pagedLeads, so the object has to be kept
  // at the moment it's checked. selectAllMatchingActive is the separate
  // "every lead matching the current filter, not just what's checked"
  // toggle — resolved to actual rows on demand only when a bulk action is
  // confirmed, never held in memory otherwise.
  const [selectedLeads, setSelectedLeads] = useState<Map<string, Lead>>(new Map());
  const [selectAllMatchingActive, setSelectAllMatchingActive] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [pendingBulkDeletes, setPendingBulkDeletes] = useState<{ id: string; leads: Lead[] }[]>([]);
  const pendingDeleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const debouncedSearch = useDebounce(searchQuery, 300);
  const teamOptions = useMemo(
    () => teams.filter((t) => deptFilter === 'all' || t.department_code === deptFilter),
    [teams, deptFilter]
  );
  const teamMemberIds = useMemo(() => (teamFilter === 'all' ? [] : membersOf(teamFilter)), [teamFilter, membersOf]);
  const teamManagerId = useMemo(() => (teamFilter === 'all' ? null : teams.find((t) => t.id === teamFilter)?.manager_id ?? null), [teamFilter, teams]);

  const currentFilters: LeadFilters = {
    statusFilter, gradeFilter, projectFilters, deptFilter, teamFilter, agentFilter, dateFilter,
    periodRange: periodRange(), search: debouncedSearch, teamMemberIds, teamManagerId, profiles,
  };

  // Every staff member can be a filter option, whether or not they
  // currently own any leads — a small, always-accurate list sourced from
  // profiles rather than derived from whatever's on the current page.
  const uniqueAgents = useMemo(
    () => Array.from(new Set(profiles.map((p) => p.name))).sort(),
    [profiles]
  );

  // Project names are free-text, so there's no fixed table to read them
  // from. This is a bounded, one-time sample (not re-run per filter/page
  // change) — good enough for a filter dropdown without needing a
  // dedicated distinct-values query.
  const [uniqueProjects, setUniqueProjects] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    supabase.from('leads').select('preferred_project').not('preferred_project', 'is', null).limit(1000)
      .then(({ data }) => {
        const names = Array.from(new Set((data || []).map((r: any) => r.preferred_project as string).filter(Boolean)));
        setUniqueProjects(names.sort());
      });
  }, [user?.id]);

  const toggleProjectFilter = (project: string) => {
    setProjectFilters((prev) => (prev.includes(project) ? prev.filter((p) => p !== project) : [...prev, project]));
  };

  // The actual page fetch — filters/sort/pagination all pushed into the
  // query itself, with an exact total count returned alongside, instead of
  // loading the whole table into the browser (which also silently caps at
  // Supabase's 1000-row default and would just be wrong past that).
  const fetchLeadsRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let active = true;

    const fetchPage = async () => {
      setLoading(true);
      const { column, ascending, nullsFirst } = sortSpec(sortBy);
      let query = supabase.from('leads').select('*', { count: 'exact' }) as any;
      query = applyLeadFilters(query, currentFilters);
      query = query.order(column, { ascending, nullsFirst }).range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1);

      const { data, error, count } = await query;
      if (!active) return;
      if (error) {
        toast.error('Could not load leads.');
      } else {
        setPagedLeads((data || []) as Lead[]);
        setTotalCount(count ?? 0);
      }
      setLoading(false);
    };

    fetchLeadsRef.current = fetchPage;
    fetchPage();

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.id, page, pageSize, sortBy, statusFilter, gradeFilter, projectFilters, deptFilter,
    teamFilter, agentFilter, dateFilter, period, selectedMonth, selectedYear, debouncedSearch,
    teamMemberIds, teamManagerId, profiles,
  ]);

  // Realtime just invalidates — any change anywhere on the leads table
  // re-runs the exact same page fetch (debounced, so a burst of events
  // from a bulk import/delete triggers one refetch, not dozens). This
  // subscription only depends on the user, not on any filter/page state,
  // so filter changes never tear down and reopen the socket.
  useEffect(() => {
    if (!user) return;
    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedRefetch = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchLeadsRef.current(), 400);
    };
    const channel = supabase
      .channel('leads-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, debouncedRefetch)
      .subscribe();
    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const pendingDeleteIdSet = useMemo(
    () => new Set(pendingBulkDeletes.flatMap((b) => b.leads.map((l) => l.id))),
    [pendingBulkDeletes]
  );

  const visibleLeads = useMemo(
    () => pagedLeads
      .filter((l) => !pendingDeleteIdSet.has(l.id))
      .map((l) => ({ ...l, owner_name: nameOf(l.owner_id) })),
    [pagedLeads, pendingDeleteIdSet, nameOf]
  );

  const pendingDeleteCount = useMemo(
    () => pendingBulkDeletes.reduce((n, b) => n + b.leads.length, 0),
    [pendingBulkDeletes]
  );
  const visibleTotalCount = Math.max(0, totalCount - pendingDeleteCount);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    setPage(1);
    setSelectedLeads(new Map());
    setSelectAllMatchingActive(false);
  }, [debouncedSearch, statusFilter, gradeFilter, projectFilters, deptFilter, teamFilter, agentFilter, dateFilter, period, selectedMonth, selectedYear, sortBy, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const isFirstPageRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstPageRenderRef.current) { isFirstPageRenderRef.current = false; return; }
    leadsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  const openMap = (lead: Lead) => {
    setSelectedLead(lead);
    setMapOpen(true);
  };

  const handleDeleteLead = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('leads').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        action: 'lead_deleted',
        target_table: 'leads',
        target_id: deleteTarget.id,
        performed_by: user?.id,
        old_value: { name: deleteTarget.name, phone: deleteTarget.phone, owner_id: deleteTarget.owner_id },
      });
      toast.success(`Lead "${deleteTarget.name}" deleted.`);
    } catch {
      toast.error('Could not delete the lead.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const toggleSelectLead = (lead: Lead) => {
    if (selectAllMatchingActive) return;
    setSelectedLeads((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id); else next.set(lead.id, lead);
      return next;
    });
  };

  // Deliberately all-or-nothing: "Select All" always means every lead
  // matching the current filter, not just this page — mixing that with
  // per-row deselection (Gmail's "select all, then uncheck one" pattern)
  // would need to track exclusions across pages too, real complexity for a
  // rare, password-gated admin action. Individual checkboxes are disabled
  // while this is active for exactly that reason.
  const toggleSelectAll = () => {
    if (selectAllMatchingActive) {
      setSelectAllMatchingActive(false);
    } else {
      setSelectAllMatchingActive(true);
      setSelectedLeads(new Map());
    }
  };

  const bulkSelectionCount = selectAllMatchingActive ? visibleTotalCount : selectedLeads.size;

  // Chunked so a very large "select all matching" delete never sends a
  // single request with thousands of ids — DELETE ... WHERE id IN (...)
  // encodes the id list into the URL, which has practical length limits
  // long before a few thousand UUIDs would fit.
  const DELETE_CHUNK_SIZE = 500;

  const commitBulkDelete = async (batchId: string, targets: Lead[]) => {
    pendingDeleteTimersRef.current.delete(batchId);
    try {
      const ids = targets.map((l) => l.id);
      for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE);
        const { error } = await supabase.from('leads').delete().in('id', chunk);
        if (error) throw error;
      }

      for (let i = 0; i < targets.length; i += DELETE_CHUNK_SIZE) {
        const chunk = targets.slice(i, i + DELETE_CHUNK_SIZE);
        await supabase.from('audit_logs').insert(
          chunk.map((l) => ({
            action: 'lead_deleted',
            target_table: 'leads',
            target_id: l.id,
            performed_by: user?.id,
            old_value: { name: l.name, phone: l.phone, owner_id: l.owner_id },
          }))
        );
      }
    } catch {
      toast.error('Could not delete the selected leads.');
    } finally {
      setPendingBulkDeletes((prev) => prev.filter((b) => b.id !== batchId));
    }
  };

  const undoBulkDelete = (batchId: string, count: number) => {
    const timer = pendingDeleteTimersRef.current.get(batchId);
    if (timer) {
      clearTimeout(timer);
      pendingDeleteTimersRef.current.delete(batchId);
    }
    setPendingBulkDeletes((prev) => prev.filter((b) => b.id !== batchId));
    toast.success(`Restored ${count} lead${count === 1 ? '' : 's'}.`, { position: 'top-right' });
  };

  const handleBulkDelete = async () => {
    if (!user?.email || !bulkDeletePassword) return;
    setBulkDeleting(true);
    try {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: bulkDeletePassword });
      if (verifyErr) { toast.error('Password is incorrect.'); return; }

      const targets = selectAllMatchingActive
        ? await fetchAllMatchingLeads(currentFilters)
        : Array.from(selectedLeads.values());
      if (targets.length === 0) { toast.error('No leads to delete.'); return; }
      const batchId = crypto.randomUUID();

      setPendingBulkDeletes((prev) => [...prev, { id: batchId, leads: targets }]);
      setSelectedLeads(new Map());
      setSelectAllMatchingActive(false);
      setBulkDeleteOpen(false);
      setBulkDeletePassword('');

      const timer = setTimeout(() => commitBulkDelete(batchId, targets), 10_000);
      pendingDeleteTimersRef.current.set(batchId, timer);

      toast(<BulkDeleteUndoToast count={targets.length} />, {
        position: 'top-right',
        duration: 10_000,
        closeButton: true,
        action: { label: 'Undo', onClick: () => undoBulkDelete(batchId, targets.length) },
      });
    } catch {
      toast.error('Could not delete the selected leads.');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Export always means "every lead matching the current filter," same as
  // it did when the whole table lived in the browser — so it fetches on
  // demand rather than being limited to whatever's on the visible page.
  const handleExport = async (exportFn: (leads: Lead[]) => void) => {
    setExporting(true);
    try {
      const rows = await fetchAllMatchingLeads(currentFilters);
      if (rows.length === 0) { toast.error('No leads to export.'); return; }
      exportFn(rows.map((l) => ({ ...l, owner_name: nameOf(l.owner_id) })));
    } catch {
      toast.error('Could not export leads.');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    setImporting(true);
    try {
      const XLSX = await import('xlsx'); // heavy — loaded only when importing
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) {
        toast.error('No data found in the spreadsheet.');
        return;
      }

      const rawHeaders: string[] = rows[0].map((h: any) => String(h).trim());
      const headers = rawHeaders.map((h) => h.toLowerCase());
      const colIndex = Object.fromEntries(
        IMPORT_COLUMNS.map((col) => [col.key, findImportColumn(headers, col.aliases)])
      ) as Record<ImportField, number>;

      if (colIndex.name < 0 && colIndex.phone < 0) {
        toast.error('Could not find a Name or Phone column in this file — nothing was imported. Recognized columns: Name, Phone, Email, Preferred Project, Budget.');
        return;
      }

      const cell = (row: any[], idx: number) => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
      const rowsToInsert: Record<string, unknown>[] = [];
      let skippedCount = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nameVal = cell(row, colIndex.name);
        const phoneVal = cell(row, colIndex.phone);
        if (!nameVal && !phoneVal) { skippedCount += 1; continue; }

        rowsToInsert.push({
          name: nameVal || 'Unknown',
          phone: phoneVal || '',
          email: cell(row, colIndex.email) || null,
          preferred_project: cell(row, colIndex.preferred_project) || null,
          budget_range: cell(row, colIndex.budget_range) || null,
          status: 'new',
          department_code: department || 'house',
          owner_id: user.id,
          created_by: user.id,
        });
      }

      if (rowsToInsert.length === 0) {
        toast.error('No valid rows found to import — every row was missing both Name and Phone.');
        return;
      }

      setImportPreview({
        columnMap: IMPORT_COLUMNS.map((col) => ({ key: col.key, label: col.label, header: colIndex[col.key] >= 0 ? rawHeaders[colIndex[col.key]] : null })),
        rows: rowsToInsert,
        skippedCount,
      });
    } catch {
      toast.error('Could not read this file — please check it\'s a valid Excel/CSV export.');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const { error } = await supabase.from('leads').insert(importPreview.rows);
      if (error) throw error;
      toast.success(`${importPreview.rows.length} lead${importPreview.rows.length === 1 ? '' : 's'} imported.`);
      setImportPreview(null);
    } catch {
      toast.error('Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between md:justify-end">
        <div className="md:hidden">
          <h1 className="text-xl font-semibold md:text-2xl text-foreground">{t('leads.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('leads.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" />
          {isSuperAdmin && visibleTotalCount > 0 && (
            <>
              <Button
                variant="outline"
                onClick={toggleSelectAll}
                className="h-11 md:h-12 gap-2 active:scale-[0.98] transition-transform"
              >
                {selectAllMatchingActive ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                <span className="hidden sm:inline">{selectAllMatchingActive ? 'Deselect All' : 'Select All'}</span>
              </Button>
              {bulkSelectionCount > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => setBulkDeleteOpen(true)}
                  className="h-11 md:h-12 gap-2 active:scale-[0.98] transition-transform"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected ({bulkSelectionCount})
                </Button>
              )}
            </>
          )}
          {isManagerOrAbove(role) && (
            <Button variant="outline" disabled={importing} onClick={() => importFileRef.current?.click()} className="h-11 md:h-12 gap-2 active:scale-[0.98] transition-transform">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span className="hidden sm:inline">{importing ? 'Importing…' : 'Import'}</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={visibleTotalCount === 0 || exporting}
                className="h-11 md:h-12 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover shrink-0 gap-2 active:scale-[0.98]"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {agentFilter !== 'all' && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
                  {agentFilter} · {visibleTotalCount} lead{visibleTotalCount > 1 ? 's' : ''}
                </div>
              )}
              <DropdownMenuItem onClick={() => handleExport(exportAsExcel)} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="w-4 h-4 text-success" /> Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport(exportAsPDF)} className="gap-2 cursor-pointer">
                <FileText className="w-4 h-4 text-destructive" /> PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport(exportAsHTML)} className="gap-2 cursor-pointer">
                <FileCode className="w-4 h-4 text-info" /> HTML
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport(exportAsCSV)} className="gap-2 cursor-pointer">
                <FileText className="w-4 h-4 text-primary" /> CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Period + Search & Filters */}
      <Card className="border-0 shadow-card rounded-xl overflow-hidden">
        <CardContent className="p-4 md:p-5 space-y-4">
          <div className="pb-4 border-b border-border/60">
            <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute w-4 h-4 -translate-y-1/2 left-3 top-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, phone, or sales person…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-11 pl-9 rounded-lg bg-muted/40 border-transparent focus-visible:bg-card focus-visible:border-input transition-colors"
                />
              </div>
              {/* One-tap self filter — a manager sees their whole team's
                  leads via team-scoped RLS, so this is the fast way back to
                  just the ones they personally own, without opening the
                  filter panel and hunting for their own name in the agent
                  list. Reuses the existing agentFilter/owner_name filtering
                  rather than adding a parallel filter path. */}
              {role === 'manager' && user?.name && (
                <button
                  type="button"
                  onClick={() => setAgentFilter((prev) => (prev === user.name ? 'all' : user.name))}
                  aria-pressed={agentFilter === user.name}
                  className={`flex items-center gap-1.5 px-3.5 h-11 rounded-lg border text-sm font-medium transition-colors shrink-0 ${
                    agentFilter === user.name
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  <UserIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">My Leads</span>
                </button>
              )}

              {/* Desktop/tablet: compact always-visible Sort + Date, plus a
                  single Filters popover for the remaining category filters —
                  replaces what used to be six separate dropdowns wrapping
                  across the row. */}
              <div className="hidden md:flex items-center gap-2 shrink-0">
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                  <SelectTrigger className="w-[150px] h-11 rounded-lg bg-muted/40 border-transparent">
                    <ArrowUpDown className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="name">Name (A–Z)</SelectItem>
                    <SelectItem value="followup">Next follow-up</SelectItem>
                    <SelectItem value="grade">Grade (A–C)</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-1 shrink-0">
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 min-h-0 shrink-0" aria-label="Previous day"
                    onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), -1))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Input type="date" value={dateFilter} max={todayStr()} onChange={(e) => setDateFilter(e.target.value)} className="h-9 w-[130px] text-sm border-0 bg-transparent shadow-none focus-visible:ring-0" />
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 min-h-0 shrink-0" aria-label="Next day"
                    disabled={(dateFilter || todayStr()) >= todayStr()}
                    onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                {dateFilter && (
                  <Button variant="ghost" className="h-9 px-2.5 text-xs font-medium text-primary" onClick={() => setDateFilter('')}>
                    All dates
                  </Button>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-3.5 h-11 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      Filters
                      {(statusFilter !== 'all' || gradeFilter !== 'all' || projectFilters.length > 0 || deptFilter !== 'all' || teamFilter !== 'all' || agentFilter !== 'all') && (
                        <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                          {[statusFilter, gradeFilter, deptFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length + (projectFilters.length > 0 ? 1 : 0)}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[380px] p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    <FilterFields
                      statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                      gradeFilter={gradeFilter} setGradeFilter={setGradeFilter}
                      projectFilters={projectFilters} setProjectFilters={setProjectFilters} toggleProjectFilter={toggleProjectFilter}
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      dateFilter={dateFilter} setDateFilter={setDateFilter}
                      sortBy={sortBy} setSortBy={setSortBy}
                      uniqueAgents={uniqueAgents} uniqueProjects={uniqueProjects} departments={departments} teamOptions={teamOptions}
                      showDept={showDeptFilter} showSortDate={false}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Mobile: single Filters sheet with everything, including Sort/Date */}
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="md:hidden flex items-center gap-1.5 px-3.5 h-11 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span className="hidden sm:inline">Filters</span>
                    {(statusFilter !== 'all' || gradeFilter !== 'all' || projectFilters.length > 0 || deptFilter !== 'all' || teamFilter !== 'all' || agentFilter !== 'all' || dateFilter) && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[statusFilter, gradeFilter, deptFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length + (projectFilters.length > 0 ? 1 : 0) + (dateFilter ? 1 : 0)}
                      </span>
                    )}
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-6 pb-8 max-h-[85dvh] overflow-y-auto">
                  <SheetHeader className="pb-4">
                    <SheetTitle className="flex items-center gap-2 text-base font-semibold">
                      <Filter className="w-4 h-4 text-primary" /> Search / Filter
                    </SheetTitle>
                  </SheetHeader>
                  <div className="space-y-5">
                    <FilterFields
                      statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                      gradeFilter={gradeFilter} setGradeFilter={setGradeFilter}
                      projectFilters={projectFilters} setProjectFilters={setProjectFilters} toggleProjectFilter={toggleProjectFilter}
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      dateFilter={dateFilter} setDateFilter={setDateFilter}
                      sortBy={sortBy} setSortBy={setSortBy}
                      uniqueAgents={uniqueAgents} uniqueProjects={uniqueProjects} departments={departments} teamOptions={teamOptions}
                      showDept={showDeptFilter}
                    />
                    <SheetClose asChild>
                      <button type="button" className="w-full h-12 text-sm font-medium transition-colors rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80">
                        Done
                      </button>
                    </SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Active filter chips — quick visibility + one-tap removal
                without opening the panel. Date is excluded on desktop since
                it already has its own always-visible control above. */}
            <div className="flex flex-wrap gap-2">
              {[
                ['status', statusFilter, setStatusFilter, statusFilter !== 'all' ? stageLabel(statusFilter) : ''],
                ['grade', gradeFilter, setGradeFilter, gradeFilter !== 'all' ? `Grade ${gradeFilter}` : ''],
                ['dept', deptFilter, setDeptFilter, deptFilter !== 'all' ? getDepartmentLabel(deptFilter) : ''],
                ['team', teamFilter, setTeamFilter, teamFilter !== 'all' ? (teamOptions.find((tm) => tm.id === teamFilter)?.name || '') : ''],
                ['agent', agentFilter, setAgentFilter, agentFilter],
              ].map(([key, value, setter, label]) =>
                value !== 'all' ? (
                  <button
                    key={key as string}
                    type="button"
                    onClick={() => (setter as (v: string) => void)('all')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:bg-primary/20 transition-colors"
                  >
                    {label as string}
                    <X className="w-3 h-3" />
                  </button>
                ) : null
              )}
              {projectFilters.map((p) => (
                <button
                  key={`project-${p}`}
                  type="button"
                  onClick={() => toggleProjectFilter(p)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:bg-primary/20 transition-colors"
                >
                  {p}
                  <X className="w-3 h-3" />
                </button>
              ))}
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter('')}
                  className="md:hidden inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:bg-primary/20 transition-colors"
                >
                  {dateFilter}
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: Card List | Desktop: Table */}
      <Card ref={leadsCardRef} className="overflow-hidden border-0 shadow-card rounded-xl">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
            <FileText className="w-4 h-4 text-muted-foreground/80" />
            All Leads
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1 tabular-nums">{visibleTotalCount}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto bg-card">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-52 gap-2.5 text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
              </div>
            ) : visibleTotalCount === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5">
                <FileText className="mb-2 w-9 h-9 opacity-40" />
                <p className="text-sm font-medium">No leads found</p>
                <p className="mt-1 text-xs">Try adjusting your search or filters</p>
              </div>
            ) : (
              <>
                {/* Desktop/tablet table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/30">
                        {isSuperAdmin && (
                          <TableHead className={`${TH_STYLE} pl-5 w-10`}>
                            <Checkbox checked={selectAllMatchingActive} onCheckedChange={toggleSelectAll} aria-label="Select all leads" />
                          </TableHead>
                        )}
                        <TableHead className={`${TH_STYLE} ${isSuperAdmin ? 'pl-3' : 'pl-5'}`}>Customer</TableHead>
                        <TableHead className={TH_STYLE}>Project / Budget</TableHead>
                        <TableHead className={TH_STYLE}>Grade</TableHead>
                        <TableHead className={TH_STYLE}>Status</TableHead>
                        <TableHead className={TH_STYLE}>Sales Person</TableHead>
                        <TableHead className={TH_STYLE}>Next Follow-up</TableHead>
                        <TableHead className={`${TH_STYLE} pr-5 text-right`}>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleLeads.map((lead) => (
                        <TableRow key={lead.id} className="cursor-pointer table-row-interactive table-row-zebra border-border/40" onClick={() => navigate(`/lead/${lead.id}`)}>
                          {isSuperAdmin && (
                            <TableCell className="pl-5 pr-0 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectAllMatchingActive || selectedLeads.has(lead.id)}
                                disabled={selectAllMatchingActive}
                                onCheckedChange={() => toggleSelectLead(lead)}
                                aria-label={`Select ${lead.name}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className={`${isSuperAdmin ? 'pl-3' : 'pl-5'} pr-4 py-2.5`}>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center text-xs font-semibold rounded-full w-9 h-9 bg-primary/10 text-primary shrink-0">
                                {initialsOf(lead.name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate max-w-[180px]">{lead.name}</p>
                                <p className="text-xs text-muted-foreground tabular-nums">{lead.phone || 'No phone'}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-2.5">
                            <p className="text-sm text-foreground truncate max-w-[170px]">{lead.preferred_project || '—'}</p>
                            {lead.budget_range && <p className="text-xs text-muted-foreground truncate max-w-[170px] tabular-nums">{lead.budget_range}</p>}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap"><LeadLevelBadge grade={lead.lead_grade} /></TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={stageLabel(lead.status)} color={statusColors?.[lead.status] || '#8FA3BF'} /></TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap text-sm text-muted-foreground">
                            {lead.owner_id ? <NameLink id={lead.owner_id} name={lead.owner_name || '—'} showAvatar={false} /> : '—'}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                            {lead.next_follow_up_at ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 opacity-60" />
                                {new Date(lead.next_follow_up_at).toLocaleDateString()}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="pl-4 pr-5 py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-0.5">
                              {lead.latitude && lead.longitude && (
                                <Button variant="ghost" size="icon" title="View map" aria-label="View map" className="w-8 h-8 min-h-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => openMap(lead)}>
                                  <MapPin className="w-4 h-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" title="View details" aria-label="View details" className="w-8 h-8 min-h-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => navigate(`/lead/${lead.id}`)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              {canDeleteRow(lead) && (
                                <Button variant="ghost" size="icon" title="Delete lead" aria-label="Delete lead" className="w-8 h-8 min-h-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(lead)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card list */}
                <div className="divide-y md:hidden divide-border">
                  {visibleLeads.map((lead) => (
                    <div key={lead.id} className="flex items-start gap-3 p-4 min-h-[72px] transition-colors hover:bg-muted/30 active:bg-muted/50">
                      {isSuperAdmin && (
                        <div className="pt-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectAllMatchingActive || selectedLeads.has(lead.id)}
                            disabled={selectAllMatchingActive}
                            onCheckedChange={() => toggleSelectLead(lead)}
                            aria-label={`Select ${lead.name}`}
                          />
                        </div>
                      )}
                      {/* A plain div (not <button>) — it needs to contain the
                          NameLink's <a> and the "View map" <button> below,
                          and interactive elements can't nest inside a
                          <button> per HTML semantics. */}
                      <div role="button" tabIndex={0} onClick={() => navigate(`/lead/${lead.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/lead/${lead.id}`); }} className="flex-1 min-w-0 space-y-2 text-left cursor-pointer">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate text-foreground">{lead.name}</span>
                          <StatusBadge status={stageLabel(lead.status)} color={statusColors?.[lead.status] || '#8FA3BF'} />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone || '—'}</span>
                          {lead.preferred_project && (<span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.preferred_project}</span>)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <LeadLevelBadge grade={lead.lead_grade} />
                          {lead.owner_id ? (
                            <NameLink id={lead.owner_id} name={lead.owner_name || '—'} size="sm" showAvatar={false} className="text-xs text-muted-foreground" />
                          ) : lead.owner_name && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><UserIcon className="w-3 h-3" />{lead.owner_name}</span>
                          )}
                        </div>
                        {lead.next_follow_up_at && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" /> Next follow-up: {new Date(lead.next_follow_up_at).toLocaleDateString()}
                          </div>
                        )}
                        {lead.latitude && lead.longitude && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); openMap(lead); }} className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-primary">
                            <MapPin className="w-3 h-3" /> View map
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActionSheetLead(lead); }}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:bg-muted/50 transition-colors shrink-0 mt-0.5"
                        aria-label="Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Pager — always shown once there's a result to page through, on
              both mobile and desktop; stacks to two rows on narrow screens
              instead of squeezing everything onto one. */}
          {!loading && visibleTotalCount > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-t border-border/60 bg-muted/5">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing <span className="font-medium text-foreground tabular-nums">{(page - 1) * pageSize + 1}</span>
                  –<span className="font-medium text-foreground tabular-nums">{Math.min(page * pageSize, visibleTotalCount)}</span>
                  {' '}of <span className="font-medium text-foreground tabular-nums">{visibleTotalCount}</span>
                </span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (<SelectItem key={n} value={String(n)}>{n} / page</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page">
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-xs font-medium text-foreground tabular-nums whitespace-nowrap">Page {page} of {totalPages}</span>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import preview — confirms the column mapping before anything is
          written, so an oddly-named or reordered spreadsheet column never
          silently lands in the wrong field. */}
      <Dialog open={!!importPreview} onOpenChange={(open) => !open && !importing && setImportPreview(null)}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0">
          <DialogHeader className="pb-4 border-b border-border/60">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold"><ListPlus className="w-5 h-5 text-primary" /> Import Preview</DialogTitle>
          </DialogHeader>
          <div className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              Only these columns are ever read from your file — anything else in the spreadsheet is ignored.
            </p>
            <div className="space-y-1.5">
              {importPreview?.columnMap.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3 px-3 py-2 border rounded-lg border-border bg-muted/20">
                  <span className="text-sm font-medium text-foreground">{col.label}</span>
                  {col.header ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> "{col.header}"</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><XCircle className="w-3.5 h-3.5 shrink-0" /> Not found — skipped</span>
                  )}
                </div>
              ))}
            </div>
            <div className="text-sm bg-primary/5 border border-primary/20 rounded-lg px-3.5 py-2.5">
              <span className="font-semibold text-foreground">{importPreview?.rows.length}</span> lead{importPreview?.rows.length === 1 ? '' : 's'} ready to import
              {!!importPreview?.skippedCount && (
                <span className="text-muted-foreground"> · {importPreview.skippedCount} row{importPreview.skippedCount === 1 ? '' : 's'} skipped (no name or phone)</span>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1 h-11" disabled={importing} onClick={() => setImportPreview(null)}>Cancel</Button>
              <Button type="button" className="flex-1 font-medium text-white h-11 gradient-primary" disabled={importing} onClick={confirmImport}>
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : `Import ${importPreview?.rows.length ?? ''} Lead${importPreview?.rows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Map Modal */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-base font-semibold">Lead location — {selectedLead?.name}</DialogTitle>
          </DialogHeader>
          {selectedLead?.latitude && selectedLead?.longitude && (
            <div className="px-6 pb-6">
              <p className="mb-3 text-sm text-muted-foreground">
                Lat: {Number(selectedLead.latitude).toFixed(5)}, Lng: {Number(selectedLead.longitude).toFixed(5)}
              </p>
              <div className="w-full overflow-hidden border rounded-lg aspect-video border-border">
                <iframe
                  title="Lead Location" width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${selectedLead.latitude},${selectedLead.longitude}&z=15&output=embed`}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mobile action sheet */}
      <Sheet open={!!actionSheetLead} onOpenChange={(open) => !open && setActionSheetLead(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-0 pt-0 pb-8 max-h-[60dvh]">
          {actionSheetLead && (
            <div className="space-y-1">
              <div className="px-6 pt-5 pb-3 border-b border-border">
                <p className="text-base font-semibold truncate text-foreground">{actionSheetLead.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{actionSheetLead.phone || 'No phone number'}</p>
              </div>
              <div className="px-2 py-2 space-y-1">
                <button
                  type="button"
                  onClick={() => { setActionSheetLead(null); navigate(`/lead/${actionSheetLead.id}`); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0"><Eye className="w-4 h-4 text-primary" /></div>
                  View details
                </button>
                {actionSheetLead.phone && (
                  <a href={`tel:${actionSheetLead.phone}`} onClick={() => setActionSheetLead(null)} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-success/10 shrink-0"><PhoneCall className="w-4 h-4 text-success" /></div>
                    Call
                  </a>
                )}
                {actionSheetLead.latitude && actionSheetLead.longitude && (
                  <button type="button" onClick={() => { openMap(actionSheetLead); setActionSheetLead(null); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-info/10 shrink-0"><Navigation className="w-4 h-4 text-info" /></div>
                    View location
                  </button>
                )}
                {canDeleteRow(actionSheetLead) && (
                  <button type="button" onClick={() => { setDeleteTarget(actionSheetLead); setActionSheetLead(null); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/5 active:bg-destructive/10 transition-colors">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-destructive/10 shrink-0"><Trash2 className="w-4 h-4 text-destructive" /></div>
                    Delete lead
                  </button>
                )}
                <button type="button" onClick={() => setActionSheetLead(null)} className="w-full flex items-center justify-center px-4 py-3.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/50 active:bg-muted transition-colors border border-border">
                  Close
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation (exec only) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" and all of its follow-ups, warnings and history will be
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

      {/* Bulk delete confirmation (Super Admin only) — requires re-entering
          your own password as the confirmation step, since this can remove
          far more leads at once than the single-lead delete above. */}
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!bulkDeleting) { setBulkDeleteOpen(open); if (!open) setBulkDeletePassword(''); } }}
      >
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bulkSelectionCount} selected lead{bulkSelectionCount === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every currently-selected lead — matching only what your active
              search and filters show — along with all of their follow-ups, warnings and history.
              You'll have 10 seconds to undo from a notice at the top right before it's final.
              Enter your password to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-1">
            <Input
              type="password"
              placeholder="Your password"
              value={bulkDeletePassword}
              onChange={(e) => setBulkDeletePassword(e.target.value)}
              disabled={bulkDeleting}
              className="h-11"
              autoComplete="current-password"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleting || !bulkDeletePassword}
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {bulkDeleting ? 'Deleting…' : `Delete ${bulkSelectionCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterFields({ statusFilter, setStatusFilter, gradeFilter, setGradeFilter, projectFilters, toggleProjectFilter, setProjectFilters, deptFilter, setDeptFilter, teamFilter, setTeamFilter, agentFilter, setAgentFilter, dateFilter, setDateFilter, sortBy, setSortBy, uniqueAgents, uniqueProjects, departments, teamOptions, showDept = true, showSortDate = true }: any) {
  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Status</label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full h-12"><SelectValue placeholder="Select status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value={FOLLOWUP_SENTINEL}>Follow Up (Contacted, Qualified, Negotiation)</SelectItem>
            {LEAD_STAGES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Grade</label>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-full h-12"><SelectValue placeholder="Select grade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grades</SelectItem>
            <SelectItem value="A">Grade A</SelectItem>
            <SelectItem value="B">Grade B</SelectItem>
            <SelectItem value="C">Grade C</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Project</label>
        <div className="max-h-48 overflow-y-auto rounded-md border border-input divide-y divide-border">
          {uniqueProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">No projects yet</p>
          ) : (
            uniqueProjects.map((p: string) => (
              <label key={p} className="flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer">
                <Checkbox checked={projectFilters.includes(p)} onCheckedChange={() => toggleProjectFilter(p)} />
                <span className="truncate">{p}</span>
              </label>
            ))
          )}
        </div>
        {projectFilters.length > 0 && (
          <button type="button" onClick={() => setProjectFilters([])} className="text-xs font-medium text-primary">
            Clear projects
          </button>
        )}
      </div>
      {showDept && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Department</label>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder="Select department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d: { code: string; name: string }) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
      {teamOptions.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Team</label>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder="Select team" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teamOptions.map((tm: { id: string; name: string }) => (<SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Sales Person</label>
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-full h-12"><SelectValue placeholder="Select sales person" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sales people</SelectItem>
            {uniqueAgents.map((a: string) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      {showSortDate && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Sort By</label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full h-12"><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="name">Name (A–Z)</SelectItem>
                <SelectItem value="followup">Next follow-up</SelectItem>
                <SelectItem value="grade">Grade (A–C)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Date Added</label>
            <div className="flex items-center gap-1.5">
              <Button
                type="button" variant="outline" size="icon" className="h-12 w-12 min-h-0 shrink-0" aria-label="Previous day"
                onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), -1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Input type="date" value={dateFilter} max={todayStr()} onChange={(e) => setDateFilter(e.target.value)} className="w-full h-12 text-sm" />
              <Button
                type="button" variant="outline" size="icon" className="h-12 w-12 min-h-0 shrink-0" aria-label="Next day"
                disabled={(dateFilter || todayStr()) >= todayStr()}
                onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {dateFilter && (
              <button type="button" onClick={() => setDateFilter('')} className="text-xs font-medium text-primary">
                Clear — show all dates
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
