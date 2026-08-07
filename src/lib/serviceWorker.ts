/**
 * Service Worker Registration
 * Registers the PWA service worker and handles updates.
 */

const SW_PATH = '/sw.js';

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
