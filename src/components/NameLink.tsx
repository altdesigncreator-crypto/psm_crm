import React from 'react';
import { Link } from 'react-router-dom';

function initialsOf(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

const SIZE_STYLES = {
  sm: { circle: 'w-7 h-7 text-[10px]', text: 'text-xs' },
  md: { circle: 'w-9 h-9 text-xs', text: 'text-sm' },
  lg: { circle: 'w-14 h-14 text-base', text: 'text-base' },
} as const;

interface NameLinkProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  showAvatar?: boolean;
  size?: keyof typeof SIZE_STYLES;
  className?: string;
}

/** Click a person's name/avatar anywhere in the app to open their full
 * profile (src/pages/Profile.tsx) — the CRM-wide "click a name" pattern.
 * Visually matches the inline initials-circle every page already hand-rolls
 * so this is a drop-in swap, not a new look. Most call sites are nested
 * inside a row/card with its own onClick (navigates elsewhere) — stopping
 * propagation here keeps those two navigations from fighting. */
export default function NameLink({ id, name, avatarUrl, showAvatar = true, size = 'md', className = '' }: NameLinkProps) {
  const sizeStyle = SIZE_STYLES[size];
  return (
    <Link
      to={`/profile/${id}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-2 min-w-0 hover:underline underline-offset-2 ${className}`}
    >
      {showAvatar && (
        avatarUrl ? (
          <img src={avatarUrl} alt={name} className={`shrink-0 rounded-full object-cover ${sizeStyle.circle}`} />
        ) : (
          <span className={`shrink-0 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center ${sizeStyle.circle}`}>
            {initialsOf(name)}
          </span>
        )
      )}
      <span className={`truncate font-medium text-foreground ${sizeStyle.text}`}>{name}</span>
    </Link>
  );
}
