// VAMIT-5 Athletes — Service Worker v3 (logo enforced)
const LOGO = 'https://res.cloudinary.com/dqqljgtna/image/upload/v1778337005/VAMIT-5_k3xlfh.jpg';
const VERSION = 'v3-logo';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch(e) { data = { title: 'VAMIT-5', body: event.data.text() }; }

  const title = data.title || 'VAMIT-5 Athletes';
  const options = {
    body: data.body || '',
    icon: LOGO,
    badge: LOGO,
    image: data.image || LOGO,
    tag: data.tag || ('vamit5-' + Date.now()),
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: {
      url: data.url || '/dashboard.html',
      title: title,
      body: data.body || '',
      ts: Date.now()
    },
    actions: [
      { action: 'open', title: 'Otvori dashboard' },
      { action: 'view', title: 'Vidi celu poruku' }
    ],
    vibrate: [220, 110, 220, 110, 220]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let url = data.url || '/dashboard.html';
  if (event.action === 'view') {
    url = '/dashboard.html?notif=' + encodeURIComponent(data.title || '') + '&body=' + encodeURIComponent(data.body || '');
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
