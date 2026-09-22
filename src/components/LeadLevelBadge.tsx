import type { LeadGrade } from '@/types';
import { useTranslation } from '@/contexts/TranslationContext';

interface LeadLevelBadgeProps {
  grade?: LeadGrade | null;
  className?: string;
  /** Just the letter chip + short word ("Hot"/"Warm"/"Cold") instead of the
   * full "Level A (Hot/Ready)" — for space-constrained UI like a mobile
   * list row, where the full label reads as noise rather than signal. */
  compact?: boolean;
}

const GRADE_STYLES: Record<LeadGrade, { bg: string; text: string; border: string; labelKey: string; shortKey: string }> = {
  A: { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/30', labelKey: 'grade.A.label', shortKey: 'grade.A.short' },
  B: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/30', labelKey: 'grade.B.label', shortKey: 'grade.B.short' },
  C: { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border', labelKey: 'grade.C.label', shortKey: 'grade.C.short' },
};

export default function LeadLevelBadge({ grade, className = '', compact = false }: LeadLevelBadgeProps) {
  const { t } = useTranslation();
  if (!grade) return null;
  const style = GRADE_STYLES[grade];
  if (!style) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${compact ? 'text-[9px]' : 'text-[10px]'} ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-current flex items-center justify-center text-white text-[8px] font-extrabold">
        {grade}
      </span>
      {t(compact ? style.shortKey : style.labelKey)}
    </span>
  );
}
