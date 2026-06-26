import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Hide if already installed (standalone) or previously dismissed within 24h
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsStandalone(true);
      return;
    }
    const dismissedAt = sessionStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const hoursSince = (Date.now() - parseInt(dismissedAt, 10)) / 3600000;
      if (hoursSince < 24) return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsStandalone(true);
    }
    setDeferredPrompt(null);
    setVisible(false);
  };

  const handleDismiss = () => {
    setVisible(false);
    sessionStorage.setItem(DISMISS_KEY, Date.now().toString());
  };

  if (isStandalone || !visible) return null;

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
