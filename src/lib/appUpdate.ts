import { useSyncExternalStore } from 'react';

/**
 * Single source of truth for "is there a newer build of the app?".
 *
 * Written by src/lib/serviceWorker.ts, read by every UI surface that cares
 * (the update banner, the Settings nav dot, Settings → About). A plain
 * external store rather than React context: the service worker is set up in
 * main.tsx before React mounts, and this way it needs no provider.
 */
export type UpdateStatus =
  | 'idle'        // no check reported yet (background polling may be running)
  | 'checking'    // a user-initiated check is in flight
  | 'up-to-date'  // a user-initiated check found nothing new
  | 'available'   // a new version is installed and waiting
  | 'applying'    // user tapped Update; waiting for the new worker to take over
  | 'error'       // a user-initiated check failed (usually offline)
  | 'unsupported';// no service worker — updates can't be detected, only reloaded

export interface AppUpdateState {
  status: UpdateStatus;
  lastCheckedAt: number | null;
}

let state: AppUpdateState = { status: 'idle', lastCheckedAt: null };
let waitingWorker: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<AppUpdateState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const appUpdateStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => state,
  getWaitingWorker: () => waitingWorker,

  setAvailable(worker: ServiceWorker) {
    waitingWorker = worker;
    // Never downgrade an in-progress apply back to "available".
    if (state.status !== 'applying') set({ status: 'available', lastCheckedAt: Date.now() });
  },
  setChecking: () => set({ status: 'checking' }),
  setUpToDate: () => set({ status: 'up-to-date', lastCheckedAt: Date.now() }),
  setError: () => set({ status: 'error', lastCheckedAt: Date.now() }),
  setApplying: () => set({ status: 'applying' }),
  setUnsupported: () => set({ status: 'unsupported' }),
};

export function useAppUpdate(): AppUpdateState & { updateAvailable: boolean } {
  const snapshot = useSyncExternalStore(appUpdateStore.subscribe, appUpdateStore.getSnapshot, appUpdateStore.getSnapshot);
  return { ...snapshot, updateAvailable: snapshot.status === 'available' };
}

/** Human-facing build info, injected at build time by vite.config.ts. */
export const APP_BUILD = {
  version: __APP_VERSION__,
  buildId: __APP_BUILD_ID__,
  builtAt: __APP_BUILD_TIME__,
};
