import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Bell, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { isPushSupported, subscribeToPush } from '@/lib/pushNotifications';
import { useTranslation } from '@/contexts/TranslationContext';

// v2: bumped when notification permission was added to the primer, so
// devices that already dismissed the camera/location-only v1 prompt are
// asked again and get a chance to grant push notifications too. Camera and
// location requests were later dropped from this primer entirely — both
// still get requested by the OS at the moment they're actually used (photo
// capture, GPS tagging), just no longer pre-emptively up front.
const PRIMED_KEY = 'psm_permissions_primed_v2';

/** One-time onboarding dialog shown on the first use of the web app on this
 * device. It requests push notification access up front — from a button
 * tap, because iOS Safari and Android Chrome only show permission prompts
 * in response to a user gesture — so notifications don't stall on a
 * permission pop-up later. */
export default function PermissionPrimer() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(PRIMED_KEY)) setOpen(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(PRIMED_KEY, new Date().toISOString());
    setOpen(false);
  };

  const requestPermissions = async () => {
    setBusy(true);

    if (isPushSupported() && user?.id) {
      try {
        await subscribeToPush(user.id);
      } catch {
        toast.warning(t('permissionPrimer.notEnabledToast'));
      }
    }

    setBusy(false);
    dismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
        <DialogHeader>
          <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center mb-2 shadow-card">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <DialogTitle>{t('permissionPrimer.title')}</DialogTitle>
          <DialogDescription>
            {t('permissionPrimer.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t('settings.notifications')}</p>
              <p className="text-xs text-muted-foreground">{t('permissionPrimer.notificationsDesc')}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button onClick={requestPermissions} disabled={busy} className="w-full h-11 gradient-primary text-white">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {busy ? t('permissionPrimer.requesting') : t('permissionPrimer.allowAccess')}
          </Button>
          <Button variant="ghost" onClick={dismiss} disabled={busy} className="w-full h-11 text-muted-foreground">
            {t('permissionPrimer.notNow')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
