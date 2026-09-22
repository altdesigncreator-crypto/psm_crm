import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useProjectNames } from '@/hooks/useProjectNames';
import { Building2 } from 'lucide-react';

interface ProjectNameInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

/** A plain text field for "preferred project" that suggests existing
 * project names as you type — the field has no fixed list behind it (sales
 * staff can name a brand-new project), so this nudges toward reusing an
 * existing spelling without forcing it, which is exactly what caused the
 * database to end up with a dozen spellings of "Dagon Landmark Residence"
 * in the first place. */
export default function ProjectNameInput({ value, onChange, placeholder, className, required }: ProjectNameInputProps) {
  const { projectNames } = useProjectNames();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return [];
    return projectNames
      .filter((name) => name.toLowerCase().includes(query) && name.toLowerCase() !== query)
      .slice(0, 6);
  }, [value, projectNames]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        required={required}
        className={className}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1.5 rounded-xl border border-border bg-card shadow-lg overflow-hidden py-1">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(name); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left hover:bg-muted transition-colors"
            >
              <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-foreground">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
