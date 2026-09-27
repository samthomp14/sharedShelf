// sharedShelf service worker: web push only (no offline caching).
// Copied to dist/ as-is by `expo export`; lib/push.ts registers it.
//
// A push carries {title, body, url, tag, badge} from the send-push edge
// function. `url` is a path, resolved against this worker's own origin so a
// staging subscription opens staging.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'sharedShelf' };
  }

  const work = [
    // iOS drops the subscription if a push doesn't show a notification.
    self.registration.showNotification(data.title || 'sharedShelf', {
      body: data.body || undefined,
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/notifications' },
    }),
    // Tell open windows so the bell and Notifications refetch.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) w.postMessage({ type: 'push', url: data.url });
    }),
  ];

  if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    work.push(
      (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {})
    );
  }

  event.waitUntil(Promise.all(work));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/notifications', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // Let the app route in place (keeps its state); fall back to a load.
        open.postMessage({ type: 'open', url: target });
        return;
      }
      await self.clients.openWindow(target);
    })
  );
});
