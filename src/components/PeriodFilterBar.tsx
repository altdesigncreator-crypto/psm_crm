import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Period } from '@/hooks/usePeriodFilter';
import { useTranslation } from '@/contexts/TranslationContext';

const PERIOD_LABEL_KEYS: Record<'monthly' | 'yearly' | 'overall', string> = {
  monthly: 'period.monthly', yearly: 'period.yearly', overall: 'period.overall',
};

interface PeriodFilterBarProps {
  period: Period;
  setPeriod: (p: Period) => void;
  periodLabel: string;
  isCurrentPeriod: boolean;
  shiftPeriod: (delta: number) => void;
  className?: string;
}

export default function PeriodFilterBar({ period, setPeriod, periodLabel, isCurrentPeriod, shiftPeriod, className }: PeriodFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className || ''}`}>
      <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30 shrink-0">
        {(['monthly', 'yearly', 'overall'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`px-3.5 h-9 rounded-md text-xs font-semibold transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t(PERIOD_LABEL_KEYS[p])}
          </button>
        ))}
      </div>
      {period !== 'overall' && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9 min-h-0" aria-label={t('periodFilterBar.previousPeriod')} onClick={() => shiftPeriod(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums px-1.5 min-w-[110px] text-center">{periodLabel}</span>
          <Button variant="outline" size="icon" className="h-9 w-9 min-h-0" aria-label={t('periodFilterBar.nextPeriod')} disabled={isCurrentPeriod} onClick={() => shiftPeriod(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
