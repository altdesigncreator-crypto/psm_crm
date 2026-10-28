import { useSyncExternalStore } from 'react';
import { getInstallPlatform, promptInstall, pwaInstallStore, type InstallPlatform } from '@/lib/pwaInstall';

/** Shared install-prompt state (see src/lib/pwaInstall.ts). Lets any
 * component in the tree — the bottom nudge banner, a header button,
 * Settings → About — trigger the same native "Install app" dialog, even if
 * it mounted after the browser fired `beforeinstallprompt`. */
export function usePwaInstall(): {
  canInstall: boolean;
  isStandalone: boolean;
  justInstalled: boolean;
  platform: InstallPlatform;
  promptInstall: () => Promise<boolean>;
} {
  const snapshot = useSyncExternalStore(pwaInstallStore.subscribe, pwaInstallStore.getSnapshot, pwaInstallStore.getSnapshot);
  return {
    canInstall: snapshot.canPrompt && !snapshot.isStandalone,
    isStandalone: snapshot.isStandalone,
    justInstalled: snapshot.justInstalled,
    platform: getInstallPlatform(snapshot),
    promptInstall,
  };
}
