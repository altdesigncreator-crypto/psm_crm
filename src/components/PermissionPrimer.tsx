import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Camera, MapPin, Bell, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { isPushSupported, subscribeToPush } from '@/lib/pushNotifications';

// v2: bumped when notification permission was added to the primer, so
// devices that already dismissed the camera/location-only v1 prompt are
// asked again and get a chance to grant push notifications too.
const PRIMED_KEY = 'psm_permissions_primed_v2';

/** One-time onboarding dialog shown on the first use of the web app on this
 * device. It requests camera, location, and push notification access up
 * front — from a button tap, because iOS Safari and Android Chrome only show
 * permission prompts in response to a user gesture — so later photo
 * uploads, GPS tagging, and push notifications don't stall on permission
 * pop-ups in the middle of the flow. */
export default function PermissionPrimer() {
  const { user } = useAuth();
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.warning('Camera access was not granted. You can still upload photos from your gallery.');
    }

    // Location: a one-shot position read triggers the GPS permission prompt.
    await new Promise<void>((resolve) => {
      if (!navigator.geolocation) { resolve(); return; }
      navigator.geolocation.getCurrentPosition(
        () => resolve(),
        () => {
          toast.warning('Location access was not granted. GPS tagging will not work until you allow it.');
          resolve();
        },
        { timeout: 15000, maximumAge: 60000 }
      );
    });

    if (isPushSupported() && user?.id) {
      try {
        await subscribeToPush(user.id);
      } catch {
        toast.warning('Notifications were not enabled. You can turn them on later in Settings.');
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
          <DialogTitle>Allow Camera, Location & Notifications</DialogTitle>
          <DialogDescription>
            PSM Sale CRM uses your phone camera and GPS location for lead photos
            and location tagging, and sends push notifications for follow-up
            reminders and announcements. Granting access now means no
            interruptions later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Camera</p>
              <p className="text-xs text-muted-foreground">Take photos with your phone camera</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Location</p>
              <p className="text-xs text-muted-foreground">Tag leads with your GPS position</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Notifications</p>
              <p className="text-xs text-muted-foreground">Get follow-up reminders and announcements</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button onClick={requestPermissions} disabled={busy} className="w-full h-11 gradient-primary text-white">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {busy ? 'Requesting…' : 'Allow Access'}
          </Button>
          <Button variant="ghost" onClick={dismiss} disabled={busy} className="w-full h-11 text-muted-foreground">
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
