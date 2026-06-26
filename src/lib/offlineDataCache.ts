/**
 * Offline Data Cache — IndexedDB-backed snapshot store.
 *
 * When Firestore is offline, onSnapshot already returns cached documents
 * from Firestore's own IndexedDB cache.  This module adds an *explicit*
 * layer that:
 *   1. Stores role-filtered snapshots (so that even if the raw cache is
 *      somehow bypassed, the app only shows data the current role is
 *      allowed to see).
 *   2. Provides a fallback read path when onSnapshot throws because of
 *      a hard network failure (as opposed to graceful offline mode).
 *   3. Tags every cache entry with the viewer's role+department so that
 *      switching users or roles automatically invalidates stale data.
 */

const DB_NAME = 'psm_offline_cache';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

interface CacheEntry<T> {
  collection: string;
  key: string;        // composite: "{role}|{dept}|{collection}"
  role: string;
  department: string;
  data: T[];
  cachedAt: number;
}

let dbInstance: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('byCollection', 'collection', { unique: false });
        store.createIndex('byRole', 'role', { unique: false });
      }
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function buildKey(collection: string, role: string, dept: string): string {
  const r = (role || 'none').toLowerCase().trim();
  const d = (dept || 'all').toLowerCase().trim();
  return `${r}|${d}|${collection}`;
}

/** Store a role-filtered snapshot. */
export async function cacheSnapshot<T>(
  collection: string,
  role: string,
  department: string,
  data: T[],
): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry: CacheEntry<T> = {
      collection,
      key: buildKey(collection, role, department),
      role: role.toLowerCase().trim(),
      department: department.toLowerCase().trim(),
      data,
      cachedAt: Date.now(),
    };
    store.put(entry);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently ignore IndexedDB errors (e.g. private mode, quota exceeded)
  }
}

/** Retrieve a cached snapshot for the current role/dept. */
export async function getCachedSnapshot<T>(
  collection: string,
  role: string,
  department: string,
): Promise<T[] | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(buildKey(collection, role, department));
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const entry = req.result as CacheEntry<T> | undefined;
        if (!entry) return resolve(null);
        // Reject cache older than 7 days (stale data safeguard)
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - entry.cachedAt > maxAge) return resolve(null);
        resolve(entry.data);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Clear every cache entry that belongs to a different role or department.
 *  Call this when the user logs in or their role changes. */
export async function invalidateStaleCache(currentRole: string, currentDept: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    const r = currentRole.toLowerCase().trim();
    const d = currentDept.toLowerCase().trim();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const entry = cursor.value as CacheEntry<any>;
        if (entry.role !== r || entry.department !== d) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
    });
  } catch {
    // ignore
  }
}

/** Clear all cached snapshots (e.g. on explicit logout). */
export async function clearAllCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
