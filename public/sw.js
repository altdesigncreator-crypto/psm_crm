/**
 * PSM Sale CRM — Service Worker
 * Features: Precache, Runtime Cache, Background Sync
 */

const CACHE_VERSION = 'v70';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;

// Files to precache (Vite build outputs + critical assets)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/logo.png',
  '/favicon.png',
];

// Background Sync tags
const SYNC_TAGS = {
  CHECKIN: 'sync-checkin',
  LEAD: 'sync-lead',
  VOICENOTE: 'sync-voicenote',
};

/* ── Install: Precache static assets ─────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

/* ── Activate: Clean old caches ──────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('static-') || k.startsWith('dynamic-'))
          .filter((k) => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: Stale-while-revalidate for static, network-first for API ───── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-HTTP(S) requests
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Firestore / Firebase API → let the SDK handle IndexedDB caching.
  // We only intercept for our own app shell and CDN assets.
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) {
    return;
  }

  // Static assets (JS, CSS, images, fonts) → Cache first, network fallback
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|woff2?|ttf|ico)$/) ||
    url.pathname === '/' ||
    url.pathname === '/index.html'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Refresh cache in background (stale-while-revalidate)
          fetch(request).then((response) => {
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
          }).catch(() => {});
          return cached;
        }
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else → Network first, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

/* ── Background Sync ──────────────────────────────────────────────────── */
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAGS.CHECKIN) {
    event.waitUntil(syncQueuedData('checkins'));
  } else if (event.tag === SYNC_TAGS.LEAD) {
    event.waitUntil(syncQueuedData('leads'));
  } else if (event.tag === SYNC_TAGS.VOICENOTE) {
    event.waitUntil(syncQueuedData('audio_notes'));
  }
});

async function syncQueuedData(storeName) {
  try {
    const db = await openIndexedDB('psm_offline_queue', 1, (upgradeDb) => {
      if (!upgradeDb.objectStoreNames.contains(storeName)) {
        upgradeDb.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
      }
    });
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const items = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!items.length) return;

    // Notify the app that sync is starting
    await notifyClients({ type: 'sync-start', store: storeName, count: items.length });

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      try {
        // We can't directly call Firestore from the SW because the SDK
        // is complex. Instead, postMessage to all clients and let the
        // active tab perform the actual Firestore write.
        const result = await postToClient('sync-item', { store: storeName, payload: item });
        if (result && result.success) {
          successCount++;
          // Remove from queue
          await new Promise((resolve, reject) => {
            const delTx = db.transaction(storeName, 'readwrite');
            delTx.objectStore(storeName).delete(item.id);
            delTx.oncomplete = () => resolve(undefined);
            delTx.onerror = () => reject(delTx.error);
          });
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    await notifyClients({ type: 'sync-complete', store: storeName, success: successCount, failed: failCount });
  } catch (err) {
    console.error('[SW] Background sync failed:', err);
  }
}

/* ── Helper: Post message to clients and wait for response ─────────────── */
function postToClient(action, payload) {
  return new Promise((resolve) => {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (!clients.length) {
        resolve({ success: false, reason: 'no_clients' });
        return;
      }
      const channel = new MessageChannel();
      let resolved = false;
      channel.port1.onmessage = (event) => {
        if (!resolved) {
          resolved = true;
          resolve(event.data);
        }
      };
      // Send to the first focused client, or the first available
      const target = clients.find((c) => c.focused) || clients[0];
      target.postMessage({ action, payload }, [channel.port2]);
      // Timeout in case client never responds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, reason: 'timeout' });
        }
      }, 10000);
    });
  });
}

async function notifyClients(payload) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(payload));
}

/* ── Skip waiting message from client ──────────────────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

/* ── Push Notifications (FCM) ───────────────────────────────────────── */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'PSM Sale CRM', body: event.data.text() } };
  }
  const title = payload.notification?.title || payload.title || 'PSM Sale CRM';
  const body = payload.notification?.body || payload.body || 'အသိပေးချက်အသစ်ရရှိပါသည်';
  const tag = payload.notification?.tag || payload.tag || 'psm-crm-push';
  const data = payload.data || {};
  const actions = payload.notification?.actions || data.actions || [
    { action: 'open', title: 'ဖွင့်ရန်' },
    { action: 'dismiss', title: 'ပိတ်ရန်' },
  ];
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/logo.png',
      badge: '/favicon.png',
      tag,
      requireInteraction: false,
      data,
      actions,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  if (action === 'dismiss') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const data = event.notification.data || {};
      let targetUrl = '/';
      if (data.url) targetUrl = data.url;
      else if (data.leadId) targetUrl = `/lead/${data.leadId}`;
      else if (data.checkinId) targetUrl = '/checkin';
      const client = clients.find((c) => c.url.includes(targetUrl));
      if (client) {
        return client.navigate(targetUrl).then(() => client.focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

/* ── Periodic Background Sync ─────────────────────────────────────────── */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'periodic-queue-sync') {
    event.waitUntil(
      (async () => {
        // Try to flush file queue and trigger background sync for all stores
        const stores = ['checkins', 'leads', 'audio_notes'];
        for (const store of stores) {
          try {
            await syncQueuedData(store);
          } catch {
            // ignore per-store errors
          }
        }
      })()
    );
  }
});

/* ── IndexedDB helper ──────────────────────────────────────────────────── */
function openIndexedDB(name, version, upgradeFn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgradeFn(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
