import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Sparkles, Smartphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/TranslationContext';
import { APP_BUILD, useAppUpdate, type UpdateStatus } from '@/lib/appUpdate';
import { applyUpdate, checkForUpdate } from '@/lib/serviceWorker';

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const STATUS_TONE: Partial<Record<UpdateStatus, string>> = {
  available: 'bg-primary/[0.07] border-primary/25',
  applying: 'bg-primary/[0.07] border-primary/25',
  'up-to-date': 'bg-success/[0.07] border-success/25',
  error: 'bg-destructive/[0.06] border-destructive/25',
};

/** Settings → About: current build, update status, and the manual
 * check / update / reload action. */
export default function AppUpdateCard() {
  const { t } = useTranslation();
  const { status, lastCheckedAt } = useAppUpdate();
  const now = useNow(30_000);

  const lastCheckedLabel = (() => {
    if (!lastCheckedAt) return null;
    const minutes = Math.floor((now - lastCheckedAt) / 60_000);
    if (minutes < 1) return t('update.justNow');
    if (minutes < 60) return `${minutes} ${t('update.minutesAgo')}`;
    return new Date(lastCheckedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();

  const builtAt = new Date(APP_BUILD.builtAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const statusRow = (() => {
    switch (status) {
      case 'available':
      case 'applying':
        return {
          Icon: status === 'applying' ? Loader2 : Sparkles, iconCls: `text-primary ${status === 'applying' ? 'animate-spin' : ''}`,
          title: t('update.availableTitle'), body: t('update.availableBody'),
        };
      case 'checking':
        return { Icon: Loader2, iconCls: 'text-muted-foreground animate-spin', title: t('update.checking') };
      case 'up-to-date':
        return { Icon: CheckCircle2, iconCls: 'text-success', title: t('update.upToDate') };
      case 'error':
        return { Icon: AlertCircle, iconCls: 'text-destructive', title: t('update.checkFailed') };
      case 'unsupported':
        return { Icon: AlertCircle, iconCls: 'text-muted-foreground', title: t('update.unsupported') };
      default:
        return { Icon: RefreshCw, iconCls: 'text-muted-foreground', title: t('update.autoCheckNote') };
    }
  })();

  return (
    <Card className="shadow-card rounded-xl border-0">
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('update.sectionTitle')}</p>
            <p className="text-xs text-muted-foreground tabular-nums truncate">
              PSM Properties CRM · {t('update.version')} {APP_BUILD.version}
            </p>
          </div>
        </div>

        <div
          role="status"
          aria-live="polite"
          className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${STATUS_TONE[status] ?? 'bg-muted/40 border-transparent'}`}
        >
          <statusRow.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${statusRow.iconCls}`} />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug text-foreground">{statusRow.title}</p>
            {statusRow.body && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{statusRow.body}</p>}
          </div>
        </div>

        {status === 'available' || status === 'applying' ? (
          <Button className="h-11 w-full gap-2" onClick={applyUpdate} disabled={status === 'applying'}>
            {status === 'applying' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {status === 'applying' ? t('update.updating') : t('update.updateNow')}
          </Button>
        ) : status === 'unsupported' ? (
          <Button variant="outline" className="h-11 w-full gap-2" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" /> {t('update.reloadApp')}
          </Button>
        ) : (
          <Button variant="outline" className="h-11 w-full gap-2" onClick={() => checkForUpdate()} disabled={status === 'checking'}>
            <RefreshCw className={`h-4 w-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
            {status === 'checking' ? t('update.checking') : t('update.checkForUpdates')}
          </Button>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-xs">
          <dt className="text-muted-foreground">{t('update.build')}</dt>
          <dd className="text-right font-mono text-foreground truncate">{APP_BUILD.buildId} · {builtAt}</dd>
          {lastCheckedLabel && (
            <>
              <dt className="text-muted-foreground">{t('update.lastChecked')}</dt>
              <dd className="text-right text-foreground">{lastCheckedLabel}</dd>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
