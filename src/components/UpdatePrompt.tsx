import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useAppUpdate } from '@/lib/appUpdate';
import { applyUpdate } from '@/lib/serviceWorker';
import { useTranslation } from '@/contexts/TranslationContext';

/** Floating "Update available" banner. State comes from the shared
 * app-update store (see src/lib/serviceWorker.ts for the lifecycle).
 *
 * "Later" hides the banner for the rest of this session only — the red dot
 * on Settings stays, so the update is never lost, and the banner comes back
 * on the next launch if the user still hasn't updated. It's also hidden on
 * /settings itself, where the About section shows the same action inline. */
export default function UpdatePrompt() {
  const { status } = useAppUpdate();
  const { t } = useTranslation();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);

  const applying = status === 'applying';
  const visible = (status === 'available' && !dismissed) || applying;
  if (!visible || (location.pathname === '/settings' && !applying)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[60] px-3 md:inset-x-auto md:right-6 md:bottom-6 md:px-0 md:w-[400px] bottom-[calc(max(env(safe-area-inset-bottom),10px)+88px)] animate-fade-in-up"
    >
      <div className="mx-auto max-w-md rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl shadow-elevated p-3.5 md:p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {applying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-foreground">{t('update.availableTitle')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t('update.availableBody')}</p>
          </div>
          {!applying && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('update.later')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {!applying && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="h-9 rounded-lg px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t('update.later')}
            </button>
          )}
          <button
            type="button"
            onClick={applyUpdate}
            disabled={applying}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-95 disabled:opacity-70"
          >
            {applying ? t('update.updating') : t('update.updateNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
