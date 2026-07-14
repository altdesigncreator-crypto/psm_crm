import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Camera, MapPin, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const PRIMED_KEY = 'psm_permissions_primed';

/** One-time onboarding dialog shown on the first use of the web app on this
 * device. It requests camera and location access up front — from a button
 * tap, because iOS Safari and Android Chrome only show permission prompts in
 * response to a user gesture — so later check-ins don't stall on permission
 * pop-ups in the middle of the flow. */
export default function PermissionPrimer() {
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

    // Camera: open a throwaway stream just to trigger the permission prompt,
    // then stop it immediately — the check-in flow uses the native camera app.
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
          toast.warning('Location access was not granted. GPS check-ins will not work until you allow it.');
          resolve();
        },
        { timeout: 15000, maximumAge: 60000 }
      );
    });

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
          <DialogTitle>Allow Camera & Location</DialogTitle>
          <DialogDescription>
            PSM Sale CRM uses your phone camera and GPS location for daily field
            check-ins. Granting access now means no interruptions later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Camera</p>
              <p className="text-xs text-muted-foreground">Take a check-in photo with your phone camera</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Location</p>
              <p className="text-xs text-muted-foreground">Tag your check-in with your GPS position</p>
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
