import React from 'react';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  color: string;
  className?: string;
}

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function StatusBadge({ status, color, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-3 py-0.5 text-xs font-medium border transition-colors duration-200',
        className
      )}
      style={{
        backgroundColor: hexToRgba(color, 0.12),
        color: color,
        borderColor: hexToRgba(color, 0.25),
      }}
    >
      {status}
    </span>
  );
}
