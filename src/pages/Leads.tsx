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
import { MapPin, FileText, Search, Filter, Eye, Phone, Calendar, User as UserIcon, X, SlidersHorizontal, MoreVertical, PhoneCall, Navigation, Upload, Loader2, Download, FileSpreadsheet, FileCode, Trash2, CheckCircle2, XCircle, ListPlus, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CheckSquare, Square } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { LEAD_STAGES, type Lead } from '@/types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
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

function stageLabel(status: string) {
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
}

// Lives inside the undo toast itself (sonner keeps this element mounted for
// the toast's whole lifetime), ticking its own countdown independent of
// Leads' re-renders. Turns urgent — red + pulsing — for the last 5s.
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
        <p className="text-xs text-muted-foreground leading-tight">Undo before this disappears</p>
      </div>
    </div>
  );
}

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

const TH_STYLE = 'px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap';

/** The complete, explicit set of spreadsheet columns the bulk-import flow
 * ever reads — every other column in an uploaded file (extra notes,
 * internal ids, whatever else a sales team's export happens to carry) is
 * ignored by construction: the insert payload below is built field-by-field
 * from this list, never by spreading a row, so there's no path for an
 * unrecognized column to end up in the database. Recognize a new column by
 * adding one entry here, not by touching the import logic itself. */
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
  const { t } = useTranslation();
  usePageHeader(t('leads.title'), t('leads.subtitle'));
  const { user, role, department, myTeamIds } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();
  const { teams, membersOf } = useTeams();
  const [rawLeads, setRawLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionSheetLead, setActionSheetLead] = useState<Lead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const currentUser = user ? { id: user.id, role, department, managedTeamIds: myTeamIds } : null;
  // Exec can delete any lead; Manager/Sale only a lead they currently own —
  // matches the leads_delete RLS policy. Checked per-row below, not as a
  // single flag, since ownership varies lead by lead.
  const canDeleteRow = (lead: Lead) => canDeleteLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code, teamId: lead.team_id });
  // Admin/Manager/Sale only ever see their own department (RLS), so the
  // department filter is meaningless noise for them.
  const showDeptFilter = !isDepartmentScoped(role);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const leadsCardRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'followup' | 'grade'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Bulk select/delete — Super Admin only, deliberately narrower than
  // isExec()/canDeleteLead() (which would also allow Boss): this is a much
  // more powerful, harder-to-undo action than the existing per-row delete,
  // so it's scoped to exactly the one tier that was asked for.
  const isSuperAdmin = role === 'super_admin';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // A confirmed bulk delete doesn't hit the DB right away — it's held for a
  // 10s undo window (toast at top-right) and hidden from the list
  // optimistically in the meantime. Tracked as a list of batches (not one
  // flat id set) so starting a second bulk delete while an earlier one is
  // still undoable doesn't clobber it.
  const [pendingBulkDeletes, setPendingBulkDeletes] = useState<{ id: string; leads: Lead[] }[]>([]);
  const pendingDeleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
      if (!active) return;
      if (error) {
        toast.error('Could not load leads.');
      } else {
        setRawLeads((data || []) as Lead[]);
      }
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel('leads-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Ids currently in the 10s undo window — hidden from the list as soon as
  // a bulk delete is confirmed, before the actual DB delete ever runs.
  const pendingDeleteIdSet = useMemo(
    () => new Set(pendingBulkDeletes.flatMap((b) => b.leads.map((l) => l.id))),
    [pendingBulkDeletes]
  );

  const leads: Lead[] = useMemo(
    () => rawLeads
      .filter((l) => !pendingDeleteIdSet.has(l.id))
      .map((l) => ({ ...l, owner_name: nameOf(l.owner_id) })),
    [rawLeads, nameOf, pendingDeleteIdSet]
  );

  const uniqueAgents = useMemo(
    () => Array.from(new Set(leads.map((l) => l.owner_name).filter(Boolean))).sort() as string[],
    [leads]
  );

  // Narrow the team picker to the selected department (if any) so it never
  // offers teams that couldn't possibly match.
  const teamOptions = useMemo(
    () => teams.filter((t) => deptFilter === 'all' || t.department_code === deptFilter),
    [teams, deptFilter]
  );

  // A lead matches a team filter if it was explicitly filed under that team
  // OR its current owner is a member of that team (or is the team's
  // manager, for leads a manager assigned to themselves) — this second path
  // is what makes the filter work for a person's leads created before they
  // were put on a team, or before team_id was tagged at all, since the
  // membership lookup always reflects current team assignment rather than a
  // possibly-stale/absent field on the lead itself.
  const teamMemberIds = useMemo(() => (teamFilter === 'all' ? [] : membersOf(teamFilter)), [teamFilter, membersOf]);
  const teamManagerId = useMemo(() => (teamFilter === 'all' ? null : teams.find((t) => t.id === teamFilter)?.manager_id ?? null), [teamFilter, teams]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const name = lead.name?.toLowerCase() || '';
      const agent = (lead.owner_name || '').toLowerCase();
      const q = searchQuery.toLowerCase();

      const matchesSearch = !searchQuery || name.includes(q) || lead.phone?.includes(searchQuery) || agent.includes(q);
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      const matchesProject = projectFilter === 'all' || lead.preferred_project === projectFilter;
      const matchesDept = deptFilter === 'all' || lead.department_code === deptFilter;
      const matchesTeam = teamFilter === 'all'
        || lead.team_id === teamFilter
        || (!!lead.owner_id && teamMemberIds.includes(lead.owner_id))
        || (!!lead.owner_id && lead.owner_id === teamManagerId);
      const matchesAgent = agentFilter === 'all' || lead.owner_name === agentFilter;

      return matchesSearch && matchesStatus && matchesProject && matchesDept && matchesTeam && matchesAgent;
    });
  }, [leads, searchQuery, statusFilter, projectFilter, deptFilter, teamFilter, teamMemberIds, teamManagerId, agentFilter]);

  const sortedLeads = useMemo(() => {
    const arr = [...filteredLeads];
    switch (sortBy) {
      case 'oldest':
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'name':
        arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'followup':
        // Leads with no scheduled follow-up sort to the end, not the top —
        // "nothing due" shouldn't outrank "due soon".
        arr.sort((a, b) => {
          if (!a.next_follow_up_at && !b.next_follow_up_at) return 0;
          if (!a.next_follow_up_at) return 1;
          if (!b.next_follow_up_at) return -1;
          return a.next_follow_up_at.localeCompare(b.next_follow_up_at);
        });
        break;
      case 'grade': {
        const rank: Record<string, number> = { A: 0, B: 1, C: 2 };
        arr.sort((a, b) => (rank[a.lead_grade || ''] ?? 3) - (rank[b.lead_grade || ''] ?? 3));
        break;
      }
      case 'newest':
      default:
        arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return arr;
  }, [filteredLeads, sortBy]);

  // A fresh filter/sort/page-size choice always starts back at page 1 — a
  // stale page number from before would otherwise show a confusingly
  // unrelated (or blank) slice of the new result set. Bulk selection is
  // cleared for the same reason: it's scoped to "leads matching the current
  // filter" (see the bulk-delete rule below), so carrying a selection over
  // into a different filter view would be both confusing and risky.
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [searchQuery, statusFilter, projectFilter, deptFilter, teamFilter, agentFilter, sortBy, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / pageSize));

  // Realtime updates can shrink the result set out from under whatever page
  // someone's currently viewing (e.g. another user deletes a lead) — snap
  // back to the last valid page instead of rendering an empty one.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const pagedLeads = useMemo(
    () => sortedLeads.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [sortedLeads, page, pageSize]
  );

  // The page/card list has no scroll container of its own — the whole page
  // scrolls (see AppLayout's <main>) — so switching pages while scrolled
  // deep into a long list would otherwise leave the new page's rows exactly
  // where the old ones were, off-screen. Skips the very first render so
  // landing on the page doesn't jump-scroll on its own.
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
      // No DB trigger logs deletions (triggers only cover insert/update),
      // so record it here like AuthContext does for login/logout.
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

  const toggleSelectLead = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Selects/deselects every lead in the current *filtered* set — not just
  // the current page — so "Select All" plus "Delete Selected" together
  // always act on exactly what the active filters show, never on leads
  // outside the current view.
  const allFilteredSelected = sortedLeads.length > 0 && sortedLeads.every((l) => selectedIds.has(l.id));
  const toggleSelectAll = () => {
    setSelectedIds(allFilteredSelected ? new Set() : new Set(sortedLeads.map((l) => l.id)));
  };

  // Actually commits one undo-window batch to the DB — fires 10s after
  // confirmation unless cancelled first via undoBulkDelete.
  const commitBulkDelete = async (batchId: string, targets: Lead[]) => {
    pendingDeleteTimersRef.current.delete(batchId);
    try {
      const ids = targets.map((l) => l.id);
      const { error } = await supabase.from('leads').delete().in('id', ids);
      if (error) throw error;

      await supabase.from('audit_logs').insert(
        targets.map((l) => ({
          action: 'lead_deleted',
          target_table: 'leads',
          target_id: l.id,
          performed_by: user?.id,
          old_value: { name: l.name, phone: l.phone, owner_id: l.owner_id },
        }))
      );
    } catch {
      toast.error('Could not delete the selected leads.');
    } finally {
      // Either the realtime reload already dropped these rows (success), or
      // it failed and they need to reappear instead of staying hidden
      // forever — both cases mean the optimistic hide should end now.
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
      // Re-authenticating with the typed password IS the confirmation check
      // — same pattern Settings.tsx uses for deleting one's own account.
      // signInWithPassword doesn't disturb the current session either way.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: bulkDeletePassword });
      if (verifyErr) { toast.error('Password is incorrect.'); return; }

      const targets = sortedLeads.filter((l) => selectedIds.has(l.id));
      if (targets.length === 0) return;
      const batchId = crypto.randomUUID();

      // Hide immediately (optimistic) and close the confirm dialog — the
      // actual delete is scheduled, not run yet, so it can still be undone.
      setPendingBulkDeletes((prev) => [...prev, { id: batchId, leads: targets }]);
      setSelectedIds(new Set());
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

  // Reads the file, maps ONLY the columns in IMPORT_COLUMNS (anything else
  // in the spreadsheet is never looked at), and stops at a preview — the
  // actual insert only happens if the user confirms it in confirmImport()
  // below, so a wrong column mapping never silently writes bad leads.
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between md:justify-end gap-4">
        <div className="md:hidden">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">{t('leads.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('leads.subtitle')}</p>
        </div>
        <div className="flex items-center flex-wrap justify-end gap-2 shrink-0">
          <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" />
          {isSuperAdmin && filteredLeads.length > 0 && (
            <>
              <Button
                variant="outline"
                onClick={toggleSelectAll}
                className="h-11 md:h-12 gap-2 active:scale-[0.98] transition-transform"
              >
                {allFilteredSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                <span className="hidden sm:inline">{allFilteredSelected ? 'Deselect All' : 'Select All'}</span>
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => setBulkDeleteOpen(true)}
                  className="h-11 md:h-12 gap-2 active:scale-[0.98] transition-transform"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected ({selectedIds.size})
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
                disabled={filteredLeads.length === 0}
                className="h-11 md:h-12 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover shrink-0 gap-2 active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {agentFilter !== 'all' && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
                  {agentFilter} · {filteredLeads.length} lead{filteredLeads.length > 1 ? 's' : ''}
                </div>
              )}
              <DropdownMenuItem onClick={() => exportAsExcel(filteredLeads)} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="w-4 h-4 text-success" /> Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsPDF(filteredLeads)} className="gap-2 cursor-pointer">
                <FileText className="w-4 h-4 text-destructive" /> PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsHTML(filteredLeads)} className="gap-2 cursor-pointer">
                <FileCode className="w-4 h-4 text-info" /> HTML
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsCSV(filteredLeads)} className="gap-2 cursor-pointer">
                <FileText className="w-4 h-4 text-primary" /> CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Search & Filters */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, phone, or sales person…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-12"
                />
              </div>
              {/* One-tap self filter — a manager sees their whole team's
                  leads via team-scoped RLS, so this is the fast way back to
                  just the ones they personally own, without opening the
                  filter sheet and hunting for their own name in the agent
                  list. Reuses the existing agentFilter/owner_name filtering
                  rather than adding a parallel filter path. */}
              {role === 'manager' && user?.name && (
                <button
                  type="button"
                  onClick={() => setAgentFilter((prev) => (prev === user.name ? 'all' : user.name))}
                  aria-pressed={agentFilter === user.name}
                  className={`flex items-center gap-1.5 px-3.5 h-12 rounded-lg border text-sm font-medium transition-colors shrink-0 ${
                    agentFilter === user.name
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  <UserIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">My Leads</span>
                </button>
              )}
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="md:hidden flex items-center gap-1.5 px-3.5 h-12 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span className="hidden sm:inline">Filters</span>
                    {(statusFilter !== 'all' || projectFilter !== 'all' || deptFilter !== 'all' || teamFilter !== 'all' || agentFilter !== 'all') && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[statusFilter, projectFilter, deptFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length}
                      </span>
                    )}
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-6 pb-8 max-h-[85dvh] overflow-y-auto">
                  <SheetHeader className="pb-4">
                    <SheetTitle className="text-base font-semibold flex items-center gap-2">
                      <Filter className="w-4 h-4 text-primary" /> Search / Filter
                    </SheetTitle>
                  </SheetHeader>
                  <div className="space-y-5">
                    <FilterFields
                      statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                      projectFilter={projectFilter} setProjectFilter={setProjectFilter}
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      sortBy={sortBy} setSortBy={setSortBy}
                      leads={leads} uniqueAgents={uniqueAgents} departments={departments} teamOptions={teamOptions}
                      showDept={showDeptFilter}
                    />
                    <SheetClose asChild>
                      <button type="button" className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium text-sm transition-colors hover:bg-primary/90 active:bg-primary/80">
                        Done
                      </button>
                    </SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop / tablet inline filters */}
            <div className="hidden md:flex flex-wrap gap-3 shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] h-11">
                  <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {LEAD_STAGES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-[180px] h-11">
                  <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {Array.from(new Set(leads.map((l) => l.preferred_project).filter(Boolean))).sort().map((p) => (
                    <SelectItem key={p as string} value={p as string}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showDeptFilter && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[140px] h-11">
                    <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              {teamOptions.length > 0 && (
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger className="w-[160px] h-11">
                    <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {teamOptions.map((tm) => (<SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[180px] h-11">
                  <UserIcon className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Sales person" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sales people</SelectItem>
                  {uniqueAgents.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-[170px] h-11">
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
            </div>

            <div className="md:hidden flex flex-wrap gap-2">
              {[
                ['status', statusFilter, setStatusFilter, statusFilter !== 'all' ? stageLabel(statusFilter) : ''],
                ['project', projectFilter, setProjectFilter, projectFilter],
                ['dept', deptFilter, setDeptFilter, deptFilter !== 'all' ? getDepartmentLabel(deptFilter) : ''],
                ['team', teamFilter, setTeamFilter, teamFilter !== 'all' ? (teamOptions.find((tm) => tm.id === teamFilter)?.name || '') : ''],
                ['agent', agentFilter, setAgentFilter, agentFilter],
              ].map(([key, value, setter, label]) =>
                value !== 'all' ? (
                  <button
                    key={key as string}
                    type="button"
                    onClick={() => (setter as (v: string) => void)('all')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                  >
                    {label as string}
                    <X className="w-3 h-3" />
                  </button>
                ) : null
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: Card List | Desktop: Table */}
      <Card ref={leadsCardRef} className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <FileText className="w-4 h-4 text-muted-foreground/80" />
            All Leads
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1 tabular-nums">{filteredLeads.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto bg-card">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-52 gap-2.5 text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5">
                <FileText className="w-9 h-9 mb-2 opacity-40" />
                <p className="text-sm font-medium">No leads found</p>
                <p className="text-xs mt-1">Try adjusting your search or filters</p>
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
                            <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Select all leads" />
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
                      {pagedLeads.map((lead) => (
                        <TableRow key={lead.id} className="table-row-interactive table-row-zebra cursor-pointer border-border/40" onClick={() => navigate(`/lead/${lead.id}`)}>
                          {isSuperAdmin && (
                            <TableCell className="pl-5 pr-0 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={selectedIds.has(lead.id)} onCheckedChange={() => toggleSelectLead(lead.id)} aria-label={`Select ${lead.name}`} />
                            </TableCell>
                          )}
                          <TableCell className={`${isSuperAdmin ? 'pl-3' : 'pl-5'} pr-4 py-2.5`}>
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
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
                                <Button variant="ghost" size="icon" title="View map" aria-label="View map" className="h-8 w-8 min-h-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => openMap(lead)}>
                                  <MapPin className="w-4 h-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" title="View details" aria-label="View details" className="h-8 w-8 min-h-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => navigate(`/lead/${lead.id}`)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              {canDeleteRow(lead) && (
                                <Button variant="ghost" size="icon" title="Delete lead" aria-label="Delete lead" className="h-8 w-8 min-h-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(lead)}>
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
                <div className="md:hidden divide-y divide-border">
                  {pagedLeads.map((lead) => (
                    <div key={lead.id} className="flex items-start gap-3 p-4 min-h-[72px] transition-colors hover:bg-muted/30 active:bg-muted/50">
                      {isSuperAdmin && (
                        <div className="pt-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(lead.id)} onCheckedChange={() => toggleSelectLead(lead.id)} aria-label={`Select ${lead.name}`} />
                        </div>
                      )}
                      {/* A plain div (not <button>) — it needs to contain the
                          NameLink's <a> and the "View map" <button> below,
                          and interactive elements can't nest inside a
                          <button> per HTML semantics. */}
                      <div role="button" tabIndex={0} onClick={() => navigate(`/lead/${lead.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/lead/${lead.id}`); }} className="flex-1 min-w-0 space-y-2 text-left cursor-pointer">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground truncate">{lead.name}</span>
                          <StatusBadge status={stageLabel(lead.status)} color={statusColors?.[lead.status] || '#8FA3BF'} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone || '—'}</span>
                          {lead.preferred_project && (<span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.preferred_project}</span>)}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
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
                          <button type="button" onClick={(e) => { e.stopPropagation(); openMap(lead); }} className="inline-flex items-center gap-1 text-xs text-primary font-medium mt-1">
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
          {!loading && sortedLeads.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-t border-border/60 bg-muted/5">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing <span className="font-medium text-foreground tabular-nums">{(page - 1) * pageSize + 1}</span>
                  –<span className="font-medium text-foreground tabular-nums">{Math.min(page * pageSize, sortedLeads.length)}</span>
                  {' '}of <span className="font-medium text-foreground tabular-nums">{sortedLeads.length}</span>
                </span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (<SelectItem key={n} value={String(n)}>{n} / page</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8 min-h-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page">
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 min-h-0 rounded-lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-xs font-medium text-foreground tabular-nums whitespace-nowrap">Page {page} of {totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8 min-h-0 rounded-lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 min-h-0 rounded-lg" disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">
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
            <DialogTitle className="text-base font-semibold flex items-center gap-2"><ListPlus className="w-5 h-5 text-primary" /> Import Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-5">
            <p className="text-sm text-muted-foreground">
              Only these columns are ever read from your file — anything else in the spreadsheet is ignored.
            </p>
            <div className="space-y-1.5">
              {importPreview?.columnMap.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-muted/20">
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
              <Button type="button" className="flex-1 h-11 gradient-primary text-white font-medium" disabled={importing} onClick={confirmImport}>
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
              <p className="text-sm text-muted-foreground mb-3">
                Lat: {Number(selectedLead.latitude).toFixed(5)}, Lng: {Number(selectedLead.longitude).toFixed(5)}
              </p>
              <div className="w-full aspect-video rounded-lg overflow-hidden border border-border">
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
                <p className="text-base font-semibold text-foreground truncate">{actionSheetLead.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{actionSheetLead.phone || 'No phone number'}</p>
              </div>
              <div className="px-2 py-2 space-y-1">
                <button
                  type="button"
                  onClick={() => { setActionSheetLead(null); navigate(`/lead/${actionSheetLead.id}`); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Eye className="w-4 h-4 text-primary" /></div>
                  View details
                </button>
                {actionSheetLead.phone && (
                  <a href={`tel:${actionSheetLead.phone}`} onClick={() => setActionSheetLead(null)} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0"><PhoneCall className="w-4 h-4 text-success" /></div>
                    Call
                  </a>
                )}
                {actionSheetLead.latitude && actionSheetLead.longitude && (
                  <button type="button" onClick={() => { openMap(actionSheetLead); setActionSheetLead(null); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0"><Navigation className="w-4 h-4 text-info" /></div>
                    View location
                  </button>
                )}
                {canDeleteRow(actionSheetLead) && (
                  <button type="button" onClick={() => { setDeleteTarget(actionSheetLead); setActionSheetLead(null); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/5 active:bg-destructive/10 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0"><Trash2 className="w-4 h-4 text-destructive" /></div>
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
            <AlertDialogTitle>Delete {selectedIds.size} selected lead{selectedIds.size === 1 ? '' : 's'}?</AlertDialogTitle>
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
              {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterFields({ statusFilter, setStatusFilter, projectFilter, setProjectFilter, deptFilter, setDeptFilter, teamFilter, setTeamFilter, agentFilter, setAgentFilter, sortBy, setSortBy, leads, uniqueAgents, departments, teamOptions, showDept = true }: any) {
  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Status</label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-12 w-full"><SelectValue placeholder="Select status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {LEAD_STAGES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Project</label>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-12 w-full"><SelectValue placeholder="Select project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {Array.from(new Set(leads.map((l: Lead) => l.preferred_project).filter(Boolean))).sort().map((p) => (
              <SelectItem key={p as string} value={p as string}>{p as string}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showDept && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Department</label>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-12 w-full"><SelectValue placeholder="Select department" /></SelectTrigger>
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
            <SelectTrigger className="h-12 w-full"><SelectValue placeholder="Select team" /></SelectTrigger>
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
          <SelectTrigger className="h-12 w-full"><SelectValue placeholder="Select sales person" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sales people</SelectItem>
            {uniqueAgents.map((a: string) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Sort By</label>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-12 w-full"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="name">Name (A–Z)</SelectItem>
            <SelectItem value="followup">Next follow-up</SelectItem>
            <SelectItem value="grade">Grade (A–C)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
