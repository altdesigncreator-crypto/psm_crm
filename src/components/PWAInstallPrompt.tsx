import React, { useEffect, useState } from 'react';
import { Download, X, Share, SquarePlus } from 'lucide-react';
import { usePwaInstall } from '@/hooks/usePwaInstall';

const DISMISS_KEY = 'pwa-install-dismissed';

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "MacIntel" but exposes multi-touch, unlike a real Mac.
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafariBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua);
}

/** Chrome/Android fires `beforeinstallprompt` and can trigger the native
 * install dialog directly (see src/hooks/usePwaInstall.ts, also used by the
 * always-visible header button in AppLayout.tsx). iOS Safari never fires
 * that event — there is no programmatic install API — so home-screen
 * installation there is always a manual "Share → Add to Home Screen" action
 * we can only walk the user through with instructions. */
export default function PWAInstallPrompt() {
  const { canInstall, isStandalone, promptInstall } = usePwaInstall();
  const [visible, setVisible] = useState(false);
  const [iosVisible, setIosVisible] = useState(false);

  useEffect(() => {
    if (isStandalone) return;
    const dismissedAt = sessionStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const hoursSince = (Date.now() - parseInt(dismissedAt, 10)) / 3600000;
      if (hoursSince < 24) return;
    }

    if (isIOSDevice() && isSafariBrowser()) {
      setIosVisible(true);
    }
  }, [isStandalone]);

  useEffect(() => {
    if (canInstall) setVisible(true);
  }, [canInstall]);

  const handleInstall = async () => {
    await promptInstall();
    setVisible(false);
  };

  const handleDismiss = () => {
    setVisible(false);
    setIosVisible(false);
    sessionStorage.setItem(DISMISS_KEY, Date.now().toString());
  };

  if (isStandalone || (!visible && !iosVisible)) return null;

  if (iosVisible) {
    return (
      <div className="fixed bottom-16 left-0 right-0 z-[55] px-4 animate-fade-in-up">
        <div className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-elevated p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Share className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-snug">Install PSM Sale CRM</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
              Tap <Share className="w-3.5 h-3.5 inline text-primary" /> Share, then
              <SquarePlus className="w-3.5 h-3.5 inline text-primary" /> "Add to Home Screen"
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-16 left-0 right-0 z-[55] px-4 animate-fade-in-up">
      <div className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-elevated p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Download className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">
            PSM CRM အက်ပ် ထည့်သွင်းရန်
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Offline အသုံးပြုနိုင်ရန် home screen တွင် ထည့်ပါ
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleInstall}
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:scale-95 transition-transform"
          >
            ထည့်ရန်
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            aria-label="ပိတ်ရန်"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
