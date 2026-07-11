import React from 'react';
import type { LeadGrade } from '@/types';

interface LeadLevelBadgeProps {
  grade?: LeadGrade | null;
  className?: string;
}

const GRADE_STYLES: Record<LeadGrade, { bg: string; text: string; border: string; label: string }> = {
  A: { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/30', label: 'Level A (Hot/Ready)' },
  B: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/30', label: 'Level B (Warm/Considering)' },
  C: { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border', label: 'Level C (Cold/Inquiring)' },
};

export default function LeadLevelBadge({ grade, className = '' }: LeadLevelBadgeProps) {
  if (!grade) return null;
  const style = GRADE_STYLES[grade];
  if (!style) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-current flex items-center justify-center text-white text-[8px] font-extrabold">
        {grade}
      </span>
      {style.label}
    </span>
  );
}
