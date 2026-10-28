/**
 * Single source of truth for "can this browser install the app, and how?".
 *
 * `beforeinstallprompt` fires once, early in the page's life. If it were
 * captured inside a component, anything that mounts later (e.g. Settings →
 * About, reached by navigation) would never see it. So, like appUpdate.ts,
 * this is a plain external store wired up in main.tsx before React mounts,
 * and every UI surface (bottom nudge, header button, Settings card) reads
 * the same deferred prompt.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** How installation works in the current browser. */
export type InstallPlatform =
  | 'installed'       // already running as the installed app
  | 'native'          // Chromium fired beforeinstallprompt — one-tap install
  | 'ios'             // iOS/iPadOS — manual Share → Add to Home Screen only
  | 'android-manual'  // Android without the prompt (Firefox, Samsung, criteria not met yet)
  | 'desktop';        // desktop without the prompt (Safari, Firefox) — hand off to a phone

export interface PwaInstallState {
  canPrompt: boolean;
  isStandalone: boolean;
  justInstalled: boolean;
}

export function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "MacIntel" but exposes multi-touch, unlike a real Mac.
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isSafariBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua);
}

function isAndroidDevice() {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

/** Phones and tablets — where "install" means a home-screen icon. */
export function isMobileDevice() {
  return isIOSDevice() || isAndroidDevice();
}

function getIsStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true; // iOS-specific flag
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let state: PwaInstallState = { canPrompt: false, isStandalone: getIsStandalone(), justInstalled: false };
const listeners = new Set<() => void>();

function set(next: Partial<PwaInstallState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const pwaInstallStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => state,
};

export function getInstallPlatform(s: PwaInstallState): InstallPlatform {
  if (s.isStandalone) return 'installed';
  if (s.canPrompt) return 'native';
  if (isIOSDevice()) return 'ios';
  if (isAndroidDevice()) return 'android-manual';
  return 'desktop';
}

/** Opens the browser's native install dialog. Resolves true if accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  // A deferred prompt can only be shown once — drop it before awaiting.
  deferredPrompt = null;
  set({ canPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') set({ justInstalled: true });
  return outcome === 'accepted';
}

let initialized = false;

export function initPwaInstall() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    set({ canPrompt: !state.isStandalone });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    set({ canPrompt: false, justInstalled: true });
  });

  // Covers the app being launched/moved into its standalone window.
  window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
    if (e.matches) set({ isStandalone: true, canPrompt: false });
  });
}
