import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import { canAddFollowUp, isAdminOrAbove, isDepartmentScoped } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Search, Filter, Phone, User, MapPin, DollarSign, Calendar, MessageSquare, Eye,
  Loader2, Plus, ListChecks, HelpCircle, Upload, Download, FileSpreadsheet, FileText, Users,
} from 'lucide-react';
import { FOLLOWUP_TYPES, FOLLOWUP_STATUSES, getGradeForFollowUpStatus, type Lead, type FollowUp, type FollowUpStatus, type FollowUpType, type LeadGrade } from '@/types';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import NameLink from '@/components/NameLink';
import { toast } from 'sonner';

function followUpTypeLabel(type: string) {
  return FOLLOWUP_TYPES.find((t) => t.value === type)?.label || type;
}
function followUpStatusLabel(status: string) {
  return FOLLOWUP_STATUSES.find((s) => s.value === status)?.label || status;
}

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

const TH_STYLE = 'px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap';

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

interface LeadWithFollowUps extends Lead {
  followUps: FollowUp[];
}

const EXPORT_HEADERS = ['Customer Name', 'Mobile', 'Sales', 'Date', 'Location', 'Budget', 'Rate', 'Enquire Details', 'Follow Up Status'];

// A representative follow-up status is picked per imported grade so the
// database's follow-up→grade sync trigger lands back on the same grade we
// imported, instead of silently overwriting it (see database/crm.sql).
const GRADE_TO_IMPORT_STATUS: Record<LeadGrade, FollowUpStatus> = { A: 'site_visit', B: 'interested', C: 'busy' };

function normalizeGrade(raw: string): { grade: LeadGrade; original: string } {
  const original = raw.trim();
  const letter = original.charAt(0).toUpperCase();
  if (letter === 'A' || letter === 'B' || letter === 'C') return { grade: letter, original };
  return { grade: 'C', original }; // D/E/blank/unknown ratings fold into C (our lowest tier)
}

function detectFollowUpType(text: string): FollowUpType {
  const t = text.toLowerCase();
  if (t.includes('viber')) return 'viber';
  if (t.includes('whatsapp')) return 'whatsapp';
  if (t.includes('messenger')) return 'messenger';
  if (t.includes('email') || t.includes('mail')) return 'email';
  if (t.includes('site visit') || t.includes('appointment') || t.includes('visit')) return 'site_visit';
  if (t.includes('meeting') || t.includes('meet')) return 'meeting';
  return 'phone';
}

/** Handles both "D.M.YYYY" text cells and Excel's numeric date serials. */
function parseImportDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const str = String(raw).trim();
  const match = str.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (!match) return null;
  let [, day, month, year] = match;
  if (year.length === 2) year = `20${year}`;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function findColumn(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) => keywords.some((k) => h.includes(k)));
}

export default function FollowUps() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, role, department } = useAuth();
  usePageHeader(t('followups.title'), t('followups.subtitle'));
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [activeLead, setActiveLead] = useState<LeadWithFollowUps | null>(null);
  const [formType, setFormType] = useState('phone');
  const [formStatus, setFormStatus] = useState('interested');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Every role can import — Sales Persons use it for their own past
  // follow-ups (owner defaults to self, see canAssignOthers below), Managers
  // the same for their own, and only Admin/Boss/Super Admin can use the
  // Sales column to attribute rows to a different staff member.
  const canImport = !!role;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [leadsRes, followUpsRes] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('follow_ups').select('*').order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      setLeads((leadsRes.data || []) as Lead[]);
      setFollowUps((followUpsRes.data || []) as FollowUp[]);
      setLoading(false);
    };
    load();
    const channel = supabase
      .channel('follow-ups-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups' }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const rows = useMemo<LeadWithFollowUps[]>(() => {
    return leads.map((lead) => ({
      ...lead,
      followUps: followUps.filter((f) => f.lead_id === lead.id),
    }));
  }, [leads, followUps]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return rows.filter((r) => {
      const agent = nameOf(r.owner_id).toLowerCase();
      const matchesSearch = !searchQuery || r.name.toLowerCase().includes(q) || r.phone.includes(searchQuery) || agent.includes(q);
      const matchesDept = deptFilter === 'all' || r.department_code === deptFilter;
      const latestStatus = r.followUps[0]?.status;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'none' ? r.followUps.length === 0 : latestStatus === statusFilter);
      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [rows, searchQuery, deptFilter, statusFilter, nameOf]);

  const summary = useMemo(() => ({
    total: rows.length,
    none: rows.filter((r) => r.followUps.length === 0).length,
    gradeA: rows.filter((r) => r.lead_grade === 'A').length,
    gradeB: rows.filter((r) => r.lead_grade === 'B').length,
    gradeC: rows.filter((r) => r.lead_grade === 'C').length,
  }), [rows]);

  const openLead = (lead: LeadWithFollowUps) => {
    setActiveLead(lead);
    setFormType('phone');
    setFormStatus('interested');
    setFormNotes('');
  };

  const currentUser = user ? { id: user.id, role, department: user.department } : null;
  const canFollowUpActive = activeLead ? canAddFollowUp(currentUser, { ownerId: activeLead.owner_id, departmentCode: activeLead.department_code }) : false;

  const handleAddFollowUp = async () => {
    if (!activeLead || !formNotes.trim()) { toast.error('Add a note for this follow-up.'); return; }
    setSaving(true);
    const { error } = await supabase.from('follow_ups').insert({
      lead_id: activeLead.id, created_by: user?.id, type: formType, status: formStatus, notes: formNotes.trim(),
    });
    setSaving(false);
    if (error) { toast.error('Could not add follow-up.'); return; }
    toast.success('Follow-up added.');
    setFormNotes('');
  };

  // ── Export ──────────────────────────────────────────────────────────────
  const buildExportRows = () => filteredRows.map((r) => {
    const latest = r.followUps[0];
    const date = latest?.created_at || r.created_at;
    return [
      r.name, r.phone, nameOf(r.owner_id), new Date(date).toLocaleDateString('en-GB'),
      r.current_location || '', r.budget_range || '', r.lead_grade || '',
      r.interest_type || '', latest?.notes || (latest ? followUpStatusLabel(latest.status) : ''),
    ];
  });

  const exportAsExcel = async () => {
    const XLSX = await import('xlsx'); // heavy — loaded only when exporting
    const data = buildExportRows().map((row) => Object.fromEntries(EXPORT_HEADERS.map((h, i) => [h, row[i]])));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Follow-ups');
    XLSX.writeFile(wb, `Follow_ups_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportAsCSV = () => {
    const rowsOut = [EXPORT_HEADERS, ...buildExportRows()];
    const csv = rowsOut.map((row) => row.map((cell) => {
      const val = String(cell ?? '');
      return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Follow_ups_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Import ──────────────────────────────────────────────────────────────
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    setImporting(true);
    try {
      const XLSX = await import('xlsx'); // heavy — loaded only when importing
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rowsRaw: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rowsRaw.length < 2) { toast.error('No data found in the spreadsheet.'); setImporting(false); return; }

      const headers = rowsRaw[0].map((h: any) => String(h).trim().toLowerCase());
      const col = {
        name: findColumn(headers, ['customer', 'name']),
        phone: findColumn(headers, ['mobile', 'phone']),
        sales: findColumn(headers, ['sale']),
        date: findColumn(headers, ['date']),
        location: findColumn(headers, ['location']),
        budget: findColumn(headers, ['budget']),
        rate: findColumn(headers, ['rate']),
        enquire: findColumn(headers, ['enquir']),
        followStatus: findColumn(headers, ['follow']),
      };

      const canAssignOthers = isAdminOrAbove(role);
      const defaultDept = department || departments[0]?.code || '';

      const leadPayloads: any[] = [];
      const meta: { notes: string; type: FollowUpType; status: FollowUpStatus }[] = [];
      let matchedAgents = 0;
      let unmatchedAgents = 0;
      let adjustedRates = 0;

      for (let i = 1; i < rowsRaw.length; i++) {
        const row = rowsRaw[i];
        const name = col.name >= 0 ? String(row[col.name] || '').trim() : '';
        const phone = col.phone >= 0 ? String(row[col.phone] || '').trim() : '';
        if (!name && !phone) continue;

        const rateRaw = col.rate >= 0 ? String(row[col.rate] || '') : '';
        const { grade, original } = normalizeGrade(rateRaw);
        if (original && original.toUpperCase() !== grade) adjustedRates++;

        const salesRaw = col.sales >= 0 ? String(row[col.sales] || '').trim() : '';
        let ownerId = user.id;
        if (salesRaw && canAssignOthers) {
          const match = profiles.find((p) => {
            const initials = p.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
            return p.name.toUpperCase().includes(salesRaw.toUpperCase()) || initials === salesRaw.toUpperCase();
          });
          if (match) { ownerId = match.id; matchedAgents++; } else { unmatchedAgents++; }
        }

        const dateIso = col.date >= 0 ? parseImportDate(row[col.date]) : null;
        const followText = col.followStatus >= 0 ? String(row[col.followStatus] || '').trim() : '';

        leadPayloads.push({
          name: name || 'Unknown',
          phone,
          current_location: col.location >= 0 ? String(row[col.location] || '').trim() || null : null,
          budget_range: col.budget >= 0 ? String(row[col.budget] || '').trim() || null : null,
          interest_type: col.enquire >= 0 ? String(row[col.enquire] || '').trim() || null : null,
          lead_grade: grade,
          lead_grade_reason: original ? `Imported rating: ${original}` : null,
          department_code: defaultDept,
          owner_id: ownerId,
          created_by: user.id,
          status: 'new',
          ...(dateIso ? { created_at: dateIso } : {}),
        });
        meta.push({ notes: followText, type: detectFollowUpType(followText), status: GRADE_TO_IMPORT_STATUS[grade] });
      }

      if (leadPayloads.length === 0) { toast.error('No valid rows found to import.'); setImporting(false); return; }

      const { data: insertedLeads, error: leadsErr } = await supabase.from('leads').insert(leadPayloads).select('id');
      if (leadsErr) throw leadsErr;

      const followUpPayloads = (insertedLeads || []).map((lead, idx) => ({
        lead_id: lead.id,
        created_by: user.id,
        type: meta[idx].type,
        status: meta[idx].status,
        notes: meta[idx].notes || null,
        ...(leadPayloads[idx].created_at ? { created_at: leadPayloads[idx].created_at } : {}),
      })).filter((f) => f.notes);

      let followUpErrorCount = 0;
      if (followUpPayloads.length > 0) {
        const { error: fErr, count } = await supabase.from('follow_ups').insert(followUpPayloads);
        if (fErr) followUpErrorCount = followUpPayloads.length;
        void count;
      }

      const parts = [`${insertedLeads?.length || 0} leads imported`];
      if (matchedAgents > 0) parts.push(`${matchedAgents} sales matched by name`);
      if (unmatchedAgents > 0) parts.push(`${unmatchedAgents} assigned to you (no name match)`);
      if (adjustedRates > 0) parts.push(`${adjustedRates} ratings adjusted to fit A–C`);
      if (followUpErrorCount > 0) parts.push(`${followUpErrorCount} follow-up notes skipped (no permission)`);
      toast.success(parts.join(' · '));
    } catch (err: any) {
      toast.error(err.message || 'Import failed.');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between md:justify-end gap-4">
        <div className="md:hidden">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground flex items-center gap-2"><ListChecks className="w-5 h-5 text-primary" /> {t('followups.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('followups.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canImport && (
            <>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" />
              <Button variant="outline" disabled={importing} onClick={() => importFileRef.current?.click()} className="h-11 gap-2">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="hidden sm:inline">{importing ? 'Importing…' : 'Import'}</span>
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={filteredRows.length === 0} className="h-11 gradient-primary hover:gradient-primary-hover text-white font-medium gap-2">
                <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={exportAsExcel} className="gap-2 cursor-pointer"><FileSpreadsheet className="w-4 h-4 text-success" /> Excel</DropdownMenuItem>
              <DropdownMenuItem onClick={exportAsCSV} className="gap-2 cursor-pointer"><FileText className="w-4 h-4 text-primary" /> CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary */}
      <div className="flex md:grid md:grid-cols-5 gap-3 overflow-x-auto md:overflow-visible pb-1 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[130px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Users className="w-4 h-4 text-primary" /></div>
            <div><p className="text-lg font-bold text-foreground leading-tight">{summary.total}</p><p className="text-[11px] text-muted-foreground">Total Leads</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[130px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0"><HelpCircle className="w-4 h-4 text-muted-foreground" /></div>
            <div><p className="text-lg font-bold text-foreground leading-tight">{summary.none}</p><p className="text-[11px] text-muted-foreground">No Follow-up Yet</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[110px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0 text-destructive font-bold text-xs">A</div>
            <div><p className="text-lg font-bold text-foreground leading-tight">{summary.gradeA}</p><p className="text-[11px] text-muted-foreground">Grade A</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[110px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center shrink-0 text-warning font-bold text-xs">B</div>
            <div><p className="text-lg font-bold text-foreground leading-tight">{summary.gradeB}</p><p className="text-[11px] text-muted-foreground">Grade B</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[110px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground font-bold text-xs">C</div>
            <div><p className="text-lg font-bold text-foreground leading-tight">{summary.gradeC}</p><p className="text-[11px] text-muted-foreground">Grade C</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by customer, phone, or sales person…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-12" />
            </div>
            <div className="flex gap-2">
              {/* Dept-scoped roles (admin/manager/sale) only see their own
                  department via RLS — no point offering the filter. */}
              {!isDepartmentScoped(role) && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-full md:w-[160px] h-12"><Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[180px] h-12"><SelectValue placeholder="Follow-up status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="none">No follow-up yet</SelectItem>
                  {FOLLOWUP_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <ListChecks className="w-4 h-4 text-muted-foreground/80" />
            Leads
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1 tabular-nums">{filteredRows.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5">
              <ListChecks className="w-9 h-9 mb-2 opacity-40" />
              <p className="text-sm font-medium">No leads match your filters</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/30">
                      <TableHead className={`${TH_STYLE} pl-5`}>Customer</TableHead>
                      <TableHead className={TH_STYLE}>Sales Person</TableHead>
                      <TableHead className={TH_STYLE}>Last Update</TableHead>
                      <TableHead className={TH_STYLE}>Location</TableHead>
                      <TableHead className={TH_STYLE}>Budget</TableHead>
                      <TableHead className={TH_STYLE}>Grade</TableHead>
                      <TableHead className={TH_STYLE}>Enquiry</TableHead>
                      <TableHead className={`${TH_STYLE} pr-5`}>Follow-up Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => {
                      const latest = row.followUps[0];
                      const date = latest?.created_at || row.created_at;
                      return (
                        <TableRow key={row.id} className="table-row-interactive table-row-zebra cursor-pointer border-border/40" onClick={() => openLead(row)}>
                          <TableCell className="pl-5 pr-4 py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                                {initialsOf(row.name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate max-w-[170px]">{row.name}</p>
                                <p className="text-xs text-muted-foreground tabular-nums">{row.phone || 'No phone'}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap text-sm text-muted-foreground">
                            {row.owner_id ? <NameLink id={row.owner_id} name={nameOf(row.owner_id)} showAvatar={false} /> : '—'}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 opacity-60" />
                              {new Date(date).toLocaleDateString()}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap text-sm max-w-[140px] truncate" title={row.current_location || ''}>{row.current_location || '—'}</TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap text-sm tabular-nums">{row.budget_range || '—'}</TableCell>
                          <TableCell className="px-4 py-2.5 whitespace-nowrap"><LeadLevelBadge grade={row.lead_grade} /></TableCell>
                          <TableCell className="px-4 py-2.5 text-sm max-w-[200px] truncate" title={row.interest_type || ''}>{row.interest_type || '—'}</TableCell>
                          <TableCell className="pl-4 pr-5 py-2.5 max-w-[240px]">
                            {latest ? (
                              <div className="space-y-1">
                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[latest.status] || 'bg-muted text-muted-foreground border-border'}`}>
                                  {followUpStatusLabel(latest.status)}
                                  {row.followUps.length > 1 && <span className="opacity-60">· {row.followUps.length}</span>}
                                </span>
                                {latest.notes && <p className="text-xs text-muted-foreground truncate" title={latest.notes}>{latest.notes}</p>}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
                                <HelpCircle className="w-3 h-3" /> No follow-up yet
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {filteredRows.map((row) => {
                  const latest = row.followUps[0];
                  const date = latest?.created_at || row.created_at;
                  return (
                    <div key={row.id} role="button" tabIndex={0} onClick={() => openLead(row)} onKeyDown={(e) => { if (e.key === 'Enter') openLead(row); }} className="w-full text-left p-4 hover:bg-muted/30 active:bg-muted/50 transition-colors space-y-2 cursor-pointer">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">{row.name}</span>
                        <LeadLevelBadge grade={row.lead_grade} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{row.phone}</span>
                        {row.owner_id ? <NameLink id={row.owner_id} name={nameOf(row.owner_id)} showAvatar={false} /> : <span className="flex items-center gap-1"><User className="w-3 h-3" />Unassigned</span>}
                      </div>
                      {row.current_location && <div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="w-3 h-3" />{row.current_location}</div>}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        {latest ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[latest.status] || 'bg-muted text-muted-foreground border-border'}`}>
                            {followUpStatusLabel(latest.status)}
                            {row.followUps.length > 1 && <span className="opacity-60">· {row.followUps.length}</span>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
                            <HelpCircle className="w-3 h-3" /> No follow-up yet
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!activeLead} onOpenChange={(open) => !open && setActiveLead(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden max-h-[85dvh] flex flex-col">
          {activeLead && (
            <>
              <DialogHeader className="px-6 pt-6 pb-3 pr-12 border-b border-border shrink-0 space-y-2">
                <DialogTitle className="text-base font-semibold truncate pr-2">{activeLead.name}</DialogTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{activeLead.phone}</span>
                  {activeLead.owner_id ? <NameLink id={activeLead.owner_id} name={nameOf(activeLead.owner_id)} showAvatar={false} /> : <span className="flex items-center gap-1"><User className="w-3 h-3" />Unassigned</span>}
                  {activeLead.budget_range && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{activeLead.budget_range}</span>}
                </div>
                <button type="button" onClick={() => navigate(`/lead/${activeLead.id}`)} className="w-fit -ml-2 flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-md px-2 py-1 transition-colors">
                  <Eye className="w-3.5 h-3.5" /> View full lead
                </button>
              </DialogHeader>

              <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
                {canFollowUpActive && (
                  <div className="rounded-xl border border-border p-3 space-y-3 bg-muted/20">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Add Follow-up</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={formType} onValueChange={setFormType}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>{FOLLOWUP_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}</SelectContent>
                      </Select>
                      <Select value={formStatus} onValueChange={setFormStatus}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>{FOLLOWUP_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <Textarea placeholder="What happened? How did the customer respond?" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="min-h-[70px]" />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>This outcome will set the lead's grade to</span>
                      <LeadLevelBadge grade={getGradeForFollowUpStatus(formStatus as FollowUpStatus)} />
                    </div>
                    <Button onClick={handleAddFollowUp} disabled={saving} className="w-full sm:w-auto gap-2">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Follow-up
                    </Button>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">History ({activeLead.followUps.length})</p>
                  {activeLead.followUps.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No follow-ups recorded yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {activeLead.followUps.map((f) => (
                        <div key={f.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                          <div className="mt-0.5 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><MessageSquare className="w-4 h-4 text-primary" /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">{followUpTypeLabel(f.type)}</span>
                              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[f.status] || 'bg-muted text-muted-foreground border-border'}`}>{followUpStatusLabel(f.status)}</span>
                            </div>
                            {f.notes && <p className="text-sm text-muted-foreground mt-1">{f.notes}</p>}
                            <p className="text-xs text-muted-foreground mt-1">{new Date(f.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
