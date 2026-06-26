/**
 * Background Sync Client API
 *
 * Queues Firestore writes into an IndexedDB store when the device is offline.
 * When connectivity returns, the service worker fires a 'sync' event
 * which pulls items from the queue and asks the active client to perform
 * the actual Firestore write.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { isOnline, isNetworkError } from './offlineAuth';
import { getFileQueueCount, flushStorageQueue } from './offlineStorageQueue';
import { toast } from 'sonner';

const DB_NAME = 'psm_offline_queue';
const DB_VERSION = 2;

interface QueueItem {
  id?: number;
  collection: string;
  payload: any;
  createdAt: number;
  retryCount: number;
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains('checkins')) {
        database.createObjectStore('checkins', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('leads')) {
        database.createObjectStore('leads', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('audio_notes')) {
        database.createObjectStore('audio_notes', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('fileQueue')) {
        database.createObjectStore('fileQueue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(storeName: string, payload: any): Promise<void> {
  const database = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const item: Omit<QueueItem, 'id'> = {
      collection: storeName,
      payload,
      createdAt: Date.now(),
      retryCount: 0,
    };
    const req = store.add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getQueueCount(storeName: string): Promise<number> {
  try {
    const database = await openQueueDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

/** Register a background sync tag with the service worker. */
async function requestSync(tag: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  const reg = await navigator.serviceWorker.ready;
  try {
    await (reg as any).sync.register(tag);
  } catch {
    // Some browsers don't support background sync
  }
}

/** Register periodic background sync for auto-flushing queue every 15 min. */
export async function requestPeriodicSync(minIntervalMinutes = 15): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (!('periodicSync' in reg)) return;
  try {
    await (reg as any).periodicSync.register('periodic-queue-sync', {
      minInterval: minIntervalMinutes * 60 * 1000,
    });
    console.log('[PeriodicSync] Registered:', minIntervalMinutes, 'min interval');
  } catch {
    // Periodic sync may not be supported or permission denied
  }
}

/* ── Public helpers for each collection ────────────────────────────────── */

/** Submit a check-in. If offline, queue for background sync. */
export async function submitCheckIn(payload: any): Promise<void> {
  try {
    await addDoc(collection(db, 'checkins'), {
      ...payload,
      timestamp: serverTimestamp(),
    });
  } catch (err: any) {
    if (isNetworkError(err) || !isOnline()) {
      await enqueue('checkins', payload);
      await requestSync('sync-checkin');
      toast.info('Check-in ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။ အင်တာနက် ပြန်လာလျှင် auto-sync လုပ်ပေးပါမည်။');
      return;
    }
    throw err;
  }
}

/** Submit a lead. If offline, queue for background sync. */
export async function submitLead(payload: any): Promise<void> {
  try {
    await addDoc(collection(db, 'leads'), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (isNetworkError(err) || !isOnline()) {
      await enqueue('leads', payload);
      await requestSync('sync-lead');
      toast.info('Lead ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။ အင်တာနက် ပြန်လာလျှင် auto-sync လုပ်ပေးပါမည်။');
      return;
    }
    throw err;
  }
}

/** Submit an audio note. If offline, queue for background sync. */
export async function submitAudioNote(payload: any): Promise<void> {
  try {
    await addDoc(collection(db, 'audio_notes'), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (isNetworkError(err) || !isOnline()) {
      await enqueue('audio_notes', payload);
      await requestSync('sync-voicenote');
      toast.info('Voice note ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။ အင်တာနက် ပြန်လာလျှင် auto-sync လုပ်ပေးပါမည်။');
      return;
    }
    throw err;
  }
}

/** Get pending queue counts for UI badges. */
export async function getPendingCounts(): Promise<Record<string, number>> {
  const [checkins, leads, audio_notes, files] = await Promise.all([
    getQueueCount('checkins'),
    getQueueCount('leads'),
    getQueueCount('audio_notes'),
    getFileQueueCount(),
  ]);
  return { checkins, leads, audio_notes, files };
}

export interface PendingQueueItem {
  id: number;
  collection: string;
  payload: any;
  createdAt: number;
}

async function getQueueItems(storeName: string): Promise<PendingQueueItem[]> {
  try {
    const database = await openQueueDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as QueueItem[]).map((item) => ({
          id: item.id || 0,
          collection: storeName,
          payload: item.payload,
          createdAt: item.createdAt,
        }));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Get all pending queue items for UI display. */
export async function getAllPendingItems(): Promise<PendingQueueItem[]> {
  const [checkins, leads, audioNotes] = await Promise.all([
    getQueueItems('checkins'),
    getQueueItems('leads'),
    getQueueItems('audio_notes'),
  ]);
  return [...checkins, ...leads, ...audioNotes].sort((a, b) => b.createdAt - a.createdAt);
}

/* ── Service Worker message listener (handles sync from SW) ───────────── */
export function initBackgroundSyncListener(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', async (event) => {
    const { action, payload } = event.data || {};
    if (action === 'sync-item') {
      const { store, payload: itemPayload } = payload || {};
      try {
        await addDoc(collection(db, store), {
          ...itemPayload,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
      } catch (err) {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: false, error: (err as Error).message });
        }
      }
    }
  });

  // Listen for sync status messages from SW
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'sync-start') {
      const { store, count } = event.data;
      toast.info(`${count} ခု ${store} အတွက် sync လုပ်နေပါသည်...`);
    }
    if (event.data?.type === 'sync-complete') {
      const { store, success, failed } = event.data;
      if (success > 0) {
        toast.success(`${store}: ${success} ခု sync အောင်မြင်ပါသည်${failed > 0 ? ` (${failed} ခု မအောင်မြင်ပါ)` : ''}`);
      } else if (failed > 0) {
        toast.error(`${store}: sync မအောင်မြင်ပါ — ${failed} ခု ချန်ခဲ့သည်`);
      }
      // Also try to flush any pending file uploads
      flushStorageQueue().catch(() => {});
    }
  });

  // Register periodic background sync after SW is ready
  requestPeriodicSync(15).catch(() => {});
}
