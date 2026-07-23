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
import { MapPin, FileText, Search, Filter, Eye, Phone, Calendar, User as UserIcon, X, SlidersHorizontal, MoreVertical, PhoneCall, Navigation, Upload, Loader2, Download, FileSpreadsheet, FileCode, Trash2, CheckCircle2, XCircle, ListPlus } from 'lucide-react';
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

function stageLabel(status: string) {
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
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

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');

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

  const leads: Lead[] = useMemo(
    () => rawLeads.map((l) => ({ ...l, owner_name: nameOf(l.owner_id) })),
    [rawLeads, nameOf]
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
        <div className="flex items-center gap-2 shrink-0">
          <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" />
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
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
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
                        <TableHead className={`${TH_STYLE} pl-5`}>Customer</TableHead>
                        <TableHead className={TH_STYLE}>Project / Budget</TableHead>
                        <TableHead className={TH_STYLE}>Grade</TableHead>
                        <TableHead className={TH_STYLE}>Status</TableHead>
                        <TableHead className={TH_STYLE}>Sales Person</TableHead>
                        <TableHead className={TH_STYLE}>Next Follow-up</TableHead>
                        <TableHead className={`${TH_STYLE} pr-5 text-right`}>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map((lead) => (
                        <TableRow key={lead.id} className="table-row-interactive table-row-zebra cursor-pointer border-border/40" onClick={() => navigate(`/lead/${lead.id}`)}>
                          <TableCell className="pl-5 pr-4 py-2.5">
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
                  {filteredLeads.map((lead) => (
                    <div key={lead.id} className="flex items-start gap-3 p-4 min-h-[72px] transition-colors hover:bg-muted/30 active:bg-muted/50">
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
    </div>
  );
}

function FilterFields({ statusFilter, setStatusFilter, projectFilter, setProjectFilter, deptFilter, setDeptFilter, teamFilter, setTeamFilter, agentFilter, setAgentFilter, leads, uniqueAgents, departments, teamOptions, showDept = true }: any) {
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
    </>
  );
}
