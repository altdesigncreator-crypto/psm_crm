/**
 * Service Worker Registration
 * Registers the PWA service worker and handles updates.
 */

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

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers are not supported in this browser.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH);

    // Listen for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('sw-update-available'));
        }
      });
    });

    const checkForUpdate = () => registration.update().catch(() => {});
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  } catch (err) {
    console.error('[SW] Registration failed:', err);
  }
}

/** Force the waiting service worker to activate immediately. */
export async function skipWaitingUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (reg.waiting) {
    reg.waiting.postMessage({ action: 'skipWaiting' });
  }
}

/** Unregister the service worker (useful for debugging). */
export async function unregisterServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  await reg.unregister();
}
