import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { LEAD_STAGES, type Lead, type LeadStage } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import { useTeams } from '@/hooks/useTeams';
import { canEditLead, isDepartmentScoped, getDepartmentLabel } from '@/lib/permissions';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import NameLink from '@/components/NameLink';
import {
  Phone, MapPin, DollarSign, User, ArrowRight, ArrowLeft, Eye, MoveRight, Lock, Columns3,
  Search, Filter, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight, X, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { cacheGet, cacheSetDebounced } from '@/lib/localCache';
import { fetchAllRows } from '@/lib/fetchAllRows';

const PIPELINE_CACHE_TTL_MS = 5 * 60 * 1000;
const pipelineCacheKey = (userId: string) => `pipeline-leads:${userId}`;

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

interface PipelineColumn {
  status: LeadStage;
  label: string;
  leads: Lead[];
}

const ALL_STAGE_VALUES: LeadStage[] = LEAD_STAGES.map((s) => s.value);
const FORWARD_STAGE_VALUES: LeadStage[] = ALL_STAGE_VALUES.filter((s) => s !== 'lost');
const FALLBACK_COLOR = '#0463CA';

const getStageIndex = (status: string) => FORWARD_STAGE_VALUES.indexOf(status as LeadStage);
const canMoveForward = (status: string) => status !== 'sold' && getStageIndex(status) >= 0 && getStageIndex(status) < FORWARD_STAGE_VALUES.length - 1;
const canMoveBackward = (status: string) => status !== 'sold' && getStageIndex(status) > 0;
const getNextStatus = (status: string) => FORWARD_STAGE_VALUES[getStageIndex(status) + 1];
const getPrevStatus = (status: string) => FORWARD_STAGE_VALUES[getStageIndex(status) - 1];

export default function PipelineBoard() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();
  const { teams, membersOf } = useTeams();
  usePageHeader('Lead Pipeline', 'Stage-based lead tracking board');

  const cachedLeads = user ? cacheGet<Lead[]>(pipelineCacheKey(user.id), PIPELINE_CACHE_TTL_MS) : undefined;
  const [leads, setLeads] = useState<Lead[]>(cachedLeads ?? []);
  const [loading, setLoading] = useState(cachedLeads === undefined);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  const [hiddenStages, setHiddenStages] = useState<Set<LeadStage>>(new Set());
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [mobileStage, setMobileStage] = useState<LeadStage>(ALL_STAGE_VALUES[0]);

  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [deptFilter, setDeptFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    const writeCache = (list: Lead[]) => { cacheSetDebounced(pipelineCacheKey(user.id), list); return list; };
    const load = async () => {
      try {
        const rows = await fetchAllRows<Lead>('leads');
        if (!active) return;
        setLeads(writeCache(rows));
      } catch {
        if (active) toast.error('Could not load the pipeline.');
      }
      if (active) setLoading(false);
    };
    load();

    const channel = supabase
      .channel('pipeline-board')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setLeads((prev) => writeCache(prev.some((l) => l.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new as Lead;
        setLeads((prev) => writeCache(prev.map((l) => (l.id === row.id ? row : l))));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setLeads((prev) => writeCache(prev.filter((l) => l.id !== oldId)));
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  const currentUser = user ? { id: user.id, role, department } : null;

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

  const filteredLeads = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return leads.filter((lead) => {
      const agent = nameOf(lead.owner_id).toLowerCase();
      const matchesSearch = !searchQuery || lead.name?.toLowerCase().includes(q) || lead.phone?.includes(searchQuery) || agent.includes(q);
      const matchesProject = projectFilters.length === 0 || (!!lead.preferred_project && projectFilters.includes(lead.preferred_project));
      const matchesDept = deptFilter === 'all' || lead.department_code === deptFilter;
      const matchesTeam = teamFilter === 'all'
        || lead.team_id === teamFilter
        || (!!lead.owner_id && teamMemberIds.includes(lead.owner_id))
        || (!!lead.owner_id && lead.owner_id === teamManagerId);
      const matchesAgent = agentFilter === 'all' || nameOf(lead.owner_id) === agentFilter;
      const matchesDate = !dateFilter || localDateStr(lead.created_at) === dateFilter;
      return matchesSearch && matchesProject && matchesDept && matchesTeam && matchesAgent && matchesDate;
    });
  }, [leads, searchQuery, projectFilters, deptFilter, teamFilter, teamMemberIds, teamManagerId, agentFilter, dateFilter, nameOf]);

  const columns: PipelineColumn[] = useMemo(() => {
    return ALL_STAGE_VALUES.map((status) => ({
      status,
      label: LEAD_STAGES.find((s) => s.value === status)!.label,
      leads: filteredLeads.filter((l) => l.status === status),
    }));
  }, [filteredLeads]);

  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenStages.has(c.status)), [columns, hiddenStages]);

  const toggleStageVisibility = (status: LeadStage) => {
    setHiddenStages((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  useEffect(() => {
    if (hiddenStages.has(mobileStage) && visibleColumns.length > 0) {
      setMobileStage(visibleColumns[0].status);
    }
  }, [hiddenStages, visibleColumns, mobileStage]);

  const handleMoveLead = async (leadId: string, newStatus: string, currentStatus?: string) => {
    if (currentStatus === 'sold') {
      toast.error('This lead is Sold — its stage can no longer be changed.');
      return;
    }
    setMoving(true);
    const { error } = await supabase.from('leads').update({ status: newStatus }).eq('id', leadId);
    setMoving(false);
    if (error) {
      toast.error(error.message.includes('Sold') ? error.message : 'Could not update the lead stage.');
      return;
    }
    toast.success(`Lead moved to ${LEAD_STAGES.find((s) => s.value === newStatus)?.label}.`);
    setMoveDialogOpen(false);
    setSelectedLead(null);
  };

  const openMoveDialog = (lead: Lead) => { setSelectedLead(lead); setMoveDialogOpen(true); };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const mobileColumn = visibleColumns.find((c) => c.status === mobileStage) || visibleColumns[0];

  return (
    <div className="animate-fade-in-up space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="md:hidden min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground truncate">Lead Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Stage-based lead tracking board</p>
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2.5 py-1 rounded-full tabular-nums">{filteredLeads.length} leads</span>
          <Popover open={columnsMenuOpen} onOpenChange={setColumnsMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Columns3 className="w-3.5 h-3.5 text-muted-foreground" />
                Columns
                {hiddenStages.size > 0 && (
                  <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{hiddenStages.size}</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <p className="text-xs font-medium text-muted-foreground px-2 pt-1 pb-2">Show stages</p>
              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {columns.map((col) => {
                  const color = statusColors[col.status] || FALLBACK_COLOR;
                  return (
                    <label key={col.status} className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm cursor-pointer hover:bg-muted">
                      <Checkbox checked={!hiddenStages.has(col.status)} onCheckedChange={() => toggleStageVisibility(col.status)} />
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 truncate">{col.label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{col.leads.length}</span>
                    </label>
                  );
                })}
              </div>
              {hiddenStages.size > 0 && (
                <button
                  type="button"
                  onClick={() => setHiddenStages(new Set())}
                  className="w-full mt-1 h-8 rounded-md text-xs font-medium text-primary hover:bg-primary/5"
                >
                  Show all stages
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

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
                    {(projectFilters.length > 0 || deptFilter !== 'all' || teamFilter !== 'all' || agentFilter !== 'all' || dateFilter) && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[deptFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length + (projectFilters.length > 0 ? 1 : 0) + (dateFilter ? 1 : 0)}
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
                    <PipelineFilterFields
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      projectFilters={projectFilters} toggleProjectFilter={toggleProjectFilter} setProjectFilters={setProjectFilters}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      dateFilter={dateFilter} setDateFilter={setDateFilter}
                      uniqueAgents={uniqueAgents} uniqueProjects={uniqueProjects} departments={departments} teamOptions={teamOptions}
                      showDept={!isDepartmentScoped(role)}
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

            {/* Desktop / tablet inline filters */}
            <div className="hidden md:flex flex-wrap gap-3 shrink-0">
              {!isDepartmentScoped(role) && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[160px] h-11"><Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-11 w-[180px] items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <span className="flex items-center min-w-0">
                      <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground shrink-0" />
                      <span className={`truncate ${projectFilters.length === 0 ? 'text-muted-foreground' : ''}`}>
                        {projectFilters.length === 0 ? 'All projects' : projectFilters.length === 1 ? projectFilters[0] : `${projectFilters.length} projects`}
                      </span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-1" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
                  <DropdownMenuItem className="cursor-pointer" onSelect={(e) => { e.preventDefault(); setProjectFilters([]); }}>
                    All projects
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {uniqueProjects.map((p) => (
                    <DropdownMenuCheckboxItem key={p} checked={projectFilters.includes(p)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleProjectFilter(p)}>
                      {p}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {teamOptions.length > 0 && (
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger className="w-[160px] h-11"><Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Team" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {teamOptions.map((tm) => (<SelectItem key={tm.id} value={tm.id}>{tm.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[180px] h-11"><User className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Sales person" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sales people</SelectItem>
                  {uniqueAgents.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="outline" size="icon" className="h-11 w-11 min-h-0 shrink-0" aria-label="Previous day" onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), -1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Input type="date" value={dateFilter} max={todayStr()} onChange={(e) => setDateFilter(e.target.value)} className="h-11 w-[150px] text-sm" />
                </div>
                <Button
                  variant="outline" size="icon" className="h-11 w-11 min-h-0 shrink-0" aria-label="Next day"
                  disabled={(dateFilter || todayStr()) >= todayStr()}
                  onClick={() => setDateFilter(shiftDay(dateFilter || todayStr(), 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                {dateFilter && (
                  <Button variant="ghost" className="h-11 px-3 text-xs font-medium text-primary" onClick={() => setDateFilter('')}>
                    All dates
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 md:hidden">
              {[
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
              {projectFilters.map((p) => (
                <button
                  key={`project-${p}`}
                  type="button"
                  onClick={() => toggleProjectFilter(p)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                >
                  {p}
                  <X className="w-3 h-3" />
                </button>
              ))}
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter('')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                >
                  {dateFilter}
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {visibleColumns.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl bg-background/50">
          Every stage is hidden. Use "Columns" above to show at least one.
        </div>
      ) : (
        <>
          {/* Mobile: one stage at a time via a tab strip — stacking all 9
              columns made the page an enormous scroll on a small screen. */}
          <div className="md:hidden space-y-3">
            <div className="-mx-4 px-4 overflow-x-auto">
              <div className="flex items-center gap-2 w-max pb-1">
                {visibleColumns.map((col) => {
                  const color = statusColors[col.status] || FALLBACK_COLOR;
                  const active = mobileColumn?.status === col.status;
                  return (
                    <button
                      key={col.status}
                      type="button"
                      onClick={() => setMobileStage(col.status)}
                      className="flex items-center gap-1.5 h-10 px-3.5 rounded-full border text-sm font-medium shrink-0 transition-colors"
                      style={active
                        ? { backgroundColor: color, borderColor: color, color: '#fff' }
                        : { backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
                    >
                      {col.label}
                      <span
                        className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums"
                        style={active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: 'hsl(var(--muted))' }}
                      >
                        {col.leads.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5">
              {mobileColumn && mobileColumn.leads.length > 0 ? (
                mobileColumn.leads.map((lead) => (
                  <PipelineLeadCard
                    key={lead.id}
                    lead={lead}
                    editable={canEditLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code }) && lead.status !== 'sold'}
                    statusColors={statusColors}
                    nameOf={nameOf}
                    navigate={navigate}
                    openMoveDialog={openMoveDialog}
                    handleMoveLead={handleMoveLead}
                    moving={moving}
                  />
                ))
              ) : (
                <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl bg-background/50">
                  No leads in {mobileColumn?.label}
                </div>
              )}
            </div>
          </div>

          {/* Desktop / tablet: the full multi-column board. */}
          <div className="hidden md:grid gap-4 items-start" style={{ gridTemplateColumns: `repeat(${Math.min(visibleColumns.length, 4)}, minmax(0, 1fr))` }}>
            {visibleColumns.map((col) => {
              const columnColor = statusColors[col.status] || FALLBACK_COLOR;

              return (
                <div key={col.status} className="flex flex-col gap-3 bg-muted/30 p-3 rounded-2xl border border-border/40">
                  <div
                    className="flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200 shadow-sm"
                    style={{ borderColor: `${columnColor}40`, backgroundColor: `${columnColor}10` }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: columnColor }} />
                      <span className="text-sm font-semibold truncate" style={{ color: columnColor }}>{col.label}</span>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground bg-background px-2 py-0.5 rounded-full border shadow-sm shrink-0 tabular-nums">{col.leads.length}</span>
                  </div>

                  <div className="flex flex-col gap-2.5 max-h-[70vh] overflow-y-auto pr-0.5 custom-scrollbar">
                    {col.leads.map((lead) => (
                      <PipelineLeadCard
                        key={lead.id}
                        lead={lead}
                        editable={canEditLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code }) && lead.status !== 'sold'}
                        statusColors={statusColors}
                        nameOf={nameOf}
                        navigate={navigate}
                        openMoveDialog={openMoveDialog}
                        handleMoveLead={handleMoveLead}
                        moving={moving}
                      />
                    ))}

                    {col.leads.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl bg-background/50">
                        No leads
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Move Lead Stage</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Move <span className="font-semibold text-foreground">{selectedLead?.name}</span> to which stage?
            </p>
            <Select
              value={selectedLead?.status || ''}
              disabled={selectedLead?.status === 'sold'}
              onValueChange={(v) => { if (selectedLead && v !== selectedLead.status) handleMoveLead(selectedLead.id, v, selectedLead.status); }}
            >
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Select stage" /></SelectTrigger>
              <SelectContent className="rounded-xl">
                {LEAD_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[s.value] || '#8FA3BF' }} />
                      <span className="text-sm font-medium">{s.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PipelineLeadCard({
  lead, editable, statusColors, nameOf, navigate, openMoveDialog, handleMoveLead, moving,
}: {
  lead: Lead;
  editable: boolean;
  statusColors: Record<string, string>;
  nameOf: (id: string) => string;
  navigate: (path: string) => void;
  openMoveDialog: (lead: Lead) => void;
  handleMoveLead: (leadId: string, newStatus: string, currentStatus?: string) => void;
  moving: boolean;
}) {
  const nextStatus = getNextStatus(lead.status);
  const prevStatus = getPrevStatus(lead.status);
  const nextColor = statusColors[nextStatus] || FALLBACK_COLOR;

  return (
    <Card
      className="shadow-sm rounded-xl border border-border/60 hover:border-primary/30 hover:shadow-card transition-all duration-200 cursor-pointer active:scale-[0.99] bg-card"
      onClick={() => navigate(`/lead/${lead.id}`)}
    >
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{lead.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            {lead.status === 'sold' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20" title="Sold — stage is locked">
                <Lock className="w-2.5 h-2.5" /> Locked
              </span>
            )}
            <LeadLevelBadge grade={lead.lead_grade} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.phone}</span>
        </div>
        {lead.preferred_project && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.preferred_project}</span>
          </div>
        )}
        {lead.budget_range && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <DollarSign className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.budget_range}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="w-3 h-3 shrink-0" />
          {lead.owner_id ? <NameLink id={lead.owner_id} name={nameOf(lead.owner_id)} showAvatar={false} className="text-xs" /> : <span className="truncate">Unassigned</span>}
        </div>

        <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate(`/lead/${lead.id}`); }}
            className="flex-1 h-11 min-h-0 flex items-center justify-center gap-1.5 rounded-lg bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 active:bg-primary/15 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" /> View
          </button>
          {editable && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openMoveDialog(lead); }}
              className="flex-1 h-11 min-h-0 flex items-center justify-center gap-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 active:bg-muted/60 transition-colors"
            >
              <MoveRight className="w-3.5 h-3.5" /> Move
            </button>
          )}
        </div>

        {editable && (canMoveBackward(lead.status) || canMoveForward(lead.status)) && (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: canMoveBackward(lead.status) && canMoveForward(lead.status) ? '1fr 1fr' : '1fr' }}>
            {canMoveBackward(lead.status) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveLead(lead.id, prevStatus, lead.status); }}
                disabled={moving}
                className="h-9 min-h-0 px-2 rounded-md border border-border/60 text-xs text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
              >
                <ArrowLeft className="w-3 h-3 shrink-0" /> <span className="truncate">{LEAD_STAGES.find((s) => s.value === prevStatus)?.label}</span>
              </button>
            )}
            {canMoveForward(lead.status) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveLead(lead.id, nextStatus, lead.status); }}
                disabled={moving}
                className="h-9 min-h-0 px-2 rounded-md border text-xs flex items-center justify-center gap-1 transition-colors disabled:opacity-40"
                style={{ borderColor: `${nextColor}40`, color: nextColor, backgroundColor: `${nextColor}08` }}
              >
                <span className="truncate">{LEAD_STAGES.find((s) => s.value === nextStatus)?.label}</span> <ArrowRight className="w-3 h-3 shrink-0" />
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PipelineFilterFields({
  deptFilter, setDeptFilter, projectFilters, toggleProjectFilter, setProjectFilters,
  teamFilter, setTeamFilter, agentFilter, setAgentFilter, dateFilter, setDateFilter,
  uniqueAgents, uniqueProjects, departments, teamOptions, showDept = true,
}: any) {
  return (
    <>
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
  );
}
