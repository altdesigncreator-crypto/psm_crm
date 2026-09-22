import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { enumLabel, type Lang } from '@/lib/translations';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import { useTeams } from '@/hooks/useTeams';
import { canAddFollowUp, isAdminOrAbove, isDepartmentScoped, getDepartmentLabel } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Search, Filter, Phone, User, MapPin, DollarSign, Calendar, MessageSquare, Eye,
  Loader2, Plus, ListChecks, HelpCircle, Upload, Download, FileSpreadsheet, FileText, Users,
  SlidersHorizontal, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, X,
  AlertTriangle, Clock, CalendarClock,
} from 'lucide-react';
import { FOLLOWUP_TYPES, FOLLOWUP_STATUSES, getGradeForFollowUpStatus, type Lead, type FollowUp, type FollowUpStatus, type FollowUpType, type LeadGrade } from '@/types';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import NameLink from '@/components/NameLink';
import { toast } from 'sonner';
import { cacheGet, cacheSetDebounced } from '@/lib/localCache';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import PeriodFilterBar from '@/components/PeriodFilterBar';

const FOLLOWUPS_CACHE_TTL_MS = 5 * 60 * 1000;
const leadsCacheKey = (userId: string) => `followups-leads:${userId}`;
const followUpsCacheKey = (userId: string) => `followups-list:${userId}`;

function followUpTypeLabel(type: string, lang: Lang) {
  const found = FOLLOWUP_TYPES.find((t) => t.value === type);
  return enumLabel('followupType', type, found?.label || type, lang);
}
function followUpStatusLabel(status: string, lang: Lang) {
  const found = FOLLOWUP_STATUSES.find((s) => s.value === status);
  return enumLabel('followupStatus', status, found?.label || status, lang);
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

// Same status→color mapping as STATUS_STYLE, as a left-edge accent instead
// of a badge fill — lets the mobile card list (below) be scanned by color
// alone, same pattern as the Leads page's mobile cards.
const STATUS_ACCENT: Record<string, string> = {
  interested: 'border-l-success',
  not_interested: 'border-l-destructive',
  busy: 'border-l-warning',
  no_answer: 'border-l-border',
  call_later: 'border-l-info',
  site_visit: 'border-l-primary',
  booking: 'border-l-success',
  lost: 'border-l-destructive',
};

interface LeadWithFollowUps extends Lead {
  followUps: FollowUp[];
}

const EXPORT_HEADERS = ['Customer Name', 'Mobile', 'Sales', 'Date', 'Location', 'Budget', 'Rate', 'Enquire Details', 'Follow Up Status'];

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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localDateStr(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function FollowUps() {
  const navigate = useNavigate();
  const { t, lang } = useTranslation();
  const { user, role, department } = useAuth();
  usePageHeader(t('followups.title'), t('followups.subtitle'));
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();
  const { teams, membersOf } = useTeams();

  const cachedLeads = user ? cacheGet<Lead[]>(leadsCacheKey(user.id), FOLLOWUPS_CACHE_TTL_MS) : undefined;
  const cachedFollowUps = user ? cacheGet<FollowUp[]>(followUpsCacheKey(user.id), FOLLOWUPS_CACHE_TTL_MS) : undefined;
  const [leads, setLeads] = useState<Lead[]>(cachedLeads ?? []);
  const [followUps, setFollowUps] = useState<FollowUp[]>(cachedFollowUps ?? []);
  const [loading, setLoading] = useState(cachedLeads === undefined || cachedFollowUps === undefined);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'grade'>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { period, setPeriod, selectedMonth, selectedYear, isCurrentPeriod, shiftPeriod, periodLabel, matchesPeriod } = usePeriodFilter();

  // Mobile-only: Upcoming/Overdue start collapsed so the queue opens on
  // today's work, not a long scroll past leads that aren't due yet —
  // desktop's 3-column grid has room to always show all three, so this
  // only affects the stacked single-column mobile layout (see md:block
  // override below).
  const [collapsedQueueSections, setCollapsedQueueSections] = useState<Record<'upcoming' | 'overdue', boolean>>({ upcoming: true, overdue: true });
  const toggleQueueSection = (key: 'upcoming' | 'overdue') => setCollapsedQueueSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const [activeLead, setActiveLead] = useState<LeadWithFollowUps | null>(null);
  const [formType, setFormType] = useState('phone');
  const [formStatus, setFormStatus] = useState('interested');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const canImport = !!role;

  useEffect(() => {
    if (!user) return;
    let active = true;
    const writeLeadsCache = (list: Lead[]) => { cacheSetDebounced(leadsCacheKey(user.id), list); return list; };
    const writeFollowUpsCache = (list: FollowUp[]) => { cacheSetDebounced(followUpsCacheKey(user.id), list); return list; };
    const load = async () => {
      try {
        const [leadsRows, followUpsRows] = await Promise.all([
          fetchAllRows<Lead>('leads'),
          fetchAllRows<FollowUp>('follow_ups'),
        ]);
        if (!active) return;
        setLeads(writeLeadsCache(leadsRows));
        setFollowUps(writeFollowUpsCache(followUpsRows));
      } catch {
        if (active) toast.error(t('followups.loadError'));
      }
      if (active) setLoading(false);
    };
    load();
    const channel = supabase
      .channel('follow-ups-page')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setLeads((prev) => writeLeadsCache(prev.some((l) => l.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setLeads((prev) => writeLeadsCache(prev.map((l) => (l.id === row.id ? row : l))));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setLeads((prev) => writeLeadsCache(prev.filter((l) => l.id !== oldId)));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'follow_ups' }, (payload) => {
        const row = payload.new as FollowUp;
        setFollowUps((prev) => writeFollowUpsCache(prev.some((f) => f.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'follow_ups' }, (payload) => {
        const row = payload.new as FollowUp;
        setFollowUps((prev) => writeFollowUpsCache(prev.map((f) => (f.id === row.id ? row : f))));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'follow_ups' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setFollowUps((prev) => writeFollowUpsCache(prev.filter((f) => f.id !== oldId)));
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  const allRows = useMemo<LeadWithFollowUps[]>(() => {
    return leads.map((lead) => ({
      ...lead,
      followUps: followUps.filter((f) => f.lead_id === lead.id),
    }));
  }, [leads, followUps]);

  const rows = useMemo(
    () => allRows.filter((r) => r.followUps.length > 0 && matchesPeriod(r.created_at)),
    [allRows, matchesPeriod]
  );

  // Deliberately built from allRows, not rows — a lead awaiting its very
  // first follow-up (no history yet) is exactly the kind of thing this
  // queue exists to surface, so it can't require followUps.length > 0.
  const upcomingQueue = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const bucketOf = (r: LeadWithFollowUps): 'overdue' | 'today' | 'upcoming' => {
      const due = new Date(r.next_follow_up_at!); due.setHours(0, 0, 0, 0);
      const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (diff < 0) return 'overdue';
      if (diff === 0) return 'today';
      return 'upcoming';
    };
    const active = allRows
      .filter((r) => r.follow_up_state !== 'cold' && r.status !== 'sold' && r.status !== 'lost' && !!r.next_follow_up_at)
      .sort((a, b) => (a.next_follow_up_at || '').localeCompare(b.next_follow_up_at || ''));
    return {
      overdue: active.filter((r) => bucketOf(r) === 'overdue'),
      today: active.filter((r) => bucketOf(r) === 'today'),
      upcoming: active.filter((r) => bucketOf(r) === 'upcoming'),
    };
  }, [allRows]);

  const uniqueProjects = useMemo(
    () => Array.from(new Set(leads.map((l) => l.preferred_project).filter(Boolean))).sort() as string[],
    [leads]
  );
  const toggleProjectFilter = (project: string) => {
    setProjectFilters((prev) => (prev.includes(project) ? prev.filter((p) => p !== project) : [...prev, project]));
  };

  const uniqueAgents = useMemo(() => Array.from(new Set(profiles.map((p) => p.name))).sort(), [profiles]);

  const teamOptions = useMemo(
    () => teams.filter((tm) => deptFilter === 'all' || tm.department_code === deptFilter),
    [teams, deptFilter]
  );
  const teamMemberIds = useMemo(() => (teamFilter === 'all' ? [] : membersOf(teamFilter)), [teamFilter, membersOf]);
  const teamManagerId = useMemo(() => (teamFilter === 'all' ? null : teams.find((tm) => tm.id === teamFilter)?.manager_id ?? null), [teamFilter, teams]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return rows.filter((r) => {
      const agent = nameOf(r.owner_id).toLowerCase();
      const matchesSearch = !searchQuery || r.name.toLowerCase().includes(q) || r.phone.includes(searchQuery) || agent.includes(q);
      const matchesDept = deptFilter === 'all' || r.department_code === deptFilter;
      const latestStatus = r.followUps[0]?.status;
      const matchesStatus = statusFilter === 'all' || latestStatus === statusFilter;
      const matchesProject = projectFilters.length === 0 || (!!r.preferred_project && projectFilters.includes(r.preferred_project));
      const matchesTeam = teamFilter === 'all'
        || r.team_id === teamFilter
        || (!!r.owner_id && teamMemberIds.includes(r.owner_id))
        || (!!r.owner_id && r.owner_id === teamManagerId);
      const matchesAgent = agentFilter === 'all' || nameOf(r.owner_id) === agentFilter;
      const matchesDate = !dateFilter || localDateStr(r.created_at) === dateFilter;
      return matchesSearch && matchesDept && matchesStatus && matchesProject && matchesTeam && matchesAgent && matchesDate;
    });
  }, [rows, searchQuery, deptFilter, statusFilter, projectFilters, teamFilter, teamMemberIds, teamManagerId, agentFilter, dateFilter, nameOf]);

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    switch (sortBy) {
      case 'oldest':
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'name':
        arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
  }, [filteredRows, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, deptFilter, statusFilter, projectFilters, teamFilter, agentFilter, dateFilter, period, selectedMonth, selectedYear, sortBy, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const pagedRows = useMemo(
    () => sortedRows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [sortedRows, page, pageSize]
  );

  const summary = useMemo(() => ({
    total: rows.length,
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
    if (!activeLead || !formNotes.trim()) { toast.error(t('followups.noNoteError')); return; }
    setSaving(true);
    const { error } = await supabase.from('follow_ups').insert({
      lead_id: activeLead.id, created_by: user?.id, type: formType, status: formStatus, notes: formNotes.trim(),
    });
    setSaving(false);
    if (error) { toast.error(t('followups.addFollowUpError')); return; }
    toast.success(t('followups.addedToast'));
    setFormNotes('');
  };

  // ── Export ──────────────────────────────────────────────────────────────
  const buildExportRows = () => filteredRows.map((r) => {
    const latest = r.followUps[0];
    const date = latest?.created_at || r.created_at;
    return [
      r.name, r.phone, nameOf(r.owner_id), new Date(date).toLocaleDateString('en-GB'),
      r.current_location || '', r.budget_range || '', r.lead_grade || '',
      r.interest_type || '', latest?.notes || (latest ? followUpStatusLabel(latest.status, 'en') : ''),
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
      if (rowsRaw.length < 2) { toast.error(t('leads.noDataInSpreadsheet')); setImporting(false); return; }

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
          created_at: dateIso || new Date().toISOString(),
        });
        meta.push({ notes: followText, type: detectFollowUpType(followText), status: GRADE_TO_IMPORT_STATUS[grade] });
      }

      if (leadPayloads.length === 0) { toast.error(t('followups.noValidRowsImport')); setImporting(false); return; }

      const { data: insertedLeads, error: leadsErr } = await supabase.from('leads').insert(leadPayloads).select('id');
      if (leadsErr) throw leadsErr;

      const followUpPayloads = (insertedLeads || []).map((lead, idx) => ({
        lead_id: lead.id,
        created_by: user.id,
        type: meta[idx].type,
        status: meta[idx].status,
        notes: meta[idx].notes || null,
        created_at: leadPayloads[idx].created_at,
      })).filter((f) => f.notes);

      let followUpErrorCount = 0;
      if (followUpPayloads.length > 0) {
        const { error: fErr, count } = await supabase.from('follow_ups').insert(followUpPayloads);
        if (fErr) followUpErrorCount = followUpPayloads.length;
        void count;
      }

      const parts = [`${insertedLeads?.length || 0} ${t('followups.leadsImportedSuffix')}`];
      if (matchedAgents > 0) parts.push(`${matchedAgents} ${t('followups.salesMatchedSuffix')}`);
      if (unmatchedAgents > 0) parts.push(`${unmatchedAgents} ${t('followups.assignedToYouSuffix')}`);
      if (adjustedRates > 0) parts.push(`${adjustedRates} ${t('followups.ratingsAdjustedSuffix')}`);
      if (followUpErrorCount > 0) parts.push(`${followUpErrorCount} ${t('followups.notesSkippedSuffix')}`);
      toast.success(parts.join(' · '));
    } catch (err: any) {
      toast.error(err.message || t('leads.importFailed'));
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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canImport && (
            <>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" />
              <Button variant="outline" disabled={importing} onClick={() => importFileRef.current?.click()} className="h-11 gap-2">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="hidden sm:inline">{importing ? t('leads.importing') : t('common.import')}</span>
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={filteredRows.length === 0} className="h-11 gradient-primary hover:gradient-primary-hover text-white font-medium gap-2">
                <Download className="w-4 h-4" /> <span className="hidden sm:inline">{t('common.export')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={exportAsExcel} className="gap-2 cursor-pointer"><FileSpreadsheet className="w-4 h-4 text-success" /> Excel</DropdownMenuItem>
              <DropdownMenuItem onClick={exportAsCSV} className="gap-2 cursor-pointer"><FileText className="w-4 h-4 text-primary" /> CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Follow-up Queue — grouped by urgency so what needs attention right
          now is immediately scannable, distinct from the historical record
          table further down the page. Built from every active lead with a
          scheduled date, including ones awaiting their very first
          follow-up. */}
      <Card className="shadow-card rounded-2xl border-0 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent pointer-events-none" />
        <CardContent className="p-4 md:p-6 relative">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><CalendarClock className="w-4 h-4 text-primary" /></div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('followups.queueTitle')}</h2>
              <p className="text-xs text-muted-foreground">{t('followups.queueSubtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              { key: 'upcoming' as const, label: t('followups.upcoming'), icon: <CalendarClock className="w-3.5 h-3.5" />, accent: 'border-info/30 bg-info/[0.04]', dot: 'bg-info', badge: 'bg-info/10 text-info' },
              { key: 'today' as const, label: t('followups.dueToday'), icon: <Clock className="w-3.5 h-3.5" />, accent: 'border-warning/30 bg-warning/[0.04]', dot: 'bg-warning', badge: 'bg-warning/10 text-warning' },
              { key: 'overdue' as const, label: t('followups.overdue'), icon: <AlertTriangle className="w-3.5 h-3.5" />, accent: 'border-destructive/30 bg-destructive/[0.04]', dot: 'bg-destructive', badge: 'bg-destructive/10 text-destructive' },
            ]).map((col) => {
              const items = upcomingQueue[col.key];
              const isCollapsible = col.key === 'upcoming' || col.key === 'overdue';
              const isCollapsed = isCollapsible && collapsedQueueSections[col.key];
              const header = (
                <>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${col.badge} px-2 py-1 rounded-full`}>
                    {col.icon} {col.label}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums">{items.length}</span>
                    {isCollapsible && (
                      <ChevronDown className={`md:hidden w-4 h-4 text-muted-foreground transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`} />
                    )}
                  </span>
                </>
              );
              return (
                <div key={col.key} className={`rounded-xl border ${col.accent} p-3 flex flex-col`}>
                  {isCollapsible ? (
                    <button
                      type="button"
                      onClick={() => toggleQueueSection(col.key)}
                      aria-expanded={!isCollapsed}
                      aria-controls={`followup-queue-${col.key}`}
                      className="md:pointer-events-none flex items-center justify-between w-full mb-2.5 px-0.5 -mx-0.5 py-0.5 rounded-lg text-left active:bg-black/[0.03]"
                    >
                      {header}
                    </button>
                  ) : (
                    <div className="flex items-center justify-between mb-2.5 px-0.5">
                      {header}
                    </div>
                  )}
                  {items.length === 0 ? (
                    <div id={`followup-queue-${col.key}`} className={`${isCollapsed ? 'hidden md:flex' : 'flex'} flex-1 items-center justify-center py-6 text-xs text-muted-foreground`}>
                      {t('followups.nothingHere')}
                    </div>
                  ) : (
                    <div id={`followup-queue-${col.key}`} className={`${isCollapsed ? 'hidden md:block' : ''} space-y-1 max-h-[280px] overflow-y-auto pr-0.5`}>
                      {items.map((lead) => (
                        <button
                          type="button"
                          key={lead.id}
                          onClick={() => openLead(lead)}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-card active:bg-card/80 transition-colors text-left"
                        >
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${col.dot}`} />
                          <div className="w-8 h-8 rounded-full bg-card border border-border text-foreground/80 text-[10px] font-semibold flex items-center justify-center shrink-0">
                            {initialsOf(lead.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {col.key === 'upcoming' ? new Date(lead.next_follow_up_at!).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : lead.phone}
                            </p>
                          </div>
                          {lead.lead_grade ? (
                            <>
                              <LeadLevelBadge grade={lead.lead_grade} compact className="md:hidden" />
                              <LeadLevelBadge grade={lead.lead_grade} className="hidden md:inline-flex" />
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-muted text-muted-foreground border-border shrink-0">
                              <span className="w-3.5 h-3.5 rounded-full bg-muted-foreground/30 flex items-center justify-center text-white text-[8px] font-extrabold">–</span>
                              {t('followups.ungraded')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        <Card className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0">
          <CardContent className="p-3 md:p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shrink-0"><Users className="w-4 h-4 text-primary" /></div>
            <div className="min-w-0"><p className="text-lg font-bold text-foreground leading-tight">{summary.total}</p><p className="text-[11px] text-muted-foreground truncate">{t('followups.followedUpLeads')}</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0">
          <CardContent className="p-3 md:p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-destructive/15 to-destructive/5 flex items-center justify-center shrink-0 text-destructive font-bold text-xs">A</div>
            <div className="min-w-0"><p className="text-lg font-bold text-foreground leading-tight">{summary.gradeA}</p><p className="text-[11px] text-muted-foreground truncate">{t('leads.filter.gradePrefix')} A</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0">
          <CardContent className="p-3 md:p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-warning/15 to-warning/5 flex items-center justify-center shrink-0 text-warning font-bold text-xs">B</div>
            <div className="min-w-0"><p className="text-lg font-bold text-foreground leading-tight">{summary.gradeB}</p><p className="text-[11px] text-muted-foreground truncate">{t('leads.filter.gradePrefix')} B</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0">
          <CardContent className="p-3 md:p-3.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-muted to-muted/40 flex items-center justify-center shrink-0 text-muted-foreground font-bold text-xs">C</div>
            <div className="min-w-0"><p className="text-lg font-bold text-foreground leading-tight">{summary.gradeC}</p><p className="text-[11px] text-muted-foreground truncate">{t('leads.filter.gradePrefix')} C</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Period + Search & Filters */}
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardContent className="p-4 md:p-5 space-y-4">
          <div className="pb-4 border-b border-border/60">
            <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder={t('followups.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-11 rounded-lg bg-muted/40 border-transparent focus-visible:bg-card focus-visible:border-input transition-colors" />
              </div>

              {/* Desktop/tablet: compact always-visible Sort + Date, plus a
                  single Filters popover for the remaining category filters. */}
              <div className="hidden md:flex items-center gap-2 shrink-0">
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                  <SelectTrigger className="w-[150px] h-11 rounded-lg bg-muted/40 border-transparent"><ArrowUpDown className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder={t('leads.sortPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t('leads.sort.newest')}</SelectItem>
                    <SelectItem value="oldest">{t('leads.sort.oldest')}</SelectItem>
                    <SelectItem value="name">{t('leads.sort.name')}</SelectItem>
                    <SelectItem value="grade">{t('leads.sort.grade')}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0 shrink-0" aria-label={t('leads.previousDay')} onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), -1))}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Input type="date" value={dateFilter} max={todayStr()} onChange={(e) => setDateFilter(e.target.value)} className="h-9 w-[130px] text-sm border-0 bg-transparent shadow-none focus-visible:ring-0" />
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 min-h-0 shrink-0" aria-label={t('leads.nextDay')}
                    disabled={(dateFilter || todayStr()) >= todayStr()}
                    onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                {dateFilter && (
                  <Button variant="ghost" className="h-9 px-2.5 text-xs font-medium text-primary" onClick={() => setDateFilter('')}>
                    {t('leads.allDates')}
                  </Button>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-3.5 h-11 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      {t('leads.filters')}
                      {(deptFilter !== 'all' || statusFilter !== 'all' || projectFilters.length > 0 || teamFilter !== 'all' || agentFilter !== 'all') && (
                        <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                          {[deptFilter, statusFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length + (projectFilters.length > 0 ? 1 : 0)}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[380px] p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    <FollowUpFilterFields
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                      projectFilters={projectFilters} toggleProjectFilter={toggleProjectFilter} setProjectFilters={setProjectFilters}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      dateFilter={dateFilter} setDateFilter={setDateFilter}
                      sortBy={sortBy} setSortBy={setSortBy}
                      uniqueAgents={uniqueAgents} uniqueProjects={uniqueProjects} departments={departments} teamOptions={teamOptions}
                      showDept={!isDepartmentScoped(role)} showSortDate={false}
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
                    <span className="hidden sm:inline">{t('leads.filters')}</span>
                    {(deptFilter !== 'all' || statusFilter !== 'all' || projectFilters.length > 0 || teamFilter !== 'all' || agentFilter !== 'all' || dateFilter) && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[deptFilter, statusFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length + (projectFilters.length > 0 ? 1 : 0) + (dateFilter ? 1 : 0)}
                      </span>
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
                    <FollowUpFilterFields
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                      projectFilters={projectFilters} toggleProjectFilter={toggleProjectFilter} setProjectFilters={setProjectFilters}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      dateFilter={dateFilter} setDateFilter={setDateFilter}
                      sortBy={sortBy} setSortBy={setSortBy}
                      uniqueAgents={uniqueAgents} uniqueProjects={uniqueProjects} departments={departments} teamOptions={teamOptions}
                      showDept={!isDepartmentScoped(role)}
                    />
                    <SheetClose asChild>
                      <button type="button" className="w-full h-12 text-sm font-medium transition-colors rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80">
                        {t('common.done')}
                      </button>
                    </SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                ['dept', deptFilter, setDeptFilter, deptFilter !== 'all' ? getDepartmentLabel(deptFilter) : ''],
                ['status', statusFilter, setStatusFilter, statusFilter !== 'all' ? followUpStatusLabel(statusFilter, lang) : ''],
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

      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <ListChecks className="w-4 h-4 text-muted-foreground/80" />
            {t('nav.leads')}
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1 tabular-nums">{filteredRows.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5">
              <ListChecks className="w-9 h-9 mb-2 opacity-40" />
              <p className="text-sm font-medium">{t('followups.noLeadsMatchFilters')}</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/30">
                      <TableHead className={`${TH_STYLE} pl-5`}>{t('leads.customer')}</TableHead>
                      <TableHead className={TH_STYLE}>{t('leads.salesPerson')}</TableHead>
                      <TableHead className={TH_STYLE}>{t('followups.lastUpdate')}</TableHead>
                      <TableHead className={TH_STYLE}>{t('common.location')}</TableHead>
                      <TableHead className={TH_STYLE}>{t('addLead.budget')}</TableHead>
                      <TableHead className={TH_STYLE}>{t('addLead.grade')}</TableHead>
                      <TableHead className={TH_STYLE}>{t('followups.enquiry')}</TableHead>
                      <TableHead className={`${TH_STYLE} pr-5`}>{t('followups.followUpStatusCol')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedRows.map((row) => {
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
                                <p className="text-xs text-muted-foreground tabular-nums">{row.phone || t('leads.noPhone')}</p>
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
                                  {followUpStatusLabel(latest.status, lang)}
                                  {row.followUps.length > 1 && <span className="opacity-60">· {row.followUps.length}</span>}
                                </span>
                                {latest.notes && <p className="text-xs text-muted-foreground truncate" title={latest.notes}>{latest.notes}</p>}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
                                <HelpCircle className="w-3 h-3" /> {t('followups.noFollowUpYet')}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list — same pattern as the Leads page: a
                  colored left edge for at-a-glance status, avatar + name +
                  status pill up top, one muted line for phone/location, and
                  a compact chip row for grade/owner/history — instead of
                  five stacked full-width lines. */}
              <div className="md:hidden divide-y divide-border">
                {pagedRows.map((row) => {
                  const latest = row.followUps[0];
                  const date = latest?.created_at || row.created_at;
                  const accent = latest ? STATUS_ACCENT[latest.status] || 'border-l-border' : 'border-l-border';
                  const chipClass = 'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-muted/70 text-muted-foreground border-border shrink-0';
                  return (
                    <div
                      key={row.id}
                      role="button" tabIndex={0}
                      onClick={() => openLead(row)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openLead(row); }}
                      className={`w-full flex items-center gap-3 py-3 pl-3 pr-4 border-l-4 ${accent} text-left cursor-pointer active:bg-muted/50 transition-colors`}
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                        {initialsOf(row.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[15px] font-semibold text-foreground truncate">{row.name}</p>
                          {latest ? (
                            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[latest.status] || 'bg-muted text-muted-foreground border-border'}`}>
                              {followUpStatusLabel(latest.status, lang)}
                            </span>
                          ) : (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
                              <HelpCircle className="w-2.5 h-2.5" /> {t('stage.new')}
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                          {row.phone || t('leads.noPhone')}{row.current_location ? ` · ${row.current_location}` : ''}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <LeadLevelBadge grade={row.lead_grade} compact />
                          <span className={chipClass}><Calendar className="w-2.5 h-2.5" /> {new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                          {row.followUps.length > 1 && (
                            <span className={chipClass}>{row.followUps.length} {t('followups.callsSuffix')}</span>
                          )}
                          {row.owner_id ? (
                            <NameLink id={row.owner_id} name={nameOf(row.owner_id)} size="sm" showAvatar={false} className="text-[10px] text-muted-foreground" />
                          ) : (
                            <span className={chipClass}><User className="w-2.5 h-2.5" /> {t('followups.unassigned')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {sortedRows.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-t border-border/60 bg-muted/5">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {t('leads.showing')} <span className="font-medium text-foreground tabular-nums">{(page - 1) * pageSize + 1}</span>
                  –<span className="font-medium text-foreground tabular-nums">{Math.min(page * pageSize, sortedRows.length)}</span>
                  {' '}{t('leads.of')} <span className="font-medium text-foreground tabular-nums">{sortedRows.length}</span>
                </span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (<SelectItem key={n} value={String(n)}>{n} {t('leads.perPage')}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(1)} aria-label={t('leads.firstPage')}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('leads.previousPage')}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-xs font-medium text-foreground tabular-nums whitespace-nowrap">{t('leads.pageOf')} {page} / {totalPages}</span>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('leads.nextPage')}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8 min-h-0 rounded-lg" disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label={t('leads.lastPage')}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
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
                  {activeLead.owner_id ? <NameLink id={activeLead.owner_id} name={nameOf(activeLead.owner_id)} showAvatar={false} /> : <span className="flex items-center gap-1"><User className="w-3 h-3" />{t('followups.unassigned')}</span>}
                  {activeLead.budget_range && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{activeLead.budget_range}</span>}
                </div>
                <button type="button" onClick={() => navigate(`/lead/${activeLead.id}`)} className="w-fit -ml-2 flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-md px-2 py-1 transition-colors">
                  <Eye className="w-3.5 h-3.5" /> {t('followups.viewFullLead')}
                </button>
              </DialogHeader>

              <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
                {canFollowUpActive && (
                  <div className="rounded-xl border border-border p-3 space-y-3 bg-muted/20">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">{t('followups.addFollowUp')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={formType} onValueChange={setFormType}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>{FOLLOWUP_TYPES.map((ft) => (<SelectItem key={ft.value} value={ft.value}>{followUpTypeLabel(ft.value, lang)}</SelectItem>))}</SelectContent>
                      </Select>
                      <Select value={formStatus} onValueChange={setFormStatus}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>{FOLLOWUP_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{followUpStatusLabel(s.value, lang)}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <Textarea placeholder={t('followups.notesPlaceholder')} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="min-h-[70px]" />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{t('followups.outcomeGradeSets')}</span>
                      <LeadLevelBadge grade={getGradeForFollowUpStatus(formStatus as FollowUpStatus)} />
                    </div>
                    <Button onClick={handleAddFollowUp} disabled={saving} className="w-full sm:w-auto gap-2">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('followups.addFollowUp')}
                    </Button>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">{t('followups.history')} ({activeLead.followUps.length})</p>
                  {activeLead.followUps.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">{t('followups.noFollowUpsRecorded')}</p>
                  ) : (
                    <div className="space-y-3">
                      {activeLead.followUps.map((f) => (
                        <div key={f.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                          <div className="mt-0.5 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><MessageSquare className="w-4 h-4 text-primary" /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">{followUpTypeLabel(f.type, lang)}</span>
                              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[f.status] || 'bg-muted text-muted-foreground border-border'}`}>{followUpStatusLabel(f.status, lang)}</span>
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

function FollowUpFilterFields({
  deptFilter, setDeptFilter, statusFilter, setStatusFilter, projectFilters, toggleProjectFilter, setProjectFilters,
  teamFilter, setTeamFilter, agentFilter, setAgentFilter, dateFilter, setDateFilter, sortBy, setSortBy,
  uniqueAgents, uniqueProjects, departments, teamOptions, showDept = true, showSortDate = true,
}: any) {
  const { t, lang } = useTranslation();
  return (
    <>
      {showDept && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('leads.filter.department')}</label>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectDepartment')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('leads.filter.allDepartments')}</SelectItem>
              {departments.map((d: { code: string; name: string }) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('followups.followUpStatusCol')}</label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectStatus')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('leads.filter.allStatuses')}</SelectItem>
            {FOLLOWUP_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{followUpStatusLabel(s.value, lang)}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('leads.filter.project')}</label>
        <div className="max-h-48 overflow-y-auto rounded-md border border-input divide-y divide-border">
          {uniqueProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">{t('leads.filter.noProjectsYet')}</p>
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
            {t('leads.filter.clearProjects')}
          </button>
        )}
      </div>
      {teamOptions.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('leads.filter.team')}</label>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectTeam')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('leads.filter.allTeams')}</SelectItem>
              {teamOptions.map((tm: { id: string; name: string }) => (<SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('leads.filter.salesPerson')}</label>
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.filter.selectSalesPerson')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('leads.filter.allSalesPeople')}</SelectItem>
            {uniqueAgents.map((a: string) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      {showSortDate && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('leads.filter.sortBy')}</label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full h-12"><SelectValue placeholder={t('leads.sortPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t('leads.sort.newest')}</SelectItem>
                <SelectItem value="oldest">{t('leads.sort.oldest')}</SelectItem>
                <SelectItem value="name">{t('leads.sort.name')}</SelectItem>
                <SelectItem value="grade">{t('leads.sort.grade')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('leads.filter.dateAdded')}</label>
            <div className="flex items-center gap-1.5">
              <Button
                type="button" variant="outline" size="icon" className="h-12 w-12 min-h-0 shrink-0" aria-label={t('leads.previousDay')}
                onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), -1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Input type="date" value={dateFilter} max={todayStr()} onChange={(e) => setDateFilter(e.target.value)} className="w-full h-12 text-sm" />
              <Button
                type="button" variant="outline" size="icon" className="h-12 w-12 min-h-0 shrink-0" aria-label={t('leads.nextDay')}
                disabled={(dateFilter || todayStr()) >= todayStr()}
                onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {dateFilter && (
              <button type="button" onClick={() => setDateFilter('')} className="text-xs font-medium text-primary">
                {t('leads.filter.clearShowAllDates')}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
