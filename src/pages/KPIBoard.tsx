import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useProfiles';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { hasPermission, getDepartmentLabel } from '@/lib/permissions';
import { exportKPIAsExcel, exportKPIAsPDF, type KpiExportReport } from '@/lib/exportUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import NameLink from '@/components/NameLink';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trophy, Users, Target, BarChart3, Eye, Building2, FileSpreadsheet, FileText,
  Handshake, Percent, Wallet, TrendingUp, AlertTriangle, RotateCw, UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePeriodFilter } from '@/hooks/usePeriodFilter';
import { useTeams } from '@/hooks/useTeams';
import PeriodFilterBar from '@/components/PeriodFilterBar';
import {
  buildKpis, fetchKpiLeads, makeTeamResolver, rankAgents, NO_TEAM,
  type KpiLead, type KpiRankBy, type KpiTotals,
} from '@/lib/kpi';
import { formatKyat, formatLakh, formatPercent } from '@/lib/sales';

const DEPT_PALETTE = [
  { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600 dark:text-amber-400' },
  { bg: 'bg-sky-50 dark:bg-sky-900/20', text: 'text-sky-600 dark:text-sky-400' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-600 dark:text-emerald-400' },
  { bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-600 dark:text-rose-400' },
];

const RANK_OPTIONS: { value: KpiRankBy; labelKey: string }[] = [
  { value: 'income', labelKey: 'kpiBoard.rankIncome' },
  { value: 'conversion', labelKey: 'kpiBoard.rankConversion' },
  { value: 'sold', labelKey: 'kpiBoard.rankSold' },
];

const conversionText = (k: KpiTotals) => (k.conversionRate == null ? '—' : formatPercent(k.conversionRate));

/** Effective commission across recorded deals, e.g. "2.0%". */
const avgCommissionText = (k: KpiTotals) => {
  // salesValue includes deals without a recorded commission; those can't
  // contribute to an average rate, so only show it when every deal has one.
  if (k.missingCommission > 0 || k.salesValue <= 0) return null;
  return formatPercent(k.companyIncome / k.salesValue);
};

export default function KPIBoard() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { nameOf } = useProfiles();
  const [leads, setLeads] = useState<KpiLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [commissionTracking, setCommissionTracking] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [rankBy, setRankBy] = useState<KpiRankBy>('income');
  const { teams, members, loading: teamsLoading } = useTeams();
  const { t } = useTranslation();
  usePageHeader(t('kpiBoard.pageTitle'), t('kpiBoard.subtitle'));

  const { period, setPeriod, isCurrentPeriod, shiftPeriod, periodLabel, matchesPeriod } = usePeriodFilter();
  const allowed = hasPermission(role, 'reports.kpi');

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    (async () => {
      try {
        const { rows, commissionTracking: tracking } = await fetchKpiLeads();
        if (!active) return;
        setLeads(rows);
        setCommissionTracking(tracking);
      } catch (e) {
        console.error('[KPI] Failed to load leads', e);
        if (!active) return;
        setLoadFailed(true);
        toast.error(t('kpiBoard.loadError'));
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [allowed, reloadKey]);

  const teamOf = useMemo(() => makeTeamResolver(teams, members), [teams, members]);
  const teamById = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);
  const teamName = (id: string) => (id === NO_TEAM ? t('kpiBoard.noTeam') : teamById.get(id)?.name ?? t('kpiBoard.unknownTeam'));

  const kpis = useMemo(
    () => buildKpis(leads, matchesPeriod, {
      department: deptFilter === 'all' ? null : deptFilter,
      team: teamFilter === 'all' ? null : teamFilter,
      teamOf,
    }),
    [leads, matchesPeriod, deptFilter, teamFilter, teamOf]
  );

  const rankedAgents = useMemo(
    () => rankAgents(kpis.agents, rankBy, (a) => nameOf(a.id)),
    [kpis.agents, rankBy, nameOf]
  );

  // Same ordering as agents; the unattributed "No team" bucket isn't a team
  // competing for rank, so it always sits last.
  const rankedTeams = useMemo(() => {
    const ranked = rankAgents(kpis.teams.filter((tm) => tm.teamId !== NO_TEAM), rankBy, (tm) => teamName(tm.teamId));
    const noTeam = kpis.teams.find((tm) => tm.teamId === NO_TEAM);
    return noTeam ? [...ranked, noTeam] : ranked;
  }, [kpis.teams, rankBy, teamById, t]);

  // A team filter outside the selected department would match nothing.
  const selectDepartment = (dept: string) => {
    setDeptFilter(dept);
    if (dept !== 'all' && teamFilter !== 'all' && teamFilter !== NO_TEAM && teamById.get(teamFilter)?.department_code !== dept) setTeamFilter('all');
  };

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">{t('kpiBoard.restricted')}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-4 h-4 mr-2" />{t('kpiBoard.backToDashboard')}</Button>
      </div>
    );
  }

  // Wait for teams too: before they load, every lead without a team_id
  // would briefly show under "No team".
  if (loading || teamsLoading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  // A failed load must never render as a board of zeros — that reads as
  // "no sales" when the truth is "no data".
  if (loadFailed) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-fade-in-up">
        <AlertTriangle className="w-10 h-10 mb-3 text-destructive opacity-70" />
        <p className="text-base font-medium text-foreground">{t('kpiBoard.loadError')}</p>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-4 h-4 mr-2" />{t('kpiBoard.backToDashboard')}</Button>
          <Button onClick={() => setReloadKey((k) => k + 1)}><RotateCw className="w-4 h-4 mr-2" />{t('kpiBoard.retry')}</Button>
        </div>
      </div>
    );
  }

  const { totals, departments } = kpis;
  const topAgent = rankedAgents[0];
  const lakh = t('sale.lakhUnit');
  const money = (kyat: number) => `${formatLakh(kyat)} ${lakh}`;

  const exportReport = (): KpiExportReport => ({
    title: [
      period === 'overall' ? t('period.overall') : periodLabel,
      deptFilter !== 'all' ? getDepartmentLabel(deptFilter) : null,
      teamFilter !== 'all' ? teamName(teamFilter) : null,
    ].filter(Boolean).join(' · '),
    agents: rankedAgents.map((a) => ({ name: nameOf(a.id), ...a })),
    teams: rankedTeams.map((tm) => ({ name: teamName(tm.teamId), ...tm })),
    departments: departments.map((d) => ({ name: getDepartmentLabel(d.department), ...d })),
  });
  const scopeLabel = [deptFilter !== 'all' ? getDepartmentLabel(deptFilter) : null, teamFilter !== 'all' ? teamName(teamFilter) : null].filter(Boolean).join(' · ');

  const summaryTiles: { key: string; icon: ReactNode; tone: string; label: string; value: string; title?: string; hint?: string | null }[] = [
    { key: 'leads', icon: <Users className="w-5 h-5 text-primary" />, tone: 'bg-primary/10', label: t('kpiBoard.newLeads'), value: totals.leads.toLocaleString() },
    { key: 'sold', icon: <Handshake className="w-5 h-5 text-success" />, tone: 'bg-success/10', label: t('kpiBoard.sold'), value: totals.sold.toLocaleString() },
    { key: 'conversion', icon: <Percent className="w-5 h-5 text-info" />, tone: 'bg-info/10', label: t('kpiBoard.conversion'), value: conversionText(totals), hint: t('kpiBoard.conversionHint') },
    { key: 'salesValue', icon: <TrendingUp className="w-5 h-5 text-warning" />, tone: 'bg-warning/10', label: t('kpiBoard.salesValue'), value: money(totals.salesValue), title: formatKyat(totals.salesValue) },
    {
      key: 'income', icon: <Wallet className="w-5 h-5 text-success" />, tone: 'bg-success/10', label: t('kpiBoard.companyIncome'), value: money(totals.companyIncome), title: formatKyat(totals.companyIncome),
      hint: avgCommissionText(totals) && `${t('kpiBoard.avgCommission')} ${avgCommissionText(totals)}`,
    },
  ];

  return (
    <div className="animate-fade-in-up space-y-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0 flex-1 md:hidden"><h1 className="text-xl md:text-2xl font-bold text-foreground">{t('kpiBoard.pageTitle')}</h1></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {topAgent && (topAgent.companyIncome > 0 || topAgent.sold > 0) && (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2 min-w-0">
              <Trophy className="w-4 h-4 text-warning shrink-0" />
              <span className="text-xs font-medium text-warning truncate">
                {t('kpiBoard.topPerformer')} — <NameLink id={topAgent.id} name={nameOf(topAgent.id)} showAvatar={false} className="text-warning" /> ({money(topAgent.companyIncome)})
              </span>
            </div>
          )}
          <Button variant="outline" size="sm" className="h-12 gap-2 text-sm font-medium active:bg-muted/30" onClick={() => exportKPIAsExcel(exportReport())} disabled={rankedAgents.length === 0}>
            <FileSpreadsheet className="w-5 h-5" /> Excel
          </Button>
          <Button variant="outline" size="sm" className="h-12 gap-2 text-sm font-medium active:bg-muted/30" onClick={() => exportKPIAsPDF(exportReport())} disabled={rankedAgents.length === 0}>
            <FileText className="w-5 h-5" /> PDF
          </Button>
        </div>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <PeriodFilterBar period={period} setPeriod={setPeriod} periodLabel={periodLabel} isCurrentPeriod={isCurrentPeriod} shiftPeriod={shiftPeriod} />
          {/* One ranking control for both leaderboards (teams + individuals). */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-muted-foreground">{t('kpiBoard.rankBy')}</span>
            <div role="radiogroup" aria-label={t('kpiBoard.rankBy')} className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
              {RANK_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={rankBy === opt.value}
                  onClick={() => setRankBy(opt.value)}
                  className={`px-3.5 h-9 rounded-md text-xs font-semibold transition-colors ${rankBy === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex md:grid md:grid-cols-3 xl:grid-cols-5 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        {summaryTiles.map((tile) => (
          <Card key={tile.key} className="shadow-card rounded-xl border-0 min-w-[170px] md:min-w-0 snap-start flex-1">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl ${tile.tone} flex items-center justify-center shrink-0`}>{tile.icon}</div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-foreground tabular-nums truncate" title={tile.title}>{tile.value}</p>
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                {tile.hint && <p className="text-[10px] text-muted-foreground/80 truncate">{tile.hint}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!commissionTracking && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-foreground flex-1">{t('kpiBoard.commissionTrackingOff')}</p>
        </div>
      )}

      {commissionTracking && totals.missingCommission > 0 && (
        <div role="status" className="flex items-start sm:items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5 sm:mt-0" />
          <p className="text-xs text-foreground flex-1">
            {[t('kpiBoard.missingCommissionPrefix'), totals.missingCommission.toLocaleString(), t('kpiBoard.missingCommissionSuffix')].filter(Boolean).join(' ')}
          </p>
          <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => navigate('/leads?status=sold')}>{t('kpiBoard.reviewSales')}</Button>
        </div>
      )}

      {departments.length > 0 && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-3"><CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-primary" /></div>{t('kpiBoard.departmentPerformance')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="flex md:grid md:grid-cols-3 gap-3 p-4 md:p-5 overflow-x-auto md:overflow-visible snap-x snap-mandatory">
              {departments.map((dept, idx) => {
                const palette = DEPT_PALETTE[idx % DEPT_PALETTE.length];
                const selected = deptFilter === dept.department;
                return (
                  <button key={dept.department} type="button" aria-pressed={selected} onClick={() => selectDepartment(selected ? 'all' : dept.department)} className={`text-left rounded-xl border p-4 min-w-[220px] md:min-w-0 snap-start flex-1 transition-all duration-200 hover:shadow-md active:scale-[0.99] ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted/40'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${palette.bg} ${palette.text}`}><Building2 className="w-4 h-4" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{getDepartmentLabel(dept.department)}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">{dept.agentCount} {t('kpiBoard.staff')}</p>
                      </div>
                      {selected && <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary text-white">{t('kpiBoard.filtered')}</span>}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div><p className="text-lg font-bold text-foreground tabular-nums">{dept.leads}</p><p className="text-[10px] text-muted-foreground">{t('kpiBoard.leads')}</p></div>
                      <div><p className="text-lg font-bold text-foreground tabular-nums">{dept.sold}</p><p className="text-[10px] text-muted-foreground">{t('kpiBoard.sold')}</p></div>
                      <div><p className="text-lg font-bold text-foreground tabular-nums">{conversionText(dept)}</p><p className="text-[10px] text-muted-foreground">{t('kpiBoard.conversion')}</p></div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border/60 flex items-baseline justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">{t('kpiBoard.companyIncome')}</span>
                      <span className="text-sm font-bold text-success tabular-nums truncate" title={formatKyat(dept.companyIncome)}>{money(dept.companyIncome)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {rankedTeams.length > 0 && (
        <Card className="shadow-card rounded-xl border-0">
          <CardHeader className="pb-3 space-y-1">
            <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><UsersRound className="w-4 h-4 text-primary" /></div>
              <span className="truncate">{t('kpiBoard.teamPerformance')}</span>
              {deptFilter !== 'all' && <span className="text-xs font-normal text-muted-foreground truncate">· {getDepartmentLabel(deptFilter)} {t('kpiBoard.onlySuffix')}</span>}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground pl-10">{t('kpiBoard.teamAttributionHint')}</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {rankedTeams.map((tm, idx) => {
                const team = teamById.get(tm.teamId);
                const isNoTeam = tm.teamId === NO_TEAM;
                const selected = teamFilter === tm.teamId;
                const subtitle = [
                  team?.manager_id ? `${t('teamManagement.manager')}: ${nameOf(team.manager_id)}` : null,
                  deptFilter === 'all' && team ? getDepartmentLabel(team.department_code) : null,
                  `${tm.agentCount} ${t('kpiBoard.staff')}`,
                ].filter(Boolean).join(' · ');
                return (
                  <button
                    key={tm.teamId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTeamFilter(selected ? 'all' : tm.teamId)}
                    className={`w-full text-left flex flex-col md:flex-row md:items-center gap-3 p-4 md:px-5 transition-colors ${selected ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'hover:bg-muted/30 active:bg-muted/50'}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 md:w-72 shrink-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isNoTeam ? 'bg-muted/50 text-muted-foreground' : idx === 0 ? 'bg-warning text-white' : 'bg-primary/10 text-primary'}`}>{isNoTeam ? '—' : idx + 1}</div>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate flex items-center gap-2 ${isNoTeam ? 'text-muted-foreground italic' : 'text-foreground'}`}>
                          <span className="truncate">{teamName(tm.teamId)}</span>
                          {team && !team.is_active && <span className="text-[10px] not-italic font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{t('profile.inactive')}</span>}
                          {selected && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary text-white shrink-0">{t('kpiBoard.filtered')}</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-4 gap-2">
                      <Metric label={t('kpiBoard.leads')} value={tm.leads.toLocaleString()} tone="primary" />
                      <Metric label={t('kpiBoard.sold')} value={tm.sold.toLocaleString()} tone="primary" highlighted={rankBy === 'sold'} />
                      <Metric label={t('kpiBoard.conversion')} value={conversionText(tm)} tone="warning" highlighted={rankBy === 'conversion'} />
                      <Metric label={t('kpiBoard.companyIncome')} value={money(tm.companyIncome)} title={formatKyat(tm.companyIncome)} tone="success" highlighted={rankBy === 'income'} />
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><BarChart3 className="w-4 h-4 text-primary" /></div>
            <span className="truncate">{t('kpiBoard.individualPerformance')}</span>
            {scopeLabel && <span className="text-xs font-normal text-muted-foreground truncate">· {scopeLabel} {t('kpiBoard.onlySuffix')}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rankedAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground"><Trophy className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm font-medium">{t('kpiBoard.noRecordsYet')}</p></div>
          ) : (
            <div className="divide-y divide-border">
              {rankedAgents.map((agent, idx) => (
                <div key={agent.id} className="flex flex-col md:flex-row md:items-center gap-3 p-4 md:p-5 min-h-[80px] transition-colors active:bg-muted/50 hover:bg-muted/30">
                  <div className="flex items-center gap-3 shrink-0 md:w-56">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${idx === 0 ? 'bg-warning text-white' : idx === 1 ? 'bg-muted text-foreground' : idx === 2 ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>{idx + 1}</div>
                    <div className="min-w-0 flex-1">
                      <NameLink id={agent.id} name={nameOf(agent.id)} showAvatar={false} className="text-sm font-semibold" />
                      <p className="text-xs text-muted-foreground tabular-nums">{agent.leads} {t('kpiBoard.leadsWord')} · {agent.sold} {t('kpiBoard.soldWord')}</p>
                    </div>
                    <button type="button" onClick={() => navigate(`/profile/${agent.id}`)} className="md:hidden w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all shrink-0" aria-label={t('kpiBoard.viewProfile')}><Eye className="w-4 h-4" /></button>
                  </div>

                  <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 md:gap-3">
                    <Metric label={t('kpiBoard.sold')} value={agent.sold.toLocaleString()} tone="primary" highlighted={rankBy === 'sold'} />
                    <Metric label={t('kpiBoard.salesValue')} value={money(agent.salesValue)} title={formatKyat(agent.salesValue)} tone="warning" />
                    <Metric label={t('kpiBoard.companyIncome')} value={money(agent.companyIncome)} title={formatKyat(agent.companyIncome)} tone="success" highlighted={rankBy === 'income'} />
                  </div>

                  <div className="shrink-0 w-full md:w-44">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span className={rankBy === 'conversion' ? 'font-semibold text-foreground' : ''}>{t('kpiBoard.conversion')}</span>
                      <span className="font-semibold text-foreground tabular-nums">{conversionText(agent)}</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full overflow-hidden bg-muted" role="progressbar" aria-label={t('kpiBoard.conversion')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={agent.conversionRate == null ? undefined : Math.round(agent.conversionRate * 100)}>
                      <div className="h-full bg-success rounded-full transition-all" style={{ width: `${Math.min(100, (agent.conversionRate ?? 0) * 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{t('kpiBoard.conversionHint')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const METRIC_TONES = {
  primary: { box: 'bg-primary/5', label: 'text-primary', ring: 'ring-primary/40' },
  warning: { box: 'bg-warning/5', label: 'text-warning', ring: 'ring-warning/40' },
  success: { box: 'bg-success/5', label: 'text-success', ring: 'ring-success/40' },
} as const;

function Metric({ label, value, title, tone, highlighted = false }: { label: string; value: string; title?: string; tone: keyof typeof METRIC_TONES; highlighted?: boolean }) {
  const s = METRIC_TONES[tone];
  return (
    <div className={`${s.box} rounded-lg p-2.5 text-center min-w-0 ${highlighted ? `ring-1 ${s.ring}` : ''}`}>
      <p className={`text-[11px] font-medium ${s.label} truncate`}>{label}</p>
      <p className="text-sm md:text-base font-bold text-foreground tabular-nums truncate" title={title}>{value}</p>
    </div>
  );
}
