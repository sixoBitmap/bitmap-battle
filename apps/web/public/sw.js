// Battle alerts only: nothing is cached, so the app is always the version the server serves.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let notice = { title: 'Bitmap Battle', body: 'A battle has started.', url: '/', tag: 'battle' };
  try {
    notice = { ...notice, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      vibrate: [120, 60, 120],
      data: { url: notice.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
