// VAMIT-5 Athletes — Service Worker (Web Push) v2
// =====================================================================

const LOGO = 'https://res.cloudinary.com/dqqljgtna/image/upload/v1778337005/VAMIT-5_k3xlfh.jpg';

self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); }
  catch (e) { data = { title: 'VAMIT-5', body: event.data.text() }; }

  const title = data.title || 'VAMIT-5 Athletes';
  const options = {
    body: data.body || '',
    icon: data.icon || LOGO,
    badge: data.badge || LOGO,
    image: data.image || LOGO,
    tag: data.tag || ('vamit5-' + Date.now()),
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: {
      url: data.url || '/dashboard.html',
      title: title,
      body: data.body || '',
      timestamp: Date.now(),
      ...(data.data || {})
    },
    actions: [
      { action: 'open', title: 'Otvori' },
      { action: 'view', title: 'Vidi sve' }
    ],
    vibrate: [220, 110, 220, 110, 220],
    timestamp: Date.now()
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;

  // "Vidi sve" action — ide na inbox stranicu sa istorijom
  let url = data.url || '/dashboard.html';
  if (action === 'view') {
    url = '/dashboard.html?notif=' + encodeURIComponent(data.title || '') + '&body=' + encodeURIComponent(data.body || '');
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('Push subscription changed, will re-subscribe on next open');
});
