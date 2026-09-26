/**
 * Service Worker Registration + app update lifecycle.
 *
 * Update flow (the standard "prompt" pattern — same as Workbox / Chrome PWAs):
 *   1. A deploy ships a byte-different sw.js (build-stamped, see vite.config.ts).
 *   2. registration.update() finds it; it installs in the background and
 *      then *waits* (public/sw.js deliberately doesn't skipWaiting on install).
 *   3. The waiting worker is published to the app-update store → Settings dot,
 *      update banner, "Update now" button.
 *   4. The user taps Update → we message the waiting worker to skipWaiting →
 *      it takes control (`controllerchange`) → we reload exactly once onto
 *      the new build.
 */
import { appUpdateStore } from '@/lib/appUpdate';

const SW_PATH = '/sw.js';

// The browser only checks a controlled page's service worker for updates on
// its own schedule — roughly on navigation, and otherwise as infrequently as
// once every 24h per spec. Staff routinely leave this CRM open in a tab or
// installed-PWA window for a full shift without ever reloading, so left to
// that default cadence a released update could sit undetected for most of a
// day. Explicitly calling registration.update() on a short interval, and
// again whenever the tab regains focus (the moment someone's about to
// actually use it), closes that gap — each call is a lightweight conditional
// HTTP request, not a real reinstall, so polling it this often costs nothing
// meaningful.
const UPDATE_CHECK_INTERVAL_MS = 20 * 60 * 1000;

/** How long a manual "Check for updates" waits for a found update to finish
 * installing before reporting back. Installing = precaching a handful of
 * shell files, normally well under a second even on mobile data. */
const INSTALL_WAIT_TIMEOUT_MS = 30 * 1000;

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** Publishes a waiting worker — but only when there's a current controller.
 * With no controller this is the very first install, not an update. */
function publishIfWaiting(registration: ServiceWorkerRegistration): boolean {
  if (registration.waiting && navigator.serviceWorker.controller) {
    appUpdateStore.setAvailable(registration.waiting);
    return true;
  }
  return false;
}

/** Resolves once `worker` reaches `installed` (→ waiting) or fails. */
function waitForInstalled(worker: ServiceWorker, timeoutMs: number): Promise<boolean> {
  if (worker.state === 'installed' || worker.state === 'activated') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { worker.removeEventListener('statechange', onChange); resolve(false); }, timeoutMs);
    function onChange() {
      if (worker.state === 'installed') { cleanup(); resolve(true); }
      else if (worker.state === 'redundant') { cleanup(); resolve(false); }
    }
    function cleanup() { window.clearTimeout(timer); worker.removeEventListener('statechange', onChange); }
    worker.addEventListener('statechange', onChange);
  });
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registrationPromise) return registrationPromise;

  if (!('serviceWorker' in navigator)) {
    appUpdateStore.setUnsupported();
    registrationPromise = Promise.resolve(null);
    return registrationPromise;
  }

  registrationPromise = (async () => {
    try {
      const registration = await navigator.serviceWorker.register(SW_PATH);

      // An update may have finished installing before this page loaded
      // (e.g. found by another tab, or while the phone was asleep) — it's
      // already sitting in `waiting` and no `updatefound` will ever fire for it.
      publishIfWaiting(registration);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') publishIfWaiting(registration);
        });
      });

      // Reload once the new worker takes control — but only when the user
      // asked for it. Other causes (a first install claiming the page, an
      // update applied from another tab) must never yank this page away.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (appUpdateStore.getSnapshot().status === 'applying') window.location.reload();
      });

      const backgroundCheck = () => registration.update().then(() => publishIfWaiting(registration)).catch(() => {});
      window.setInterval(backgroundCheck, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') backgroundCheck();
      });

      return registration;
    } catch (err) {
      console.error('[SW] Registration failed:', err);
      appUpdateStore.setUnsupported();
      return null;
    }
  })();
  return registrationPromise;
}

/** User-initiated check (Settings → "Check for updates"). Unlike the silent
 * background poll, this reports a definite result: available / up-to-date / error. */
export async function checkForUpdate(): Promise<void> {
  const registration = await registerServiceWorker();
  if (!registration) return;
  if (appUpdateStore.getSnapshot().status === 'available') return;

  appUpdateStore.setChecking();
  try {
    await registration.update();
    if (publishIfWaiting(registration)) return;
    if (registration.installing && (await waitForInstalled(registration.installing, INSTALL_WAIT_TIMEOUT_MS))) {
      if (publishIfWaiting(registration)) return;
    }
    appUpdateStore.setUpToDate();
  } catch (err) {
    console.error('[SW] Update check failed:', err);
    appUpdateStore.setError();
  }
}

/** Activates the waiting worker; the `controllerchange` listener above then reloads. */
export function applyUpdate(): void {
  const waiting = appUpdateStore.getWaitingWorker();
  appUpdateStore.setApplying();
  if (!waiting) {
    // Nothing to activate (e.g. no SW support) — a plain reload still pulls
    // the newest index.html, since the shell is served network-first.
    window.location.reload();
    return;
  }
  waiting.postMessage({ action: 'skipWaiting' });
  // Safety net: if controllerchange never arrives (browser quirk, worker
  // went redundant), don't leave the user staring at a spinner.
  window.setTimeout(() => window.location.reload(), 4000);
}

/** Unregister the service worker (useful for debugging). */
export async function unregisterServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  await reg.unregister();
}
