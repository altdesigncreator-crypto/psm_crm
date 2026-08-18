import { useCallback, useState } from 'react';

export type Period = 'monthly' | 'yearly' | 'overall';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface PeriodFilterInit {
  period?: Period;
  selectedMonth?: number;
  selectedYear?: number;
}

export function usePeriodFilter(init?: PeriodFilterInit) {
  const now = new Date();
  const [period, setPeriod] = useState<Period>(init?.period ?? 'monthly');
  const [selectedMonth, setSelectedMonth] = useState(init?.selectedMonth ?? now.getMonth());
  const [selectedYear, setSelectedYear] = useState(init?.selectedYear ?? now.getFullYear());

  const isCurrentPeriod = period === 'overall'
    ? true
    : period === 'yearly'
      ? selectedYear === now.getFullYear()
      : selectedYear === now.getFullYear() && selectedMonth === now.getMonth();

  const shiftPeriod = (delta: number) => {
    if (period === 'yearly') { setSelectedYear((y) => y + delta); return; }
    let m = selectedMonth + delta;
    let y = selectedYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setSelectedMonth(m);
    setSelectedYear(y);
  };

  const periodLabel = period === 'yearly' ? String(selectedYear) : `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;

  const matchesPeriod = useCallback((dateStr: string) => {
    if (period === 'overall') return true;
    const d = new Date(dateStr);
    if (period === 'yearly') return d.getFullYear() === selectedYear;
    return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth;
  }, [period, selectedMonth, selectedYear]);

  /** ISO [gte, lt) bounds for the selected period — null for "overall"
   * (no bound needed), for pushing the period straight into a Supabase
   * query instead of filtering an already-loaded array. */
  const periodRange = useCallback((): { gte: string; lt: string } | null => {
    if (period === 'overall') return null;
    if (period === 'yearly') {
      return { gte: new Date(selectedYear, 0, 1).toISOString(), lt: new Date(selectedYear + 1, 0, 1).toISOString() };
    }
    const nextMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
    const nextYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
    return { gte: new Date(selectedYear, selectedMonth, 1).toISOString(), lt: new Date(nextYear, nextMonth, 1).toISOString() };
  }, [period, selectedMonth, selectedYear]);

  return {
    period, setPeriod, selectedMonth, selectedYear, isCurrentPeriod, shiftPeriod,
    periodLabel, matchesPeriod, periodRange,
  };
}
