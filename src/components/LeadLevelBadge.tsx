import React from 'react';

interface LeadLevelBadgeProps {
  level?: string;
  className?: string;
}

const LEVEL_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'Level A (Hot/Ready)': {
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    border: 'border-destructive/30',
    label: 'A',
  },
  'Level B (Warm/Considering)': {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/30',
    label: 'B',
  },
  'Level C (Cold/Inquiring)': {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    label: 'C',
  },
};

export default function LeadLevelBadge({ level, className = '' }: LeadLevelBadgeProps) {
  if (!level) return null;
  const style = LEVEL_STYLES[level] || {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    label: '?',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-current flex items-center justify-center text-white text-[8px] font-extrabold">
        {style.label}
      </span>
      {level}
    </span>
  );
}
