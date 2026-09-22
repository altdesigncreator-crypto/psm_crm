import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LEAD_STAGES, type Lead, type LeadStage } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { enumLabel } from '@/lib/translations';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { useDepartments } from '@/hooks/useDepartments';
import { useTeams } from '@/hooks/useTeams';
import { canEditLead, isDepartmentScoped, getDepartmentLabel } from '@/lib/permissions';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import {
  Phone, ArrowRight, MoveRight, Columns3,
  Search, Filter, SlidersHorizontal, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cacheGet, cacheSetDebounced } from '@/lib/localCache';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import PeriodFilterBar from '@/components/PeriodFilterBar';

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

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
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
const canMoveForward = (status: string) => getStageIndex(status) >= 0 && getStageIndex(status) < FORWARD_STAGE_VALUES.length - 1;
const getNextStatus = (status: string) => FORWARD_STAGE_VALUES[getStageIndex(status) + 1];

export default function PipelineBoard() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const { nameOf, profiles } = useProfiles();
  const { departments } = useDepartments();
  const { teams, membersOf } = useTeams();
  const { t, lang } = useTranslation();
  usePageHeader(t('pipeline.pageTitle'), t('pipeline.subtitle'));

  const cachedLeads = user ? cacheGet<Lead[]>(pipelineCacheKey(user.id), PIPELINE_CACHE_TTL_MS) : undefined;
  const [leads, setLeads] = useState<Lead[]>(cachedLeads ?? []);
  const [loading, setLoading] = useState(cachedLeads === undefined);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  const [hiddenStages, setHiddenStages] = useState<Set<LeadStage>>(new Set());
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [mobileStage, setMobileStage] = useState<LeadStage>(ALL_STAGE_VALUES[0]);

  // Fades at the edges of the mobile stage-tab strip so a scrollable row
  // of pills doesn't just look like "all the stages that fit," with the
  // rest silently cut off — same affordance browsers use for scrollable
  // tab bars.
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const [stageScrollEdges, setStageScrollEdges] = useState({ left: false, right: false });
  const updateStageScrollEdges = useCallback(() => {
    const el = stageScrollRef.current;
    if (!el) return;
    setStageScrollEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
    });
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [deptFilter, setDeptFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const { period, setPeriod, isCurrentPeriod, shiftPeriod, periodLabel, matchesPeriod } = usePeriodFilter();

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
        if (active) toast.error(t('pipeline.loadError'));
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
      const matchesPeriodFilter = matchesPeriod(lead.created_at);
      return matchesSearch && matchesProject && matchesDept && matchesTeam && matchesAgent && matchesDate && matchesPeriodFilter;
    });
  }, [leads, searchQuery, projectFilters, deptFilter, teamFilter, teamMemberIds, teamManagerId, agentFilter, dateFilter, matchesPeriod, nameOf]);

  const columns: PipelineColumn[] = useMemo(() => {
    return ALL_STAGE_VALUES.map((status) => ({
      status,
      label: enumLabel('stage', status, LEAD_STAGES.find((s) => s.value === status)!.label, lang),
      leads: filteredLeads.filter((l) => l.status === status),
    }));
  }, [filteredLeads, lang]);

  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenStages.has(c.status)), [columns, hiddenStages]);

  useEffect(() => {
    updateStageScrollEdges();
  }, [visibleColumns, updateStageScrollEdges]);

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

  const handleMoveLead = async (leadId: string, newStatus: string) => {
    setMoving(true);
    const { error } = await supabase.from('leads').update({ status: newStatus }).eq('id', leadId);
    setMoving(false);
    if (error) {
      toast.error(t('leadDetail.stageUpdateError'));
      return;
    }
    toast.success(`${t('pipeline.leadMovedToPrefix')} ${enumLabel('stage', newStatus, LEAD_STAGES.find((s) => s.value === newStatus)?.label || newStatus, lang)}${t('pipeline.leadMovedToSuffix') ? ' ' + t('pipeline.leadMovedToSuffix') : '.'}`);
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
          <h1 className="text-xl md:text-2xl font-semibold text-foreground truncate">{t('pipeline.pageTitle')}</h1>
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2.5 py-1 rounded-full tabular-nums">{filteredLeads.length} {t('pipeline.leadsSuffix')}</span>
          <Popover open={columnsMenuOpen} onOpenChange={setColumnsMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Columns3 className="w-3.5 h-3.5 text-muted-foreground" />
                {t('pipeline.columns')}
                {hiddenStages.size > 0 && (
                  <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{hiddenStages.size}</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <p className="text-xs font-medium text-muted-foreground px-2 pt-1 pb-2">{t('pipeline.showStages')}</p>
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
                  {t('pipeline.showAllStages')}
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Period + Search & Filters */}
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardContent className="p-3.5 md:p-5 space-y-3 md:space-y-4">
          <div className="pb-3 md:pb-4 border-b border-border/60">
            <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px] group">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <Input
                  placeholder={t('leads.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-9 h-12 rounded-full bg-muted/40 border border-transparent focus-visible:bg-card focus-visible:border-primary/30 focus-visible:ring-4 focus-visible:ring-primary/10 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label={t('pipeline.clearSearch')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Desktop/tablet: compact always-visible Date, plus a single
                  Filters popover for the remaining category filters. */}
              <div className="hidden md:flex items-center gap-2 shrink-0">
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
                      className="flex items-center gap-1.5 px-4 h-12 rounded-full border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      {t('leads.filters')}
                      {(projectFilters.length > 0 || deptFilter !== 'all' || teamFilter !== 'all' || agentFilter !== 'all') && (
                        <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                          {[deptFilter, teamFilter, agentFilter].filter((f) => f !== 'all').length + (projectFilters.length > 0 ? 1 : 0)}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[380px] p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    <PipelineFilterFields
                      deptFilter={deptFilter} setDeptFilter={setDeptFilter}
                      projectFilters={projectFilters} toggleProjectFilter={toggleProjectFilter} setProjectFilters={setProjectFilters}
                      teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                      agentFilter={agentFilter} setAgentFilter={setAgentFilter}
                      dateFilter={dateFilter} setDateFilter={setDateFilter}
                      uniqueAgents={uniqueAgents} uniqueProjects={uniqueProjects} departments={departments} teamOptions={teamOptions}
                      showDept={!isDepartmentScoped(role)} showDate={false}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Mobile: single Filters sheet with everything, including Date */}
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="md:hidden flex items-center gap-1.5 px-3.5 h-12 rounded-full border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('leads.filters')}</span>
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
                      <Filter className="w-4 h-4 text-primary" /> {t('leads.searchFilterSheetTitle')}
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

      {visibleColumns.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl bg-background/50">
          {t('pipeline.allStagesHidden')}
        </div>
      ) : (
        <>
          {/* Mobile: one stage at a time via a tab strip — stacking all 9
              columns made the page an enormous scroll on a small screen. */}
          <div className="md:hidden space-y-3">
            <div className="relative -mx-4">
              <div ref={stageScrollRef} onScroll={updateStageScrollEdges} className="px-4 overflow-x-auto">
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
              {stageScrollEdges.left && (
                <div className="absolute left-0 top-0 bottom-1 w-6 bg-gradient-to-r from-background to-transparent pointer-events-none" />
              )}
              {stageScrollEdges.right && (
                <div className="absolute right-0 top-0 bottom-1 w-6 bg-gradient-to-l from-background to-transparent pointer-events-none" />
              )}
            </div>

            <div className="space-y-2.5">
              {mobileColumn && mobileColumn.leads.length > 0 ? (
                mobileColumn.leads.map((lead) => (
                  <PipelineLeadCard
                    key={lead.id}
                    lead={lead}
                    editable={canEditLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code })}
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
                  {lang === 'mm' ? <>{mobileColumn?.label}{t('pipeline.noLeadsInStageSuffix')}</> : <>{t('pipeline.noLeadsInStagePrefix')} {mobileColumn?.label}</>}
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
                        editable={canEditLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code })}
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
                        {t('pipeline.noLeads')}
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
            <DialogTitle className="text-base font-semibold">{t('pipeline.moveLeadStage')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {lang === 'mm' ? (
                <><span className="font-semibold text-foreground">{selectedLead?.name}</span> {t('pipeline.moveToWhichStageSuffix')}</>
              ) : (
                <>{t('pipeline.moveToWhichStagePrefix')} <span className="font-semibold text-foreground">{selectedLead?.name}</span> {t('pipeline.moveToWhichStageSuffix')}</>
              )}
            </p>
            <Select
              value={selectedLead?.status || ''}
              onValueChange={(v) => { if (selectedLead && v !== selectedLead.status) handleMoveLead(selectedLead.id, v); }}
            >
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder={t('pipeline.selectStage')} /></SelectTrigger>
              <SelectContent className="rounded-xl">
                {LEAD_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[s.value] || '#8FA3BF' }} />
                      <span className="text-sm font-medium">{enumLabel('stage', s.value, s.label, lang)}</span>
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
  handleMoveLead: (leadId: string, newStatus: string) => void;
  moving: boolean;
}) {
  const { t, lang } = useTranslation();
  const nextStatus = getNextStatus(lead.status);
  const nextColor = statusColors[nextStatus] || FALLBACK_COLOR;
  const accentColor = statusColors[lead.status] || FALLBACK_COLOR;
  const ownerName = lead.owner_id ? nameOf(lead.owner_id) : null;
  const metaLine = [lead.preferred_project, lead.budget_range, ownerName || (lead.owner_id ? null : t('leadDetail.unassigned'))].filter(Boolean).join(' · ');

  return (
    <Card
      className="shadow-sm rounded-xl border border-l-4 border-border/60 hover:border-primary/30 hover:shadow-card transition-all duration-200 cursor-pointer active:scale-[0.99] bg-card"
      style={{ borderLeftColor: accentColor }}
      onClick={() => navigate(`/lead/${lead.id}`)}
    >
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0">
            {initialsOf(lead.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground truncate">{lead.name}</span>
              <LeadLevelBadge grade={lead.lead_grade} compact />
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.phone || t('leads.noPhone')}</span>
            </div>
          </div>
        </div>
        {metaLine && <p className="text-[11px] text-muted-foreground truncate pl-[42px]">{metaLine}</p>}

        {editable && (
          <div className="flex items-center gap-1.5 pt-1.5 mt-1 border-t border-border/40">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openMoveDialog(lead); }}
              aria-label={t('pipeline.moveToStage')}
              title={t('pipeline.moveToStage')}
              className="w-9 h-9 min-h-0 shrink-0 flex items-center justify-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 active:bg-muted/60 transition-colors"
            >
              <MoveRight className="w-4 h-4" />
            </button>
            {canMoveForward(lead.status) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveLead(lead.id, nextStatus); }}
                disabled={moving}
                className="flex-1 h-9 min-h-0 px-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 transition-colors disabled:opacity-40"
                style={{ borderColor: `${nextColor}40`, color: nextColor, backgroundColor: `${nextColor}08` }}
              >
                <span className="truncate">{enumLabel('stage', nextStatus, LEAD_STAGES.find((s) => s.value === nextStatus)?.label || nextStatus, lang)}</span> <ArrowRight className="w-3 h-3 shrink-0" />
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
  uniqueAgents, uniqueProjects, departments, teamOptions, showDept = true, showDate = true,
}: any) {
  const { t } = useTranslation();
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
      {showDate && (
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
      )}
    </>
  );
}
