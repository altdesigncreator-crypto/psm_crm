/**
 * useOfflineCollection — Firestore onSnapshot with explicit IndexedDB fallback.
 *
 * Firestore already caches documents internally via enableIndexedDbPersistence.
 * This hook adds an *additional* layer:
 *   1. On every successful snapshot, it stores the ROLE-FILTERED data into our
 *      own IndexedDB cache keyed by (role, department, collection).
 *   2. If onSnapshot errors with a hard network failure (not the normal
 *      graceful offline path), it falls back to the explicit cache.
 *   3. When the device comes back online, the live listener resumes and
 *      automatically overwrites the fallback cache.
 *
 * Usage:
 *   const [data, loading] = useOfflineCollection<Lead>(
 *     'leads',
 *     role,
 *     userDept,
 *     userEmail,
 *     (raw) => filterVisibleLeads(raw, role, userEmail)
 *   );
 */

import { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isOnline } from '@/lib/offlineAuth';
import { cacheSnapshot, getCachedSnapshot } from '@/lib/offlineDataCache';

export function useOfflineCollection<T>(
  collectionName: string,
  role: string | null,
  department: string,
  userEmail: string | null | undefined,
  filterFn: (docs: T[]) => T[],
): [T[], boolean] {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const hasReturnedCache = useRef(false);

  useEffect(() => {
    if (!role) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    hasReturnedCache.current = false;

    const colRef = collection(db, collectionName);

    const unsub = onSnapshot(
      colRef,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const raw = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T);
        const visible = filterFn(raw);
        setData(visible);
        setLoading(false);
        // Always update our explicit cache with the latest role-filtered view
        cacheSnapshot(collectionName, role, department, visible);
      },
      async (err) => {
        // onSnapshot error — try explicit cache as fallback
        const cached = await getCachedSnapshot<T>(collectionName, role, department);
        if (cached && !hasReturnedCache.current) {
          hasReturnedCache.current = true;
          setData(cached);
        }
        setLoading(false);
        console.warn(`[useOfflineCollection] ${collectionName} snapshot error:`, err.message);
      }
    );

    // If we are already offline when the hook mounts, Firestore may not fire
    // the snapshot at all.  Kick the fallback immediately in that case.
    if (!isOnline()) {
      getCachedSnapshot<T>(collectionName, role, department).then((cached) => {
        if (cached && !hasReturnedCache.current) {
          hasReturnedCache.current = true;
          setData(cached);
          setLoading(false);
        }
      });
    }

    return () => unsub();
  }, [collectionName, role, department, userEmail]);

  return [data, loading];
}
