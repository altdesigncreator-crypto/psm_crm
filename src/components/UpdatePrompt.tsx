import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { skipWaitingUpdate } from '@/lib/serviceWorker';

/** The service worker (src/lib/serviceWorker.ts) dispatches
 * `sw-update-available` as soon as a new deploy finishes installing in the
 * background — but until now nothing listened for it, so an already-open
 * tab just kept running the old cached bundle forever with no way to know a
 * new one existed. This surfaces that moment and reloads once the new
 * worker actually takes control, instead of leaving people stuck on stale
 * code indefinitely. */
export default function UpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onUpdateAvailable = () => setVisible(true);
    window.addEventListener('sw-update-available', onUpdateAvailable);
    return () => window.removeEventListener('sw-update-available', onUpdateAvailable);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const handleRefresh = async () => {
    setUpdating(true);
    await skipWaitingUpdate();
    // Fallback in case this browser never fires controllerchange for some
    // reason — don't leave the button spinning forever.
    setTimeout(() => window.location.reload(), 2000);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-[60] px-4 animate-fade-in-up">
      <div className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-elevated p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <RefreshCw className={`w-5 h-5 text-primary ${updating ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">A new version is available</p>
          <p className="text-xs text-muted-foreground mt-0.5">Refresh to get the latest updates and fixes.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={updating}
          className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:scale-95 transition-transform disabled:opacity-60 shrink-0"
        >
          {updating ? 'Updating…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
