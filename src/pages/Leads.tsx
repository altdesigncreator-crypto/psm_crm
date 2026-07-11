import React, { useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
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
import { MapPin, FileText, Search, Filter, Eye, Phone, Calendar, User as UserIcon, X, SlidersHorizontal, MoreVertical, PhoneCall, Navigation, Upload, Loader2, Download, FileSpreadsheet, FileCode } from 'lucide-react';
import { LEAD_STAGES, type Lead } from '@/types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isManagerOrAbove, getDepartmentLabel } from '@/lib/permissions';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import StatusBadge from '@/components/StatusBadge';
import LeadLevelBadge from '@/components/LeadLevelBadge';

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportAsCSV, exportAsExcel, exportAsPDF, exportAsHTML } from '@/lib/exportUtils';
import { toast } from 'sonner';

function stageLabel(status: string) {
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
}

export default function Leads() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();
  const [rawLeads, setRawLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionSheetLead, setActionSheetLead] = useState<Lead | null>(null);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
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

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const name = lead.name?.toLowerCase() || '';
      const agent = (lead.owner_name || '').toLowerCase();
      const q = searchQuery.toLowerCase();

      const matchesSearch = !searchQuery || name.includes(q) || lead.phone?.includes(searchQuery) || agent.includes(q);
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      const matchesProject = projectFilter === 'all' || lead.preferred_project === projectFilter;
      const matchesDept = deptFilter === 'all' || lead.department_code === deptFilter;
      const matchesAgent = agentFilter === 'all' || lead.owner_name === agentFilter;

      return matchesSearch && matchesStatus && matchesProject && matchesDept && matchesAgent;
    });
  }, [leads, searchQuery, statusFilter, projectFilter, deptFilter, agentFilter]);

  const openMap = (lead: Lead) => {
    setSelectedLead(lead);
    setMapOpen(true);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) {
        toast.error('No data found in the spreadsheet.');
        setImporting(false);
        return;
      }
      const headers: string[] = rows[0].map((h: any) => String(h).trim().toLowerCase());
      const findCol = (names: string[]) => {
        for (const n of names) {
          const idx = headers.findIndex((h) => h.includes(n));
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const nameIdx = findCol(['name', 'customer']);
      const phoneIdx = findCol(['phone', 'mobile', 'tel']);
      const emailIdx = findCol(['email', 'mail']);
      const projectIdx = findCol(['project', 'preferred']);
      const budgetIdx = findCol(['budget', 'price']);

      const rowsToInsert: Record<string, unknown>[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nameVal = nameIdx >= 0 ? String(row[nameIdx]).trim() : '';
        const phoneVal = phoneIdx >= 0 ? String(row[phoneIdx]).trim() : '';
        if (!nameVal && !phoneVal) continue;

        rowsToInsert.push({
          name: nameVal || 'Unknown',
          phone: phoneVal || '',
          email: emailIdx >= 0 ? String(row[emailIdx]).trim() || null : null,
          preferred_project: projectIdx >= 0 ? String(row[projectIdx]).trim() || null : null,
          budget_range: budgetIdx >= 0 ? String(row[budgetIdx]).trim() || null : null,
          status: 'new',
          department_code: department || 'house',
          owner_id: user.id,
          created_by: user.id,
        });
      }

      if (rowsToInsert.length === 0) {
        toast.error('No valid rows found to import.');
      } else {
        const { error } = await supabase.from('leads').insert(rowsToInsert);
        if (error) throw error;
        toast.success(`${rowsToInsert.length} leads imported.`);
      }
    } catch {
      toast.error('Import failed.');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Customer Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track all customer leads</p>
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
                    {(statusFilter !== 'all' || projectFilter !== 'all' || deptFilter !== 'all' || agentFilter !== 'all') && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[statusFilter, projectFilter, deptFilter, agentFilter].filter((f) => f !== 'all').length}
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
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      leads={leads} uniqueAgents={uniqueAgents} departments={departments}
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
        <CardHeader className="pb-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            All Leads
            <span className="text-xs font-normal text-muted-foreground ml-1">({filteredLeads.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto bg-card">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <FileText className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm font-medium">No leads found</p>
                <p className="text-xs mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              <>
                {/* Desktop/tablet table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Name</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Phone</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Project</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Budget</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Grade</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Status</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Sales Person</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Next Follow-up</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Location</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map((lead) => (
                        <TableRow key={lead.id} className="transition-colors duration-300 hover:bg-muted/50 cursor-pointer" onClick={() => navigate(`/lead/${lead.id}`)}>
                          <TableCell className="whitespace-nowrap text-sm font-medium">{lead.name}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.phone || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.preferred_project || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.budget_range || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap"><LeadLevelBadge grade={lead.lead_grade} /></TableCell>
                          <TableCell className="whitespace-nowrap"><StatusBadge status={stageLabel(lead.status)} color={statusColors?.[lead.status] || '#8FA3BF'} /></TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.owner_name || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleDateString() : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {lead.latitude && lead.longitude ? (
                              <button onClick={() => openMap(lead)} className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
                                <MapPin className="w-3.5 h-3.5" /> View map
                              </button>
                            ) : (<span className="text-xs text-muted-foreground">—</span>)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-primary hover:bg-primary/5 gap-1" onClick={() => navigate(`/lead/${lead.id}`)}>
                              <Eye className="w-3.5 h-3.5" />
                              <span className="text-xs font-medium">Details</span>
                            </Button>
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
                      <button type="button" onClick={() => navigate(`/lead/${lead.id}`)} className="flex-1 min-w-0 space-y-2 text-left">
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
                          {lead.owner_name && (<span className="flex items-center gap-1 text-xs text-muted-foreground"><UserIcon className="w-3 h-3" />{lead.owner_name}</span>)}
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
                      </button>
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
                <button type="button" onClick={() => setActionSheetLead(null)} className="w-full flex items-center justify-center px-4 py-3.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/50 active:bg-muted transition-colors border border-border">
                  Close
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterFields({ statusFilter, setStatusFilter, projectFilter, setProjectFilter, deptFilter, setDeptFilter, agentFilter, setAgentFilter, leads, uniqueAgents, departments }: any) {
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
