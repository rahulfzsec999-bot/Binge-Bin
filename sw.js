/* Binge Bin service worker — caching + Web Push (Android + iOS Home Screen PWA) */
const CACHE = 'bingebin-shell-v1';
const SHELL = ['/', '/index.html', '/site.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Network-first for app shell; never cache API/Firebase
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('firebase') || url.pathname.includes('googleapis')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
  );
});

/** Push payload: { title, body, icon, data: { url, itemId, tmdbId, tmdbKind, notifId } } */
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Binge Bin',
    body: 'Something on your watchlist is available.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/?src=push' }
  };
  try {
    if (event.data) {
      const json = event.data.json();
      payload = Object.assign(payload, json);
      if (json.notification) {
        payload.title = json.notification.title || payload.title;
        payload.body = json.notification.body || payload.body;
        payload.icon = json.notification.icon || payload.icon;
      }
      if (json.data) payload.data = Object.assign(payload.data || {}, json.data);
    }
  } catch (e) {
    try {
      payload.body = event.data.text();
    } catch (_) {}
  }

  const data = payload.data || {};
  // Deep link: prefer explicit url, else build from tmdb / item
  if (!data.url || data.url === '/?src=push') {
    if (data.itemId) data.url = `/?openItem=${encodeURIComponent(data.itemId)}`;
    else if (data.tmdbId && data.tmdbKind) {
      data.url = `/?openTmdb=${encodeURIComponent(data.tmdbKind + ':' + data.tmdbId)}`;
    } else data.url = '/?src=push';
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/icon-192.png',
      data,
      tag: data.notifId || data.itemId || data.tmdbId || 'bingebin',
      renotify: true,
      requireInteraction: false
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let target = data.url || '/';
  if (target.startsWith('/')) {
    target = self.location.origin + target;
  }

  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(target); } catch (_) {
              client.postMessage({ type: 'BINGEBIN_OPEN', url: target, data });
            }
          } else {
            client.postMessage({ type: 'BINGEBIN_OPEN', url: target, data });
          }
          return;
        }
      }
      if (clients.openWindow) await clients.openWindow(target);
    })()
  );
});

// Firebase Messaging background handler (when using FCM SDK in page)
// Compatible no-op if firebase scripts are not imported here.
self.addEventListener('pushsubscriptionchange', (event) => {
  // Client page should re-subscribe on next open; log for diagnostics
  console.log('[BingeBin SW] pushsubscriptionchange', event);
});
