import { ArrowRight, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/contexts/TranslationContext';
import type { PermissionChange } from '@/lib/permissions';

/** "View leads: Team → Department" rows for confirmation dialogs — the one
 * place permission changes are described, so Role Management and Staff
 * management always read the same way. */
export default function AccessChangeList({ changes }: { changes: PermissionChange[] }) {
  const { t } = useTranslation();
  const scopeLabel = (s: string | null) => t(`roleManagement.scope.${s ?? 'off'}`);

  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border">
      {changes.map(({ permission, from, to, widens }) => {
        const yesNo = permission.scopes.length === 1;
        return (
          <li key={permission.key} className="flex items-center gap-2.5 px-3 py-2">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${widens ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive'}`}
              aria-label={widens ? t('access.change.gains') : t('access.change.loses')}
            >
              {widens ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t(`perm.${permission.key}`)}</span>
            {!yesNo && (
              <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                <span className={from ? '' : 'opacity-60'}>{scopeLabel(from)}</span>
                <ArrowRight className="h-3 w-3" />
                <span className="font-medium text-foreground">{scopeLabel(to)}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
