import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useProjectIndex } from '@/hooks/useProjectNames';
import { useProjectOptions } from '@/hooks/useProjectOptions';
import { canonicalProjectName, suggestProjects } from '@/lib/projectNames';
import type { EnquiryCategory } from '@/types';

/** The one Preferred project field — used by Add Enquiry, Add Lead and
 * Lead Detail, so the three behave identically and save the same data.
 * Matches the 120-character rule enforced on enquiries.preferred_project. */
export const PROJECT_NAME_MAX = 120;

/** How every form saves a preferred project: trimmed, single-spaced. */
export const normalizeProjectName = (value: string) => value.trim().replace(/\s+/g, ' ');

interface ProjectNameInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Narrows the curated list (Settings → Projects) to Condo or House & Land. */
  category?: EnquiryCategory | null;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

/** A text field for "preferred project" that suggests names as you type.
 * It stays free text — staff can name a brand-new project — but nudges
 * toward an existing spelling, which is what keeps the data from growing a
 * dozen spellings of "Dagon Landmark Residence".
 *
 * Suggestions, best first: the curated list from Settings → Projects, then
 * the canonical name of every project group leads already use, both
 * matched typo-tolerantly ("bahtoo" offers "Ba Htoo Gyi Condo"). Focusing
 * the empty field shows the curated list as quick picks. On blur, a value
 * that matches a known name ignoring case and spacing snaps to that
 * spelling. Full keyboard support (↑ ↓ Enter Esc) — Enter only picks a
 * highlighted suggestion, so it never submits the surrounding form by
 * accident. */
export default function ProjectNameInput({ value, onChange, category = null, placeholder, className, required }: ProjectNameInputProps) {
  const { index } = useProjectIndex();
  const { byCategory } = useProjectOptions();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const curated = useMemo(
    () => (category ? byCategory[category].active : Array.from(new Set([...byCategory.condo.active, ...byCategory.house_land.active]))),
    [byCategory, category],
  );
  const suggestions = useMemo(() => suggestProjects(value, curated, index.groups), [value, curated, index]);

  useEffect(() => { setActive(-1); }, [suggestions]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const pick = (name: string) => { onChange(name); setOpen(false); };

  /** Same project, different case or spacing → its known spelling. */
  const canonicalize = () => {
    const next = canonicalProjectName(value, curated, index.groups);
    if (next !== value) onChange(next);
  };

  const showList = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        maxLength={PROJECT_NAME_MAX}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={canonicalize}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); return; }
          if (!showList) { if (e.key === 'ArrowDown') setOpen(true); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(suggestions[active].name); }
        }}
        required={required}
        className={className}
        autoComplete="off"
      />
      {showList && (
        <div id={listId} role="listbox" className="absolute z-20 top-full left-0 right-0 mt-1.5 rounded-xl border border-border bg-card shadow-lg overflow-hidden py-1 max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s.name)}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors ${i === active ? 'bg-muted' : 'hover:bg-muted'}`}
            >
              <Building2 className={`w-3.5 h-3.5 shrink-0 ${s.curated ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="truncate text-foreground">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
