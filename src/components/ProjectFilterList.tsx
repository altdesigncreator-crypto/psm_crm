import { useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '@/contexts/TranslationContext';
import { groupMatchesQuery, type ProjectGroup } from '@/lib/projectNames';
import { Search } from 'lucide-react';

interface ProjectFilterListProps {
  groups: ProjectGroup[];
  selected: string[];
  onToggle: (label: string) => void;
  onClear: () => void;
}

/** The "Project" section of every filter panel (Leads, Follow-Ups,
 * Pipeline). Lists *grouped* projects — one row for "Ba Htoo Gyi Condo"
 * instead of five spellings of it — with a lead count, and a search box
 * since the list runs to dozens of entries. Searching is typo-tolerant and
 * also matches any raw spelling inside a group. */
export default function ProjectFilterList({ groups, selected, onToggle, onClear }: ProjectFilterListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => groups.filter((g) => groupMatchesQuery(g, query)), [groups, query]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{t('leads.filter.project')}</label>
      {groups.length > 8 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('leads.filter.searchProjects')}
            className="w-full h-10 pl-8 pr-3 rounded-md border border-input bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto rounded-md border border-input divide-y divide-border">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3">{t('leads.filter.noProjectsYet')}</p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3">{t('leads.filter.noProjectMatch')}</p>
        ) : (
          visible.map((g) => (
            <label
              key={g.label}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer"
              title={g.variants.length > 1 ? g.variants.join('\n') : undefined}
            >
              <Checkbox checked={selected.includes(g.label)} onCheckedChange={() => onToggle(g.label)} />
              <span className="truncate flex-1">{g.label}</span>
              <span className="text-xs tabular-nums text-muted-foreground shrink-0">{g.count}</span>
            </label>
          ))
        )}
      </div>
      {selected.length > 0 && (
        <button type="button" onClick={onClear} className="text-xs font-medium text-primary">
          {t('leads.filter.clearProjects')}
        </button>
      )}
    </div>
  );
}
