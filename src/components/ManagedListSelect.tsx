import React from 'react';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/contexts/TranslationContext';
import { CATEGORY_LABEL_KEYS, ENQUIRY_CATEGORIES, type ManagedList } from '@/hooks/useManagedList';
import { useEnquirySources } from '@/hooks/useEnquirySources';
import { NO_SOURCE } from '@/lib/projectInsights';
import { sourceKey, type SourceGroup } from '@/lib/sources';
import type { EnquiryCategory } from '@/types';

interface PickerProps {
  value: string;
  onChange: (v: string) => void;
  category: EnquiryCategory | null;
  disabled?: boolean;
  className?: string;
}

/** A form field picking one name from a managed list (useManagedList).
 *
 * `category` narrows to Condo or House & Land; null offers both, grouped.
 * Only active entries are offered, but a record's current value is always
 * kept selectable — even if it's since been hidden, renamed, or predates
 * the list — so opening a form never blanks the field and saving an
 * unrelated change never clears it. */
function ListPicker({ list, value, onChange, category, disabled, className, placeholder }: PickerProps & { list: ManagedList; placeholder: string }) {
  const { t } = useTranslation();
  const { byCategory } = list;

  // A name in both categories is listed once, under the first.
  const seen = new Set<string>();
  const groups = (category ? [category] : ENQUIRY_CATEGORIES).map((c) => ({
    key: c,
    label: t(CATEGORY_LABEL_KEYS[c]),
    names: byCategory[c].active.filter((s) => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    }),
  }));
  const unlisted = value && !seen.has(value) ? value : null;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-80">
        {unlisted && <SelectItem value={unlisted}>{unlisted}</SelectItem>}
        {groups.length === 1
          ? groups[0].names.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)
          : groups.map((g, i) => (
            <React.Fragment key={g.key}>
              {(i > 0 || unlisted) && <SelectSeparator />}
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">{g.label}</SelectLabel>
                {g.names.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectGroup>
            </React.Fragment>
          ))}
      </SelectContent>
    </Select>
  );
}

/** The source field on the Enquiry and Lead forms — both pick from the same
 * list (Settings → Lead sources), so a lead and the enquiry it came from
 * always speak the same vocabulary. (Preferred project is free text with
 * suggestions instead — see ProjectNameInput.) */
export function SourcePicker(props: PickerProps) {
  const { t } = useTranslation();
  return <ListPicker {...props} list={useEnquirySources()} placeholder={t('addLead.selectSource')} />;
}

/** The source filter on the Enquiries and Leads lists: the same groups
 * (see buildSourceGroups), keyed "<group>::<source>", with an optional
 * per-source count and a "No source recorded" option. */
export function SourceFilterSelect({ value, onChange, groups, allLabel, counts, includeNone = false, className }: {
  value: string; onChange: (v: string) => void; groups: SourceGroup[]; allLabel: string;
  counts?: Map<string, number>; includeNone?: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const count = (s: string) => (counts ? <span className="text-xs text-muted-foreground tabular-nums">{(counts.get(s) ?? 0).toLocaleString()}</span> : null);
  const item = (val: string, label: string, n: React.ReactNode) => (
    <SelectItem key={val} value={val}>
      <span className="flex items-center justify-between gap-3 w-full">
        <span className="truncate">{label}</span>{n}
      </span>
    </SelectItem>
  );

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder={t('addLead.selectSource')} /></SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value="all">{allLabel}</SelectItem>
        {groups.map((g) => (
          <React.Fragment key={g.key}>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">{g.label}</SelectLabel>
              {g.sources.map((s) => item(sourceKey(g.key, s), s, count(s)))}
            </SelectGroup>
          </React.Fragment>
        ))}
        {includeNone && (
          <>
            <SelectSeparator />
            {item(NO_SOURCE, t('leads.filter.noSource'), count(NO_SOURCE))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}
