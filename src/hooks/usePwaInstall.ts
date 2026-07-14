import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function getIsStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true; // iOS-specific flag
}

/** Shared install-prompt state for Chrome/Edge/Android (the only browsers
 * that fire `beforeinstallprompt`). Lets any component in the tree — the
 * bottom nudge banner, a header button, etc. — trigger the same native
 * "Install app" dialog instead of each having to listen for the event
 * itself. */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(getIsStandalone);

  useEffect(() => {
    if (getIsStandalone()) return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') setIsStandalone(true);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    canInstall: !!deferredPrompt && !isStandalone,
    isStandalone,
    promptInstall,
  };
}
