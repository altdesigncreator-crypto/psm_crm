import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Crown, Trophy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NameLink from '@/components/NameLink';
import { useProfiles } from '@/hooks/useProfiles';
import { useTranslation } from '@/contexts/TranslationContext';
import {
  buildKpis, rankAgents, rankValue, relativePeriodMatcher,
  type KpiLead, type KpiRankBy, type KpiTotals, type RelativePeriod,
} from '@/lib/kpi';
import { formatKyat, formatLakh, formatPercent } from '@/lib/sales';

/** How many agents the mini leaderboard lists; the KPI Board has the rest. */
const TOP_N = 5;

const PERIOD_LABEL_KEYS: Record<RelativePeriod, string> = {
  all: 'filter.allTime', thisMonth: 'filter.thisMonth', lastMonth: 'filter.lastMonth', thisYear: 'filter.thisYear',
};

const RANK_OPTIONS: { value: KpiRankBy; labelKey: string }[] = [
  { value: 'income', labelKey: 'kpiBoard.rankIncome' },
  { value: 'conversion', labelKey: 'kpiBoard.rankConversion' },
  { value: 'sold', labelKey: 'kpiBoard.rankSold' },
];

const RANK_CROWN_STYLES: Record<number, string> = {
  1: 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white',
  2: 'bg-gradient-to-br from-slate-300 to-slate-400 text-white',
  3: 'bg-gradient-to-br from-amber-600 to-amber-700 text-white',
};

function RankBadge({ rank }: { rank: number }) {
  const crownClass = RANK_CROWN_STYLES[rank];
  if (crownClass) {
    return (
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm ${crownClass}`}>
        <Crown className="w-3.5 h-3.5" fill="currentColor" strokeWidth={1.5} />
      </div>
    );
  }
  return <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{rank}</div>;
}

const conversionText = (k: KpiTotals) => (k.conversionRate == null ? '—' : formatPercent(k.conversionRate));

interface AgentKpiCardProps {
  /** Leads already loaded (and RLS-scoped) by the Dashboard. */
  leads: KpiLead[];
  /** Show the "View full KPI Board" link — the board is exec-only. */
  showKpiBoardLink: boolean;
}

/**
 * Dashboard's mini KPI leaderboard: period totals plus the top agents by
 * company income, conversion or deals. Uses the same buildKpis/rankAgents
 * as the KPI Board, so the two can never disagree on a number.
 */
export default function AgentKpiCard({ leads, showKpiBoardLink }: AgentKpiCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { nameOf, byId } = useProfiles();
  const [period, setPeriod] = useState<RelativePeriod>('thisMonth');
  const [rankBy, setRankBy] = useState<KpiRankBy>('income');

  const kpis = useMemo(() => buildKpis(leads, relativePeriodMatcher(period)), [leads, period]);
  const ranked = useMemo(
    () => rankAgents(kpis.agents, rankBy, (a) => nameOf(a.id)).slice(0, TOP_N),
    [kpis.agents, rankBy, nameOf]
  );

  const { totals } = kpis;
  const lakh = t('sale.lakhUnit');
  const money = (kyat: number) => `${formatLakh(kyat)} ${lakh}`;
  const barMax = ranked.length > 0 ? rankValue(ranked[0], rankBy) : 0;

  const summary: { label: string; value: string; title?: string }[] = [
    { label: t('kpiBoard.newLeads'), value: totals.leads.toLocaleString() },
    { label: t('kpiBoard.sold'), value: totals.sold.toLocaleString() },
    { label: t('kpiBoard.conversion'), value: conversionText(totals) },
    { label: t('kpiBoard.companyIncome'), value: money(totals.companyIncome), title: formatKyat(totals.companyIncome) },
  ];

  return (
    <Card className="shadow-card rounded-xl border-0">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Trophy className="w-4 h-4 text-primary" /></div>
            <h3 className="text-base font-semibold whitespace-nowrap">{t('analytics.agentPerformance')}</h3>
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as RelativePeriod)}>
            <SelectTrigger className="h-8 w-[124px] text-xs rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABEL_KEYS) as RelativePeriod[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">{t(PERIOD_LABEL_KEYS[k])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden bg-border mb-4">
          {summary.map((s) => (
            <div key={s.label} className="bg-muted/40 px-3 py-2.5 min-w-0">
              <dt className="text-[10px] font-medium text-muted-foreground truncate">{s.label}</dt>
              <dd className="text-sm font-bold text-foreground tabular-nums truncate" title={s.title}>{s.value}</dd>
            </div>
          ))}
        </dl>

        {ranked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Trophy className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">{t('dashboard.noAgentActivity')}</p>
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label={t('kpiBoard.rankBy')} className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30 mb-4">
              {RANK_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={rankBy === opt.value}
                  onClick={() => setRankBy(opt.value)}
                  className={`px-3 h-8 rounded-md text-xs font-semibold transition-colors ${rankBy === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>

            <ol className="space-y-4">
              {ranked.map((agent, idx) => {
                const pct = barMax > 0 ? Math.round((rankValue(agent, rankBy) / barMax) * 100) : 0;
                const headline = rankBy === 'income' ? money(agent.companyIncome) : rankBy === 'sold' ? `${agent.sold} ${t('kpiBoard.soldWord')}` : conversionText(agent);
                return (
                  <li key={agent.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <RankBadge rank={idx + 1} />
                        <NameLink id={agent.id} name={nameOf(agent.id)} avatarUrl={byId[agent.id]?.avatar_url || null} />
                      </div>
                      <span className="text-sm font-bold text-primary tabular-nums shrink-0" title={rankBy === 'income' ? formatKyat(agent.companyIncome) : undefined}>{headline}</span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden" aria-hidden="true">
                      <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #0463CA 0%, #0487E2 100%)' }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground tabular-nums truncate">
                      {agent.leads} {t('kpiBoard.leadsWord')} · {agent.sold} {t('kpiBoard.soldWord')} · {conversionText(agent)} · {money(agent.companyIncome)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {(totals.missingCommission > 0 || showKpiBoardLink) && (
          <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-border">
            <p className="text-[11px] text-warning tabular-nums min-w-0">
              {totals.missingCommission > 0 && `${totals.missingCommission.toLocaleString()} ${t('dashboard.salesMissingCommissionSuffix')}`}
            </p>
            {showKpiBoardLink && (
              <button type="button" onClick={() => navigate('/kpi-board')} className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline shrink-0">
                {t('dashboard.viewKpiBoard')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
